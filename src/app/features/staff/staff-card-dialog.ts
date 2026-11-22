import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { catchError, forkJoin, of } from 'rxjs';

import { StaffApi } from '../../core/api/staff.api';
import { Staff, StaffCard } from '../../core/models';
import { Skeleton } from '../../shared/ui';
import { blobToDataUrl, cardFlats, cardQr, cardRole, printInPage, staffCardDocument } from './staff-ui';

/**
 * The ID card shown in the portal: a preview of exactly what prints, with Print (the browser's print
 * dialog, from the page itself) and Close. Nothing opens in a new tab.
 */
@Component({
  selector: 'app-staff-card-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, Skeleton],
  template: `
    <h2 mat-dialog-title>ID card</h2>
    <mat-dialog-content>
      @if (failed()) {
        <p class="error" role="alert">The card couldn't be loaded.</p>
      } @else if (card(); as c) {
        <div class="card" aria-label="ID card preview">
          <p class="society">{{ c.societyName }}</p>
          @if (photo(); as src) {
            <img class="photo" [src]="src" alt="" />
          }
          <p class="name">{{ c.name }}</p>
          <p class="role">{{ role(c) }}</p>
          @if (flats(c); as f) {
            <p class="flats">{{ f }}</p>
          }
          @if (qr(); as src) {
            <img class="qr" [src]="src" alt="QR code for the gate" />
          }
          <p class="code">{{ c.entryCode }}</p>
          <p class="hint">Show at the gate, or say this code</p>
        </div>
        @if (c.status !== 'VERIFIED' || c.blocked) {
          <p class="warn">{{ c.blocked ? 'Blocked: the gate will refuse this card.' : 'Not verified yet: the gate will refuse this card until the committee verifies them.' }}</p>
        }
      } @else {
        <app-skeleton variant="form" />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
      <button mat-flat-button (click)="print()" [disabled]="!card() || !qr()">
        <mat-icon>print</mat-icon>
        Print
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .card {
      width: 86mm;
      max-width: 100%;
      box-sizing: border-box;
      margin: 0 auto;
      padding: 16px;
      border: 1px solid #d6c8b8;
      border-radius: 12px;
      background: #fff;
      color: #1f1b16;
      text-align: center;
    }
    .society {
      margin: 0 0 12px;
      font-size: 15px;
      font-weight: 700;
    }
    .photo {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      background: #eee;
    }
    .name {
      margin: 10px 0 2px;
      font-size: 20px;
      font-weight: 700;
    }
    .role,
    .flats {
      margin: 0;
      color: #52443a;
      font-size: 13px;
    }
    .qr {
      width: 150px;
      height: 150px;
      margin-top: 10px;
      image-rendering: pixelated;
    }
    .code {
      margin: 4px 0 0;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: 6px;
      font-variant-numeric: tabular-nums;
    }
    .hint {
      margin: 2px 0 0;
      color: #52443a;
      font-size: 11px;
    }
    .warn,
    .error {
      margin: 12px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class StaffCardDialog {
  private readonly staff = inject<Pick<Staff, 'id' | 'photoUrl'>>(MAT_DIALOG_DATA);
  protected readonly card = signal<StaffCard | null>(null);
  protected readonly photo = signal<string | null>(null);
  protected readonly qr = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly role = cardRole;
  protected readonly flats = cardFlats;

  constructor() {
    const api = inject(StaffApi);
    forkJoin({
      card: api.card(this.staff.id),
      photo: this.staff.photoUrl ? api.photo(this.staff.id).pipe(catchError(() => of(null))) : of(null),
    }).subscribe({
      next: async ({ card, photo }) => {
        this.card.set(card);
        if (photo) this.photo.set(await blobToDataUrl(photo));
        this.qr.set(await cardQr(card));
      },
      error: () => this.failed.set(true),
    });
  }

  protected print(): void {
    const card = this.card();
    const qr = this.qr();
    if (card && qr) printInPage(staffCardDocument(card, this.photo(), qr));
  }
}

export function openStaffCard(dialog: MatDialog, staff: Pick<Staff, 'id' | 'photoUrl'>): void {
  dialog.open(StaffCardDialog, { data: staff, width: '420px', maxWidth: '95vw' });
}
