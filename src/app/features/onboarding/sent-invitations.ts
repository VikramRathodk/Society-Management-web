import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SendResult } from '../../core/models';
import { qrDataUrl } from '../invitations/invitation-ui';
import { downloadLinksCsv, qrCardsHtml, sortedByFlat } from './onboarding-ui';

/**
 * The residents just invited from a sheet. Their links exist only in this answer (the server keeps
 * just a hash), so this is where they are saved: a links CSV for a WhatsApp broadcast or mail merge,
 * and printable QR cards. A lost link is replaced from the Invitations page (Resend).
 */
@Component({
  selector: 'app-sent-invitations',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="head">
      <mat-icon class="ok" aria-hidden="true">mark_email_read</mat-icon>
      <div>
        <p class="title">{{ result().sent.length }} invitations sent</p>
        @if (result().sent.length) {
          <p class="warn" role="note">
            Save the links now: they are shown only once. Lost ones can be sent again from
            Invitations.
          </p>
        }
      </div>
    </div>

    @if (result().sent.length) {
      <div class="actions">
        <button mat-flat-button type="button" (click)="csv()">
          <mat-icon>download</mat-icon> Links CSV
        </button>
        <button mat-stroked-button type="button" (click)="cards()">
          <mat-icon>print</mat-icon> Print QR cards
        </button>
      </div>

      <details>
        <summary>Show the {{ result().sent.length }} links</summary>
        <ul class="links">
          @for (s of sent(); track s.invitationId) {
            <li>
              <span class="flat">{{ s.flatLabel }}</span>
              <span>{{ s.name }} · {{ s.phone }}</span>
              <a [href]="s.inviteUrl" target="_blank" rel="noopener" class="link">{{
                s.inviteUrl
              }}</a>
            </li>
          }
        </ul>
      </details>
    }

    @if (result().skipped.length; as n) {
      <div class="skipped">
        <p class="title-small">{{ n }} rows were left out</p>
        <ul>
          @for (r of result().skipped; track r.id) {
            <li>
              Row {{ r.row }} · {{ r.name ?? '—' }} · {{ r.flatLabel ?? r.flatText ?? '—' }}:
              <span class="error-text">{{ r.error }}</span>
            </li>
          }
        </ul>
        <p class="muted">Fix them in the sheet and upload just those rows again.</p>
      </div>
    }
  `,
  styles: `
    .head {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .ok {
      color: var(--app-success, var(--mat-sys-primary));
    }
    p {
      margin: 0 0 6px;
    }
    .title {
      font: var(--mat-sys-title-medium);
    }
    .title-small {
      font: var(--mat-sys-title-small);
    }
    .warn {
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--app-warning-container);
      color: var(--app-warning);
      font: var(--mat-sys-body-small);
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 12px 0;
    }
    details {
      margin-bottom: 12px;
    }
    summary {
      cursor: pointer;
      font: var(--mat-sys-label-large);
    }
    ul {
      margin: 8px 0;
      padding-left: 18px;
    }
    .links li {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      margin-bottom: 4px;
    }
    .flat {
      font-weight: 600;
    }
    .link {
      word-break: break-all;
      font: var(--mat-sys-body-small);
    }
    .skipped {
      margin-top: 12px;
    }
    .error-text {
      color: var(--mat-sys-error);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class SentInvitations {
  private readonly snack = inject(MatSnackBar);

  readonly result = input.required<SendResult>();
  readonly societyName = input.required<string>();

  protected readonly sent = computed(() => sortedByFlat(this.result().sent));

  protected csv(): void {
    downloadLinksCsv(this.result().sent, this.societyName());
  }

  protected async cards(): Promise<void> {
    // Opened inside the click so pop-up blockers allow it; filled once the codes are drawn.
    const win = window.open('', '_blank', 'width=900,height=900');
    if (!win) {
      this.snack.open('Allow pop-ups to print the cards', undefined, { duration: 4000 });
      return;
    }
    const cards = await Promise.all(
      this.sent().map(async (sent) => ({ sent, qr: await qrDataUrl(sent.inviteUrl, 300) })),
    );
    win.document.open();
    win.document.write(qrCardsHtml(this.societyName(), cards));
    win.document.close();
  }
}
