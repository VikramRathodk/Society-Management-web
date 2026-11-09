import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { Invitation, InvitationStatus, IssuedInvitation, ResidentType } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { Tone } from '../../shared/ui';

export const INVITATION_STATUS: Record<InvitationStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'primary' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  REVOKED: { label: 'Cancelled', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
};

/** The filter chips on the invitations page, in order. */
export const STATUS_FILTERS: { value: InvitationStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'AWAITING_APPROVAL', label: 'Awaiting approval' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REVOKED', label: 'Cancelled' },
];

/** `?status=` from a link (e.g. an approval push), if it is a known status. */
export function statusParam(value: string | null): InvitationStatus | null {
  return value && value in INVITATION_STATUS ? (value as InvitationStatus) : null;
}

/**
 * The Invitations page is for society-wide viewers (all invitations) and for residents (the ones they
 * sent). The backend decides what each sees; this only decides whether to offer the page.
 */
export function canOpenInvitations(auth: AuthStore, societyId: number | null): boolean {
  return (
    auth.can('USER.INVITE.VIEW', societyId) ||
    (auth.user()?.roles.some((r) => r.societyId === societyId && r.flatId != null) ?? false)
  );
}

export const invitationsGuard: CanMatchFn = () =>
  canOpenInvitations(inject(AuthStore), inject(SocietyContextStore).selectedSocietyId()) ||
  inject(Router).createUrlTree(['/forbidden']);

export function residentTypeLabel(type: ResidentType | null): string {
  return type ? type.charAt(0) + type.slice(1).toLowerCase() : '';
}

/** "Resident · A-101 · Tenant", or just the role name for roles without a flat. */
export function invitedAs(i: Pick<Invitation, 'roleName' | 'flatLabel' | 'residentType'>): string {
  return [i.roleName, i.flatLabel, residentTypeLabel(i.residentType)].filter(Boolean).join(' · ');
}

/** "16 Nov 2026" in the reader's locale. */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The message shared with the link (WhatsApp, the share sheet, copy). */
export function inviteMessage(issued: IssuedInvitation): string {
  const i = issued.invitation;
  const flat = i.flatLabel ? ` (flat ${i.flatLabel})` : '';
  // An invitation awaiting approval starts its expiry only when approved.
  const when =
    i.status === 'AWAITING_APPROVAL'
      ? "it works once the society's committee approves it"
      : `valid until ${dayLabel(i.expiresAt)}`;
  return (
    `Hi ${i.name}, you're invited to join ${i.societyName} as ${i.roleName}${flat}. ` +
    `Open this link to accept: ${issued.inviteUrl} (${when})`
  );
}

/** wa.me link that opens WhatsApp with the message ready; the sender picks the chat. */
export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** The invite link as a PNG data URL, large enough to print. */
export async function qrDataUrl(value: string, size = 512): Promise<string> {
  const qr = await import('qrcode');
  return qr.toDataURL(value, { width: size, margin: 2, errorCorrectionLevel: 'M' });
}

/** File name for the downloaded QR, e.g. "invite-priya-a-101.png". */
export function qrFileName(i: Invitation): string {
  const slug = [i.name, i.flatLabel ?? i.roleName]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `invite-${slug || i.id}.png`;
}

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** A self-contained printable card: society, who it's for, "Scan to join", the QR and the link. */
export function printCardHtml(issued: IssuedInvitation, qrSrc: string): string {
  const i = issued.invitation;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Invitation for ${escape(i.name)}</title>
<style>
  @page { margin: 16mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f1b16; margin: 0; }
  .card { max-width: 420px; margin: 0 auto; padding: 28px; border: 1px solid #d6c8b8; border-radius: 16px; text-align: center; }
  .society { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .who { margin: 0 0 20px; color: #52443a; }
  .scan { font-size: 18px; font-weight: 600; margin: 0 0 12px; }
  img { width: 260px; height: 260px; image-rendering: pixelated; }
  .link { margin: 16px 0 4px; font-size: 12px; word-break: break-all; color: #52443a; }
  .expiry { margin: 0; font-size: 12px; color: #52443a; }
</style></head>
<body><div class="card">
  <p class="society">${escape(i.societyName)}</p>
  <p class="who">${escape(i.name)} · ${escape(invitedAs(i))}</p>
  <p class="scan">Scan to join</p>
  <img src="${qrSrc}" alt="QR code for the invitation link">
  <p class="link">${escape(issued.inviteUrl)}</p>
  <p class="expiry">Valid until ${escape(dayLabel(i.expiresAt))}</p>
</div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
}
