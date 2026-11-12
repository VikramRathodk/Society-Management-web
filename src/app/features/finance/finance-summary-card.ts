import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { FinanceSummary } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { Section } from '../../shared/ui';
import { inr } from '../maintenance/maintenance-ui';

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });

/**
 * The society's monthly income and expenditure, for residents, when the society shares it. Renders
 * nothing otherwise (the request is quiet: a 403 just means it isn't shared).
 */
@Component({
  selector: 'app-finance-summary-card',
  imports: [Section],
  template: `
    @if (summary(); as s) {
      @if (s.months.length) {
        <app-section
          title="Society finances"
          subtitle="Totals for this financial year, as kept by the committee"
        >
          <div class="months">
            <div class="head">
              <span>Month</span><span class="num">Income</span><span class="num">Expenditure</span
              ><span class="num">Cash &amp; bank</span>
            </div>
            @for (m of s.months; track m.month) {
              <div class="month">
                <span>{{ label(m.month) }}</span>
                <span class="num">{{ inr(m.totalIncome) }}</span>
                <span class="num">{{ inr(m.totalExpenditure) }}</span>
                <span class="num">{{ inr(m.closingCashAndBank) }}</span>
              </div>
            }
          </div>
          @if (latest(); as m) {
            <p class="split">
              @for (e of m.expenditure; track e.name) {
                <span>{{ e.name }} {{ inr(e.amount) }}</span>
              }
            </p>
          }
        </app-section>
      }
    }
  `,
  styles: `
    .months {
      padding: 0 16px 8px;
      font-variant-numeric: tabular-nums;
    }
    .head,
    .month {
      display: grid;
      grid-template-columns: 1fr repeat(3, minmax(90px, auto));
      gap: 12px;
      padding: 6px 0;
    }
    .head {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .month + .month {
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .num {
      text-align: right;
    }
    .split {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 0;
      padding: 0 16px 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class FinanceSummaryCard {
  private readonly api = inject(FinanceApi);
  private readonly ctx = inject(SocietyContextStore);
  protected readonly inr = inr;
  protected readonly summary = signal<FinanceSummary | null>(null);
  /** The latest month's expenditure split, as a hint of where the money goes. */
  protected readonly latest = computed(() => this.summary()?.months.at(-1) ?? null);

  constructor() {
    toObservable(this.ctx.selectedSocietyId)
      .pipe(
        switchMap((societyId) =>
          societyId == null
            ? of(null)
            : this.api.summary(societyId, {}, { silent: true }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((s) => this.summary.set(s));
  }

  protected label(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return MONTH.format(new Date(y, m - 1, 1));
  }
}
