import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, map, switchMap } from 'rxjs';

import { InvitationApi } from '../../core/api/invitation.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Invitation } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { dayLabel, invitedAs } from './invitation-ui';

/** Banner over every page while invitations sent to the signed-in user's phone are waiting. */
@Component({
  selector: 'app-pending-invitations',
  imports: [MatButtonModule, MatIconModule],
  template: `
    @for (i of invitations(); track i.id) {
      <div class="banner" role="region" [attr.aria-label]="'Invitation to ' + i.societyName">
        <mat-icon>mail</mat-icon>
        <div class="text">
          <strong>{{ i.invitedByName }} invited you to {{ i.societyName }}</strong>
          <span>as {{ invitedAs(i) }} · valid until {{ dayLabel(i.expiresAt) }}</span>
          @if (errors()[i.id]; as message) {
            <span class="error" role="alert">{{ message }}</span>
          }
        </div>
        <div class="actions">
          <button mat-button type="button" (click)="decline(i)" [disabled]="busy() === i.id">
            Decline
          </button>
          <button mat-flat-button type="button" (click)="accept(i)" [disabled]="busy() === i.id">
            Accept
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 8px;
    }
    :host:empty {
      display: none;
    }
    .banner {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      padding: 12px 16px;
      border-radius: var(--app-radius);
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .text {
      display: flex;
      flex-direction: column;
      flex: 1 1 240px;
      min-width: 0;
      font: var(--mat-sys-body-medium);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .actions {
      display: flex;
      gap: 8px;
    }
  `,
})
export class PendingInvitations {
  private readonly api = inject(InvitationApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly snack = inject(MatSnackBar);

  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly busy = signal<number | null>(null);
  protected readonly errors = signal<Record<number, string>>({});

  protected readonly invitedAs = invitedAs;
  protected readonly dayLabel = dayLabel;

  constructor() {
    this.api.mine().subscribe({
      next: (list) => this.invitations.set(list),
      error: () => {}, // a banner is optional; never bother the user about it
    });
  }

  protected accept(invitation: Invitation): void {
    this.act(
      invitation,
      this.api.acceptMine(invitation.id).pipe(
        // The new role changes what the user may see: reload their access and societies.
        switchMap(() => this.auth.restore()),
        switchMap(() => this.ctx.load()),
        map(() => `You joined ${invitation.societyName}`),
      ),
    );
  }

  protected decline(invitation: Invitation): void {
    this.act(
      invitation,
      this.api.declineMine(invitation.id).pipe(map(() => 'Invitation declined')),
    );
  }

  /** Runs an accept/decline that emits the message to show, then drops the banner. */
  private act(invitation: Invitation, action: Observable<string>): void {
    this.busy.set(invitation.id);
    action.subscribe({
      next: (message) => {
        this.busy.set(null);
        this.invitations.update((list) => list.filter((i) => i.id !== invitation.id));
        this.snack.open(message, undefined, { duration: 4000 });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(null);
        this.errors.update((e) => ({ ...e, [invitation.id]: errorMessage(err) }));
      },
    });
  }
}
