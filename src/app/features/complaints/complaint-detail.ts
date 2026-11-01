import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { catchError, filter, forkJoin, of, switchMap, tap } from 'rxjs';

import { ComplaintApi } from '../../core/api/complaint.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Complaint, ComplaintActivity } from '../../core/models';
import { PushService } from '../../core/push';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, StatusPill, Skeleton } from '../../shared/ui';
import { timeAgo } from '../visitors/visitor-ui';
import {
  COMPLAINT_STATUS,
  EDITABLE_STATUSES,
  MOVES,
  MoveOption,
  categoryOf,
  editComplaintDialog,
  moveDialog,
} from './complaint-ui';

/** One complaint: details, what the current user can do with it, and its timeline. */
@Component({
  selector: 'app-complaint-detail',
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    Skeleton,
    EmptyState,
    PageHeader,
    Section,
    StatusPill,
  ],
  templateUrl: './complaint-detail.html',
  styleUrl: './complaint-detail.scss',
})
export class ComplaintDetail {
  private readonly api = inject(ComplaintApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly complaint = signal<Complaint | null>(null);
  protected readonly activity = signal<ComplaintActivity[]>([]);
  protected readonly loading = signal(true);
  /** 'missing' for 404/403, 'failed' for anything else. */
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  protected readonly busy = signal(false);
  protected readonly timeAgo = timeAgo;
  protected readonly statusOf = (status: Complaint['status']) => COMPLAINT_STATUS[status];

  protected readonly status = computed(() => {
    const c = this.complaint();
    return c ? COMPLAINT_STATUS[c.status] : null;
  });
  protected readonly category = computed(() => {
    const c = this.complaint();
    return c ? categoryOf(c.category) : null;
  });
  /** Status changes this user may make now (the committee, by permission in the society). */
  protected readonly moves = computed<MoveOption[]>(() => {
    const c = this.complaint();
    if (!c) return [];
    return MOVES[c.status].filter((m) => this.auth.can(m.permission, c.societyId));
  });
  /** Only the author edits or withdraws, and only until it is resolved. */
  protected readonly isAuthor = computed(
    () => this.complaint()?.raisedById === this.auth.user()?.id,
  );
  protected readonly editable = computed(() => {
    const c = this.complaint();
    return !!c && this.isAuthor() && EDITABLE_STATUSES.includes(c.status);
  });
  protected readonly canEdit = computed(
    () => this.editable() && this.auth.can('COMPLAINT.TICKET.UPDATE', this.complaint()!.societyId),
  );
  protected readonly canWithdraw = computed(
    () => this.editable() && this.auth.can('COMPLAINT.TICKET.DELETE', this.complaint()!.societyId),
  );
  /** Newest step first reads best on a page that already shows the current status. */
  protected readonly timeline = computed(() => [...this.activity()].reverse());

  private readonly attempt = signal(0);

  constructor() {
    toObservable(computed(() => [this.id(), this.attempt()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadError.set(null);
        }),
        switchMap(([id]) =>
          forkJoin({ complaint: this.api.get(id), activity: this.api.activity(id) }).pipe(
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(err.status === 404 || err.status === 403 ? 'missing' : 'failed');
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (result) {
          this.complaint.set(result.complaint);
          this.activity.set(result.activity);
        }
        this.loading.set(false);
      });

    // Someone else changed this complaint: reload in place (the page stays up while it loads).
    inject(PushService)
      .messages$.pipe(
        filter((m) => m.data['complaintId'] === String(this.id())),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.retry());
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected stepLabel(step: ComplaintActivity): string {
    if (step.fromStatus == null) return 'Raised';
    if (step.toStatus === 'OPEN') return 'Reopened';
    if (step.toStatus === 'IN_PROGRESS') return 'Work started';
    return COMPLAINT_STATUS[step.toStatus].label;
  }

  protected move(option: MoveOption): void {
    const complaint = this.complaint();
    if (!complaint) return;
    // Re-fetch on close either way: a failed move (409) means someone else changed it.
    moveDialog(this.dialog, { complaint, option }).subscribe((updated) => {
      if (updated) {
        const label = COMPLAINT_STATUS[updated.status].label.toLowerCase();
        this.snack.open(`Complaint marked ${label}`, undefined, { duration: 3000 });
      }
      this.retry();
    });
  }

  protected edit(): void {
    const complaint = this.complaint();
    if (!complaint) return;
    editComplaintDialog(this.dialog, complaint)
      .pipe(filter(Boolean))
      .subscribe((updated) => this.complaint.set(updated));
  }

  protected withdraw(): void {
    const complaint = this.complaint();
    if (!complaint) return;
    confirmDialog(this.dialog, {
      title: 'Withdraw complaint',
      message: 'Withdraw this complaint? It and its history will be removed.',
      confirmText: 'Withdraw',
    })
      .pipe(
        filter(Boolean),
        tap(() => this.busy.set(true)),
        switchMap(() => this.api.withdraw(complaint.id)),
      )
      .subscribe({
        next: () => {
          this.snack.open('Complaint withdrawn', undefined, { duration: 3000 });
          this.router.navigate(['/complaints']);
        },
        error: () => {
          this.busy.set(false);
          this.retry(); // reported by the error interceptor; e.g. it was resolved meanwhile
        },
      });
  }
}
