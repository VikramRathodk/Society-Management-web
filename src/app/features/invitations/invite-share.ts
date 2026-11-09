import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { IssuedInvitation } from '../../core/models';
import { QrCode } from '../maintenance/maintenance-ui';
import {
  dayLabel,
  invitedAs,
  inviteMessage,
  printCardHtml,
  qrDataUrl,
  qrFileName,
  whatsappLink,
} from './invitation-ui';

/** The QR code of a fresh invitation link, with every way to hand it over. */
@Component({
  selector: 'app-invite-share',
  imports: [MatButtonModule, MatIconModule, QrCode],
  template: `
    @let i = issued().invitation;
    <div class="share">
      <app-qr-code
        [value]="issued().inviteUrl"
        [size]="200"
        [alt]="'QR code to join as ' + i.roleName"
      />
      <div class="details">
        <p class="who">{{ i.name }}</p>
        <p class="muted">{{ invitedAs(i) }} · {{ i.phone }}</p>
        <p class="muted">
          Scan with a phone camera, or share the link. Valid until {{ dayLabel(i.expiresAt) }}.
        </p>
        <p class="link" data-testid="invite-link">{{ issued().inviteUrl }}</p>
      </div>
    </div>
    <div class="actions">
      <button mat-stroked-button type="button" (click)="copy()">
        <mat-icon>content_copy</mat-icon> Copy link
      </button>
      <a mat-stroked-button [href]="whatsapp()" target="_blank" rel="noopener">
        <mat-icon>chat</mat-icon> WhatsApp
      </a>
      @if (canShare) {
        <button mat-stroked-button type="button" (click)="share()">
          <mat-icon>share</mat-icon> Share…
        </button>
      }
      <button mat-stroked-button type="button" (click)="download()">
        <mat-icon>download</mat-icon> Download QR
      </button>
      <button mat-stroked-button type="button" (click)="print()">
        <mat-icon>print</mat-icon> Print card
      </button>
    </div>
  `,
  styles: `
    .share {
      display: flex;
      gap: 20px;
      align-items: center;
      flex-wrap: wrap;
    }
    .details {
      flex: 1 1 220px;
      min-width: 0;
    }
    p {
      margin: 0 0 6px;
    }
    .who {
      font: var(--mat-sys-title-medium);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .link {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-body-small);
      word-break: break-all;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
  `,
})
export class InviteShare {
  private readonly snack = inject(MatSnackBar);

  readonly issued = input.required<IssuedInvitation>();

  protected readonly invitedAs = invitedAs;
  protected readonly dayLabel = dayLabel;
  protected readonly canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  protected readonly whatsapp = computed(() => whatsappLink(inviteMessage(this.issued())));

  protected copy(): void {
    navigator.clipboard?.writeText(this.issued().inviteUrl).then(
      () => this.snack.open('Link copied', undefined, { duration: 2500 }),
      () =>
        this.snack.open('Copy failed; select the link and copy it', undefined, { duration: 4000 }),
    );
  }

  protected share(): void {
    const issued = this.issued();
    navigator
      .share({ title: `Join ${issued.invitation.societyName}`, text: inviteMessage(issued) })
      .catch(() => {}); // cancelled by the user
  }

  protected async download(): Promise<void> {
    const link = document.createElement('a');
    link.href = await qrDataUrl(this.issued().inviteUrl);
    link.download = qrFileName(this.issued().invitation);
    link.click();
  }

  protected async print(): Promise<void> {
    // Opened first, inside the click, so pop-up blockers allow it; filled once the QR is drawn.
    const win = window.open('', '_blank', 'width=520,height=720');
    if (!win) {
      this.snack.open('Allow pop-ups to print the card', undefined, { duration: 4000 });
      return;
    }
    const html = printCardHtml(this.issued(), await qrDataUrl(this.issued().inviteUrl));
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}
