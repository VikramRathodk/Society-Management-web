import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

import { PolicyApi } from '../../core/api/policy.api';
import { AcknowledgementReport as Report, AcknowledgementState } from '../../core/models';
import { confirmDialog } from '../../shared/confirm-dialog';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton, StatCard, StatusPill } from '../../shared/ui';
import { timeAgo } from '../visitors/visitor-ui';

const RESIDENT: Record<string, string> = { OWNER: 'Owner', FAMILY: 'Family', TENANT: 'Tenant' };

/** Per flat, who has accepted a policy; remind the rest, export the list (committee and above). */
@Component({
  selector: 'app-acknowledgement-report',
  imports: [
    DatePipe,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatCard,
    StatusPill,
  ],
  templateUrl: './acknowledgement-report.html',
  styleUrl: './acknowledgement-report.scss',
})
export class AcknowledgementReport {
  private readonly api = inject(PolicyApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly state = signal<AcknowledgementState>('pending');
  protected readonly report = signal<Report | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly attempt = signal(0);

  protected readonly timeAgo = timeAgo;
  protected readonly resident = (type: string | null) => RESIDENT[type ?? 'OWNER'];
  protected readonly states: { value: AcknowledgementState; label: string }[] = [
    { value: 'pending', label: 'Not yet' },
    { value: 'done', label: 'Accepted' },
    { value: 'all', label: 'All flats' },
  ];
  protected readonly percent = computed(() => {
    const r = this.report();
    return r && r.totalFlats ? Math.round((r.doneFlats / r.totalFlats) * 100) : 0;
  });

  constructor() {
    toObservable(computed(() => [this.id(), this.state(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([id, state]) =>
          this.api.acknowledgements(id, state).pipe(
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(
                err.status === 409
                  ? "This policy doesn't ask residents to accept it, or isn't in force."
                  : "Couldn't load who has accepted.",
              );
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((report) => {
        if (report) this.loadError.set(null);
        this.report.set(report);
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected setState(state: AcknowledgementState | null): void {
    if (state) this.state.set(state);
  }

  protected remind(): void {
    const r = this.report();
    if (!r) return;
    confirmDialog(this.dialog, {
      title: 'Remind flats that haven’t accepted?',
      message: `A notification goes to everyone in the ${r.pendingFlats} flats still to accept, except flats reminded recently.`,
      confirmText: 'Send reminders',
    })
      .pipe(
        filter(Boolean),
        tap(() => this.busy.set(true)),
        switchMap(() => this.api.remind(r.policyId)),
      )
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          const parts = [`Reminded ${result.reminded} ${result.reminded === 1 ? 'flat' : 'flats'}`];
          if (result.skipped) parts.push(`${result.skipped} reminded recently`);
          this.snack.open(parts.join(' · '), undefined, { duration: 4000 });
          this.retry();
        },
        error: () => this.busy.set(false),
      });
  }

  protected export(): void {
    this.api
      .exportAcknowledgements(this.id())
      .subscribe((res) => saveResponse(res, `policy-${this.id()}-acknowledgements.csv`));
  }
}
