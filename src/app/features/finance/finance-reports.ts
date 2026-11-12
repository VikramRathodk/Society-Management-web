import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, debounceTime, map, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { BalanceSheet, IncomeExpenditure, ReceiptsPayments, TrialBalance } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { dayLabel, inr, todayIso } from '../maintenance/maintenance-ui';
import { FinanceAccess, FinanceTabs, signedInr } from './finance-ui';

export type ReportKind =
  'trial-balance' | 'income-expenditure' | 'receipts-payments' | 'balance-sheet';

type Report =
  | { kind: 'trial-balance'; data: TrialBalance }
  | { kind: 'income-expenditure'; data: IncomeExpenditure }
  | { kind: 'receipts-payments'; data: ReceiptsPayments }
  | { kind: 'balance-sheet'; data: BalanceSheet };

const REPORTS: { value: ReportKind; label: string; asOf: boolean }[] = [
  { value: 'income-expenditure', label: 'Income & Expenditure', asOf: false },
  { value: 'receipts-payments', label: 'Receipts & Payments', asOf: false },
  { value: 'balance-sheet', label: 'Balance sheet', asOf: true },
  { value: 'trial-balance', label: 'Trial balance', asOf: true },
];

/**
 * The financial statements, from the entries in the books. Periods default to the current financial
 * year (not before the books start); "as of" to today. `?report=` picks one.
 */
@Component({
  selector: 'app-finance-reports',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    FinanceTabs,
  ],
  templateUrl: './finance-reports.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
})
export class FinanceReports {
  private readonly api = inject(FinanceApi);
  private readonly router = inject(Router);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(FinanceAccess);
  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly dayLabel = dayLabel;
  protected readonly reports = REPORTS;
  protected readonly today = todayIso();

  private readonly route = inject(ActivatedRoute);
  protected readonly kind = signal<ReportKind>(
    (this.route.snapshot.queryParamMap.get('report') as ReportKind) || 'income-expenditure',
  );
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly asOf = signal(todayIso());
  protected readonly report = signal<Report | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly usesAsOf = computed(
    () => REPORTS.find((r) => r.value === this.kind())?.asOf ?? false,
  );
  protected readonly title = computed(
    () => REPORTS.find((r) => r.value === this.kind())?.label ?? '',
  );
  protected readonly societyName = computed(() => this.ctx.selectedSociety()?.name ?? null);
  private readonly attempt = signal(0);

  constructor() {
    toObservable(
      computed(
        () =>
          [
            this.ctx.selectedSocietyId(),
            this.kind(),
            this.from(),
            this.to(),
            this.asOf(),
            this.attempt(),
          ] as const,
      ),
    )
      .pipe(
        debounceTime(100),
        tap(() => this.loading.set(true)),
        switchMap(([societyId, kind, from, to, asOf]) =>
          societyId == null
            ? of(null)
            : this.load(societyId, kind, from || null, to || null, asOf || null).pipe(
                catchError(() => of(undefined)),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((report) => {
        this.loadError.set(report === undefined);
        this.report.set(report ?? null);
        if (report && 'from' in report.data && !this.from()) {
          this.from.set(report.data.from);
          this.to.set(report.data.to);
        }
        this.loading.set(false);
      });
  }

  private load(
    societyId: number,
    kind: ReportKind,
    from: string | null,
    to: string | null,
    asOf: string | null,
  ): Observable<Report> {
    switch (kind) {
      case 'trial-balance':
        return this.api.trialBalance(societyId, asOf).pipe(map((data) => ({ kind, data })));
      case 'income-expenditure':
        return this.api
          .incomeExpenditure(societyId, { from, to })
          .pipe(map((data) => ({ kind, data })));
      case 'receipts-payments':
        return this.api
          .receiptsPayments(societyId, { from, to })
          .pipe(map((data) => ({ kind, data })));
      case 'balance-sheet':
        return this.api.balanceSheet(societyId, asOf).pipe(map((data) => ({ kind, data })));
    }
  }

  protected choose(kind: ReportKind): void {
    this.kind.set(kind);
    this.router.navigate([], { queryParams: { report: kind }, replaceUrl: true });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected export(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    const query = this.usesAsOf()
      ? { asOf: this.asOf() || null }
      : { from: this.from() || null, to: this.to() || null };
    this.api
      .exportReport(societyId, this.kind(), query)
      .subscribe((res) => saveResponse(res, `${this.kind()}.csv`));
  }

  protected print(): void {
    window.print();
  }
}
