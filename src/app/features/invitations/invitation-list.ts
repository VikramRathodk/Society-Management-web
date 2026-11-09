import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { Observable, catchError, filter, finalize, of, switchMap, tap } from 'rxjs';

import { InvitationApi } from '../../core/api/invitation.api';
import { AuthStore } from '../../core/auth/auth.store';
import { FlatInviteOption, Invitation, InvitationStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { inviteDialog } from './invite-dialog';
import {
  INVITATION_STATUS,
  STATUS_FILTERS,
  dayLabel,
  invitedAs,
  statusParam,
} from './invitation-ui';

const PAGE_SIZE = 20;

/**
 * The selected society's invitations, newest first: every one for the committee and above (who also
 * approve residents' invitations), only their own for residents. "Show QR" is a resend.
 */
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

  /** Starts from `?status=`, e.g. an approval push opens "Awaiting approval". */
  protected readonly status = signal<InvitationStatus | null>(
    statusParam(inject(ActivatedRoute).snapshot.queryParamMap.get('status')),
  );
  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  /** Id of the invitation whose action is running. */
  protected readonly busy = signal<number | null>(null);

  /** Committee and above: invite by rank, see and manage everyone's invitations. */
  protected readonly staff = computed(() =>
    this.auth.can('USER.INVITE.CREATE', this.ctx.selectedSocietyId()),
  );
  protected readonly seesAll = computed(() =>
    this.auth.can('USER.INVITE.VIEW', this.ctx.selectedSocietyId()),
  );
  protected readonly canApprove = computed(() =>
    this.auth.can('USER.INVITE.APPROVE', this.ctx.selectedSocietyId()),
  );
  /** A resident's own flats they may invite to (empty when the society doesn't allow it). */
  protected readonly flatOptions = signal<FlatInviteOption[]>([]);
  protected readonly canInvite = computed(() => this.staff() || this.flatOptions().length > 0);
  protected readonly subtitle = computed(() => {
    const name = this.ctx.selectedSociety()?.name ?? null;
    return this.seesAll() ? name : ['Invitations you sent', name].filter(Boolean).join(' · ');
  });

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

    toObservable(this.ctx.selectedSocietyId)
      .pipe(
        switchMap((societyId) =>
          societyId == null
            ? of([])
            : this.api.flatOptions(societyId).pipe(catchError(() => of([]))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((options) => this.flatOptions.set(options));
  }

  /** May the signed-in user resend (Show QR) or cancel it? Residents only their own. */
  protected canManage(invitation: Invitation): boolean {
    return this.staff() || invitation.invitedById === this.auth.user()?.id;
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
    // Staff choose any role they may give; residents one of their own flats.
    const flatOptions = this.staff() ? undefined : this.flatOptions();
    inviteDialog(this.dialog, { societyId, flatOptions }).subscribe((issued) => {
      if (issued) this.retry();
    });
  }

  /** The link isn't stored, so showing the QR again makes a new one (the old link stops working). */
  protected showQr(invitation: Invitation): void {
    this.confirmThen(
      invitation,
      {
        title: 'Show the QR code again?',
        message:
          `This makes a new link for ${invitation.name} and starts the expiry again. ` +
          'The link or QR code shared before stops working.',
        confirmText: 'New QR code',
      },
      this.api.resend(invitation.id),
    ).subscribe({
      next: (issued) => {
        this.replace(issued.invitation);
        inviteDialog(this.dialog, { societyId: issued.invitation.societyId, issued }).subscribe();
      },
      error: () => {}, // reported by the error interceptor
    });
  }

  protected revoke(invitation: Invitation): void {
    this.confirmThen(
      invitation,
      {
        title: 'Cancel this invitation?',
        message: `${invitation.name}'s link stops working. You can invite them again later.`,
        confirmText: 'Cancel invitation',
      },
      this.api.revoke(invitation.id),
    ).subscribe({
      next: (updated) => this.done(updated, 'Invitation cancelled'),
      error: () => {}, // reported by the error interceptor
    });
  }

  protected approve(invitation: Invitation): void {
    this.busy.set(invitation.id);
    this.api
      .approve(invitation.id)
      .pipe(finalize(() => this.busy.set(null)))
      .subscribe({
        next: (updated) =>
          this.done(
            updated,
            `Approved: ${invitation.invitedByName}'s link for ${invitation.name} works now`,
          ),
        error: () => {}, // reported by the error interceptor
      });
  }

  protected reject(invitation: Invitation): void {
    this.confirmThen(
      invitation,
      {
        title: 'Reject this invitation?',
        message: `${invitation.name} won't be able to join through ${invitation.invitedByName}'s link.`,
        confirmText: 'Reject',
      },
      this.api.reject(invitation.id),
    ).subscribe({
      next: (updated) => this.done(updated, 'Invitation rejected'),
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

  /** Asks first; runs the action only on yes, marking the row busy meanwhile. */
  private confirmThen<T>(
    invitation: Invitation,
    question: { title: string; message: string; confirmText: string },
    action: Observable<T>,
  ): Observable<T> {
    return confirmDialog(this.dialog, question).pipe(
      filter(Boolean),
      tap(() => this.busy.set(invitation.id)),
      switchMap(() => action.pipe(finalize(() => this.busy.set(null)))),
    );
  }

  private done(updated: Invitation, message: string): void {
    this.replace(updated);
    this.snack.open(message, undefined, { duration: 3000 });
  }

  private replace(updated: Invitation): void {
    this.invitations.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }
}
