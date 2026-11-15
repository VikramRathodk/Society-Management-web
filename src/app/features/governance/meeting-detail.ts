import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { Observable, catchError, filter, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { GovernanceApi } from '../../core/api/governance.api';
import { AuthStore } from '../../core/auth/auth.store';
import { AgendaItem, Meeting, Minutes, RsvpResponse } from '../../core/models';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { RulesText, fileSize } from '../policies/policy-ui';
import {
  MEETING_KIND,
  MEETING_STATUS,
  OUTCOME,
  adjournDialog,
  daysUntil,
  openVotingDialog,
  reasonDialog,
  turnoutText,
  voteDialog,
} from './governance-ui';

/**
 * One meeting: when and where, the agenda with its resolutions and voting, replies, and the minutes.
 * The organisers also prepare, announce, cancel, adjourn and run it from here.
 */
@Component({
  selector: 'app-meeting-detail',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatMenuModule,
    EmptyState,
    PageHeader,
    RulesText,
    Section,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './meeting-detail.html',
  styleUrl: './meeting-detail.scss',
})
export class MeetingDetail {
  private readonly api = inject(GovernanceApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly meeting = signal<Meeting | null>(null);
  protected readonly minutes = signal<Minutes | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  protected readonly busy = signal(false);
  private readonly attempt = signal(0);

  protected readonly kinds = MEETING_KIND;
  protected readonly status = MEETING_STATUS;
  protected readonly outcomes = OUTCOME;
  protected readonly fileSize = fileSize;
  protected readonly turnoutText = turnoutText;

  private readonly can = (p: string) => this.auth.can(p, this.meeting()?.societyId ?? null);
  protected readonly organises = computed(() => this.can('GOVERNANCE.MEETING.CREATE'));
  protected readonly announces = computed(() => this.can('GOVERNANCE.MEETING.UPDATE'));
  protected readonly runs = computed(() => this.can('GOVERNANCE.MINUTES.CREATE'));
  protected readonly approvesMinutes = computed(() => this.can('GOVERNANCE.MINUTES.APPROVE'));

  /** On or after the meeting's day, while it is announced or held. */
  protected readonly inSession = computed(() => {
    const m = this.meeting();
    return (
      !!m && (m.status === 'HELD' || (m.status === 'NOTICE_SENT' && daysUntil(m.scheduledAt) <= 0))
    );
  });
  protected readonly upcoming = computed(() => {
    const m = this.meeting();
    return !!m && m.status === 'NOTICE_SENT' && new Date(m.scheduledAt) > new Date();
  });
  protected readonly myMinutesDraft = computed(
    () => this.minutes()?.draftedBy.id === this.auth.user()?.id,
  );

  constructor() {
    toObservable(computed(() => [this.id(), this.attempt()] as const))
      .pipe(
        tap(() => this.loadError.set(null)),
        switchMap(([id]) =>
          forkJoin({
            meeting: this.api.get(id),
            minutes: this.api.minutes(id).pipe(catchError(() => of(null))),
          }).pipe(
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(err.status === 404 || err.status === 403 ? 'missing' : 'failed');
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        this.meeting.set(result?.meeting ?? null);
        this.minutes.set(result?.minutes ?? null);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  // ---- Everyone ----

  protected reply(response: RsvpResponse): void {
    const m = this.meeting();
    if (!m) return;
    this.run(this.api.rsvp(m.id, response));
  }

  protected vote(item: AgendaItem): void {
    const flats = item.yourFlats.filter((f) => !f.voted).map((f) => ({ id: f.id, label: f.label }));
    voteDialog<Meeting>(this.dialog, {
      item,
      flats,
      submit: (choice, flatId) => this.api.vote(item.id, choice, flatId),
    })
      .pipe(filter(Boolean))
      .subscribe((m) => {
        this.meeting.set(m);
        this.snack.open('Your vote is cast', undefined, { duration: 3000 });
      });
  }

  // ---- Organisers ----

  protected sendNotice(): void {
    const m = this.meeting();
    if (!m) return;
    const days = daysUntil(m.scheduledAt);
    if (days < m.noticeDays) {
      reasonDialog<Meeting>(this.dialog, {
        title: 'Short notice',
        message: `The notice period for this kind of meeting is ${m.noticeDays} days and it is in ${days}. Say why it can't wait; the reason is kept with the meeting.`,
        label: 'Reason for the short notice',
        confirmText: 'Send notice',
        submit: (reason) => this.api.sendNotice(m.id, reason),
      })
        .pipe(filter(Boolean))
        .subscribe((saved) => this.done(saved, 'Notice sent'));
      return;
    }
    confirmDialog(this.dialog, {
      title: 'Send the notice?',
      message: m.general
        ? 'Every member is told about the meeting and its agenda. The agenda can no longer be changed.'
        : 'The committee is told about the meeting and its agenda. The agenda can no longer be changed.',
      confirmText: 'Send notice',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.sendNotice(m.id)),
      )
      .subscribe({ next: (saved) => this.done(saved, 'Notice sent'), error: () => this.retry() });
  }

  protected remove(): void {
    const m = this.meeting();
    if (!m) return;
    confirmDialog(this.dialog, {
      title: 'Delete this draft?',
      message: m.title,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.delete(m.id)),
      )
      .subscribe(() => this.router.navigate(['/meetings'], { queryParams: { view: 'drafts' } }));
  }

  protected cancel(): void {
    const m = this.meeting();
    if (!m) return;
    reasonDialog<Meeting>(this.dialog, {
      title: 'Cancel the meeting?',
      message: 'Everyone invited is told, with your reason.',
      label: 'Reason',
      confirmText: 'Cancel meeting',
      submit: (reason) => this.api.cancel(m.id, reason),
    })
      .pipe(filter(Boolean))
      .subscribe((saved) => this.done(saved, 'Meeting cancelled'));
  }

  protected adjourn(): void {
    const m = this.meeting();
    if (!m) return;
    adjournDialog<Meeting>(this.dialog, {
      title: m.title,
      after: m.scheduledAt,
      place: m.place,
      onlineLink: m.onlineLink,
      submit: (request) => this.api.adjourn(m.id, request),
    })
      .pipe(filter(Boolean))
      .subscribe((next) => {
        this.snack.open('Adjourned; the new meeting is announced', undefined, { duration: 3000 });
        this.router.navigate(['/meetings', next.id]);
      });
  }

  protected markHeld(): void {
    const m = this.meeting();
    if (!m) return;
    confirmDialog(this.dialog, {
      title: 'Mark the meeting held?',
      message:
        'The member count and quorum are frozen. Attendance can still be corrected afterwards.',
      confirmText: 'Mark held',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.hold(m.id)),
      )
      .subscribe({ next: (saved) => this.done(saved, 'Marked held'), error: () => this.retry() });
  }

  protected openVoting(item: AgendaItem): void {
    const m = this.meeting();
    if (!m) return;
    this.api
      .attendance(m.id)
      .pipe(
        catchError(() => of(null)),
        map((sheet) => sheet?.people.map((p) => p.user) ?? []),
        switchMap((people) =>
          openVotingDialog<Meeting>(this.dialog, {
            item,
            people,
            submit: (proposedBy, secondedBy) =>
              this.api.openVoting(item.id, proposedBy, secondedBy),
          }),
        ),
        filter(Boolean),
      )
      .subscribe((saved) => this.done(saved, 'Voting is open'));
  }

  protected closeVoting(item: AgendaItem): void {
    confirmDialog(this.dialog, {
      title: 'Close voting?',
      message: `${item.title}: the result is counted now and can't be changed.`,
      confirmText: 'Close and count',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.closeVoting(item.id)),
      )
      .subscribe({ next: (saved) => this.done(saved, 'Voting closed'), error: () => this.retry() });
  }

  protected defer(item: AgendaItem): void {
    confirmDialog(this.dialog, {
      title: 'Defer this item?',
      message: `${item.title} is recorded as deferred and isn't voted on.`,
      confirmText: 'Defer',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.defer(item.id)),
      )
      .subscribe({ next: (saved) => this.done(saved, 'Deferred'), error: () => this.retry() });
  }

  // ---- Minutes ----

  protected openMinutesFile(): void {
    const m = this.meeting();
    if (!m) return;
    this.api.minutesAttachment(m.id).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  protected submitMinutes(): void {
    const m = this.meeting();
    if (m) this.minutesRun(this.api.submitMinutes(m.id), 'Sent for approval');
  }

  protected approveMinutes(): void {
    const m = this.meeting();
    if (!m) return;
    confirmDialog(this.dialog, {
      title: 'Approve and publish the minutes?',
      message: m.general ? 'Every member can read them.' : 'The committee can read them.',
      confirmText: 'Approve and publish',
    })
      .pipe(filter(Boolean))
      .subscribe(() => this.minutesRun(this.api.approveMinutes(m.id), 'Minutes published', true));
  }

  protected sendBackMinutes(): void {
    const m = this.meeting();
    if (!m) return;
    reasonDialog<Minutes>(this.dialog, {
      title: 'Send the minutes back',
      label: 'What should change',
      confirmText: 'Send back',
      submit: (reason) => this.api.sendBackMinutes(m.id, reason),
    })
      .pipe(filter(Boolean))
      .subscribe((saved) => this.minutes.set(saved));
  }

  protected addCorrection(): void {
    const m = this.meeting();
    if (!m) return;
    reasonDialog<Minutes>(this.dialog, {
      title: 'Add a correction',
      message:
        'Published minutes are never edited; the correction is added below them with today’s date.',
      label: 'Correction',
      confirmText: 'Add',
      maxLength: 4000,
      submit: (text) => this.api.addAddendum(m.id, text),
    })
      .pipe(filter(Boolean))
      .subscribe((saved) => this.minutes.set(saved));
  }

  protected announceMinutes(): void {
    const m = this.meeting();
    if (m) this.minutesRun(this.api.announceMinutes(m.id), 'Posted on the notice board');
  }

  // ---- Helpers ----

  private run(request: Observable<Meeting>): void {
    this.busy.set(true);
    request.subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.meeting.set(saved);
      },
      error: () => {
        this.busy.set(false);
        this.retry();
      },
    });
  }

  private minutesRun(request: Observable<Minutes>, message: string, reloadMeeting = false): void {
    this.busy.set(true);
    request.subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.minutes.set(saved);
        this.snack.open(message, undefined, { duration: 3000 });
        if (reloadMeeting) this.retry();
      },
      error: () => this.busy.set(false),
    });
  }

  private done(saved: Meeting, message: string): void {
    this.meeting.set(saved);
    this.snack.open(message, undefined, { duration: 3000 });
  }
}
