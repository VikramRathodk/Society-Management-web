import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { Bill, BillStatus, BillingCycle } from '../../core/models';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatCard, StatusPill } from '../../shared/ui';
import {
  BILL_STATUS,
  CYCLE_STATUS,
  MaintenanceAccess,
  dayLabel,
  flatLabel,
  inr,
  paidPercent,
  periodLabel,
  reasonDialog,
} from './maintenance-ui';

/** Bills shown on the cycle page; the full list is one click away. */
const BILLS_SHOWN = 100;
const STATUS_ORDER: readonly BillStatus[] = ['UNPAID', 'PARTIAL', 'PAID', 'WAIVED', 'CANCELLED'];

/** One billing cycle: collection totals, its bills, CSV export and cancel. */
@Component({
  selector: 'app-cycle-detail',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatCard,
    StatusPill,
  ],
  templateUrl: './cycle-detail.html',
  styleUrl: './maintenance.scss',
})
export class CycleDetail {
  private readonly api = inject(MaintenanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly access = inject(MaintenanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly flatLabel = flatLabel;
  protected readonly billStatus = BILL_STATUS;

  protected readonly cycle = signal<BillingCycle | null>(null);
  protected readonly bills = signal<Bill[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  protected readonly exporting = signal(false);
  private readonly attempt = signal(0);

  protected readonly title = computed(() => {
    const c = this.cycle();
    if (!c) return 'Billing cycle';
    return c.kind === 'OPENING_BALANCE'
      ? 'Opening balances'
      : periodLabel(c.periodStart, c.periodEnd);
  });
  protected readonly status = computed(() => {
    const c = this.cycle();
    return c ? CYCLE_STATUS[c.status] : null;
  });
  protected readonly collected = computed(() => {
    const c = this.cycle();
    return c ? paidPercent(c.totalPaid, c.totalBilled) : 0;
  });
  protected readonly statusCounts = computed(() => {
    const counts = this.cycle()?.billsByStatus ?? {};
    return STATUS_ORDER.filter((s) => counts[s]).map((s) => ({ status: s, count: counts[s]! }));
  });
  protected readonly more = computed(() => (this.cycle()?.billCount ?? 0) > this.bills().length);

  constructor() {
    const id = inject(ActivatedRoute).paramMap.pipe(map((p) => Number(p.get('id'))));
    toObservable(this.attempt)
      .pipe(
        switchMap(() => id),
        tap(() => this.loading.set(true)),
        switchMap((cycleId) =>
          this.api.cycle(cycleId).pipe(
            switchMap((cycle) =>
              this.api
                .bills({ societyId: cycle.societyId, cycleId, size: BILLS_SHOWN })
                .pipe(map((bills) => ({ cycle, bills, error: null }))),
            ),
            catchError((err: HttpErrorResponse) =>
              of({
                cycle: null,
                bills: [] as Bill[],
                error:
                  err.status === 404 || err.status === 403
                    ? ('missing' as const)
                    : ('failed' as const),
              }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ cycle, bills, error }) => {
        this.cycle.set(cycle);
        this.bills.set(bills);
        this.loadError.set(error);
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected export(): void {
    const c = this.cycle();
    if (!c || this.exporting()) return;
    this.exporting.set(true);
    this.api.exportCycle(c.id).subscribe({
      next: (res) => {
        this.exporting.set(false);
        saveResponse(res, 'maintenance-bills.csv');
      },
      error: () => this.exporting.set(false),
    });
  }

  protected cancel(): void {
    const c = this.cycle();
    if (!c) return;
    reasonDialog(this.dialog, {
      title: `Cancel ${this.title()}`,
      message:
        'All its bills are cancelled and the period can be billed again. A cycle with payments on it ' +
        "can't be cancelled; void those payments first.",
      label: 'Reason',
      confirmText: 'Cancel cycle',
      save: (reason) => this.api.cancelCycle(c.id, reason),
    }).subscribe(() => {
      this.snack.open('Billing cycle cancelled', undefined, { duration: 3000 });
      this.retry();
    });
  }
}
