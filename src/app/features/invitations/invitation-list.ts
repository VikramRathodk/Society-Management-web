import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, filter, finalize, of, switchMap, tap } from 'rxjs';

import { InvitationApi } from '../../core/api/invitation.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Invitation, InvitationStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { inviteDialog } from './invite-dialog';
import { INVITATION_STATUS, STATUS_FILTERS, dayLabel, invitedAs } from './invitation-ui';

const PAGE_SIZE = 20;

/** The selected society's invitations, newest first, with "Show QR" (a resend) and cancel. */
@Component({
  selector: 'app-invitation-list',
  imports: [
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatTooltipModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './invitation-list.html',
  styleUrl: './invitation-list.scss',
})
export class InvitationList {
  private readonly api = inject(InvitationApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly filters = STATUS_FILTERS;
  protected readonly statusInfo = INVITATION_STATUS;
  protected readonly invitedAs = invitedAs;
  protected readonly dayLabel = dayLabel;

  protected readonly status = signal<InvitationStatus | null>(null);
  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  /** Id of the invitation whose action is running. */
  protected readonly busy = signal<number | null>(null);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  protected readonly canInvite = computed(() =>
    this.auth.can('USER.INVITE.CREATE', this.ctx.selectedSocietyId()),
  );

  private readonly query = computed(() => {
    const societyId = this.ctx.selectedSocietyId();
    return societyId == null ? null : { societyId, status: this.status() ?? undefined };
  });
  private readonly attempt = signal(0);
  private page = 0;

  constructor() {
    toObservable(computed(() => [this.query(), this.attempt()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.page = 0;
        }),
        switchMap(([query]) =>
          query == null
            ? of([])
            : this.api
                .list(query.societyId, { status: query.status, page: 0, size: PAGE_SIZE })
                .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.invitations.set(list ?? []);
        this.hasMore.set(list?.length === PAGE_SIZE);
        this.loading.set(false);
      });
  }

  protected setStatus(status: InvitationStatus | null): void {
    this.status.set(status);
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected invite(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    inviteDialog(this.dialog, { societyId }).subscribe((issued) => {
      if (issued) this.retry();
    });
  }

  /** The link isn't stored, so showing the QR again makes a new one (the old link stops working). */
  protected showQr(invitation: Invitation): void {
    confirmDialog(this.dialog, {
      title: 'Show the QR code again?',
      message:
        `This makes a new link for ${invitation.name} and starts the expiry again. ` +
        'The link or QR code shared before stops working.',
      confirmText: 'New QR code',
    })
      .pipe(
        filter(Boolean),
        tap(() => this.busy.set(invitation.id)),
        switchMap(() => this.api.resend(invitation.id).pipe(finalize(() => this.busy.set(null)))),
      )
      .subscribe({
        next: (issued) => {
          this.replace(issued.invitation);
          inviteDialog(this.dialog, { societyId: issued.invitation.societyId, issued }).subscribe();
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  protected revoke(invitation: Invitation): void {
    confirmDialog(this.dialog, {
      title: 'Cancel this invitation?',
      message: `${invitation.name}'s link stops working. You can invite them again later.`,
      confirmText: 'Cancel invitation',
    })
      .pipe(
        filter(Boolean),
        tap(() => this.busy.set(invitation.id)),
        switchMap(() => this.api.revoke(invitation.id).pipe(finalize(() => this.busy.set(null)))),
      )
      .subscribe({
        next: (updated) => {
          this.replace(updated);
          this.snack.open('Invitation cancelled', undefined, { duration: 3000 });
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  protected loadMore(): void {
    const query = this.query();
    if (query == null) return;
    this.loadingMore.set(true);
    this.api
      .list(query.societyId, { status: query.status, page: this.page + 1, size: PAGE_SIZE })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (list) => {
          if (query !== this.query()) return;
          this.page++;
          const seen = new Set(this.invitations().map((i) => i.id));
          this.invitations.update((current) => [
            ...current,
            ...list.filter((i) => !seen.has(i.id)),
          ]);
          this.hasMore.set(list.length === PAGE_SIZE);
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  private replace(updated: Invitation): void {
    this.invitations.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }
}
