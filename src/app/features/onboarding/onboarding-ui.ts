import {
  ApplicationStatus,
  OnboardingChecklist,
  SentInvitation,
  WingPattern,
} from '../../core/models';
import { saveFile } from '../../shared/export-dialog';
import { Tone } from '../../shared/ui';
import { escapeHtml } from '../invitations/invitation-ui';

/** The backend's names for missing profile fields, as people read them. */
const PROFILE_FIELDS: Record<string, string> = {
  address: 'address',
  city: 'city',
  state: 'state',
  pincode: 'PIN code',
  contactPhone: 'contact phone',
};

export function missingProfileText(missing: string[]): string {
  return missing.map((m) => PROFILE_FIELDS[m] ?? m).join(', ');
}

/** The four steps that count towards "n of 4 done" in the banner (go live is the fifth). */
export function setupProgress(c: OnboardingChecklist): { done: number; total: number } {
  const steps = [c.profile.done, c.structure.done, c.residents.done, c.committee.done];
  return { done: steps.filter(Boolean).length, total: steps.length };
}

export const APPLICATION_STATUS: Record<ApplicationStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Waiting', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

// ---- Wing patterns ----

/** Mirrors the backend's numbering so the form can show a sample before asking for a preview. */
export function sampleNumbers(p: WingPattern, count = 4): string[] {
  const numbering = p.numbering?.trim() || '{floor}{nn}';
  const out: string[] = [];
  for (let floor = p.floorsFrom; floor <= p.floorsTo && out.length < count; floor++) {
    for (let n = 1; n <= p.flatsPerFloor && out.length < count; n++) {
      out.push(
        numbering
          .replaceAll('{floor}', String(floor))
          .replaceAll('{nn}', String(n).padStart(2, '0'))
          .replaceAll('{n}', String(n))
          .replaceAll('{wing}', p.wing.trim())
          .trim(),
      );
    }
  }
  return out;
}

/** "12, 13 , ,G1" → ["12", "13", "G1"]. */
export function listOf(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- Handing out the links of a sent residents sheet ----

const BOM = String.fromCharCode(0xfeff);

/** For a WhatsApp broadcast or mail merge. Cells a spreadsheet would run as a formula are quoted. */
export function linksCsv(sent: SentInvitation[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const rows = [
    ['Flat', 'Name', 'Phone', 'Link'],
    ...sortedByFlat(sent).map((s) => [s.flatLabel, s.name, s.phone, s.inviteUrl]),
  ];
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function downloadLinksCsv(sent: SentInvitation[], societyName: string): void {
  // A byte-order mark so Excel reads the names as UTF-8.
  const blob = new Blob([BOM + linksCsv(sent)], { type: 'text/csv;charset=utf-8' });
  saveFile(blob, `${slug(societyName)}-resident-invitations.csv`);
}

/** A printable page of QR cards, one per invitation, by flat: for the notice board or door to door. */
export function qrCardsHtml(
  societyName: string,
  cards: { sent: SentInvitation; qr: string }[],
): string {
  const body = cards
    .map(
      ({ sent, qr }) => `<div class="card">
  <p class="flat">${escapeHtml(sent.flatLabel)}</p>
  <p class="who">${escapeHtml(sent.name)}</p>
  <img src="${qr}" alt="QR code for ${escapeHtml(sent.name)}">
  <p class="scan">Scan to join ${escapeHtml(societyName)}</p>
</div>`,
    )
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(societyName)} · invitation cards</title>
<style>
  @page { margin: 10mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f1b16; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
  .card { break-inside: avoid; padding: 10px; border: 1px dashed #b8a998; border-radius: 10px; text-align: center; }
  .flat { margin: 0; font-size: 18px; font-weight: 700; }
  .who { margin: 2px 0 6px; font-size: 13px; color: #52443a; }
  img { width: 150px; height: 150px; image-rendering: pixelated; }
  .scan { margin: 4px 0 0; font-size: 11px; color: #52443a; }
</style></head>
<body><div class="grid">
${body}
</div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
}

export function sortedByFlat(sent: SentInvitation[]): SentInvitation[] {
  return [...sent].sort(
    (a, b) => a.flatLabel.localeCompare(b.flatLabel, undefined, { numeric: true }) || a.row - b.row,
  );
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'society'
  );
}
