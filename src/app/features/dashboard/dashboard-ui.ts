/**
 * Dashboard building blocks: the committee's money-at-a-glance strip. Self-loading, quiet on
 * failure (an inline "Couldn't load" with a retry), and renders nothing when there is no data to show.
 */
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Observable, catchError, combineLatest, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { MaintenanceApi } from '../../core/api/maintenance.api';
import { AuthStore } from '../../core/auth/auth.store';
import { BillingCycle, FinanceSummary, FlatDues, MonthSummary } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { MaintenanceAccess, paidPercent, periodLabel } from '../maintenance/maintenance-ui';

const WHOLE_RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });

/** "₹1,86,000": whole rupees, Indian grouping. Glance numbers don't need paise. */
export function rupees(amount: number): string {
  return WHOLE_RUPEES.format(amount);
}

function monthDate(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

/** Percentage change, or null when there is nothing to compare with. */
export function change(current: number, previous: number | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

/** The newest issued regular cycle: "this month's bills". */
export function latestCycle(cycles: BillingCycle[]): BillingCycle | null {
  return cycles.find((c) => c.status === 'ISSUED' && c.kind === 'REGULAR') ?? null;
}

interface Glance {
  /** Undefined when not permitted, null when it failed. */
  summary?: FinanceSummary | null;
  cycles?: BillingCycle[] | null;
}

interface Tile {
  label: string;
  value: string;
  icon: string;
  /** +12 / -5, against the previous month. */
  delta: number | null;
  /** Whether a rise is good news (income) or not (spending). */
  riseIsGood: boolean;
  tone?: 'positive' | 'negative';
  link: string;
}

/**
 * Income, spending, surplus and cash + bank for the latest month in the books, and how much of the
 * latest bill cycle is collected. Each half shows up when the user may see it and it has data.
 */
@Component({
  selector: 'app-money-glance',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    @if (loading()) {
      <div class="tiles" aria-busy="true">
        @for (t of [0, 1, 2, 3]; track t) {
          <div class="tile">
            <span class="sk-bar" style="width: 50%"></span>
            <span class="sk-bar" style="width: 70%; height: 26px"></span>
            <span class="sk-bar" style="width: 40%; height: 10px"></span>
          </div>
        }
      </div>
    } @else if (failed()) {
      <div class="failed" role="alert">
        <mat-icon aria-hidden="true">cloud_off</mat-icon>
        <span>Couldn't load the money summary.</span>
        <button mat-button (click)="retry()">Try again</button>
      </div>
    } @else {
      @if (tiles().length) {
        <section class="tiles" [attr.aria-label]="'Money, ' + monthName()">
          @for (t of tiles(); track t.label) {
            <a class="tile" [routerLink]="t.link" [attr.data-tone]="t.tone">
              <span class="label">
                <mat-icon aria-hidden="true">{{ t.icon }}</mat-icon>
                {{ t.label }}
              </span>
              <span class="value">{{ t.value }}</span>
              @if (t.delta !== null) {
                <span
                  class="delta"
                  [class.good]="t.delta === 0 ? false : t.delta > 0 === t.riseIsGood"
                  [class.bad]="t.delta === 0 ? false : t.delta > 0 !== t.riseIsGood"
                >
                  <mat-icon aria-hidden="true">{{
                    t.delta > 0 ? 'trending_up' : t.delta < 0 ? 'trending_down' : 'trending_flat'
                  }}</mat-icon>
                  {{ t.delta > 0 ? '+' : '' }}{{ t.delta }}% vs {{ previousName() }}
                </span>
              } @else {
                <span class="delta">{{ monthName() }}</span>
              }
            </a>
          }
        </section>
      }

      @if (collection(); as c) {
        <a class="collection" [routerLink]="['/maintenance/cycles', c.id]">
          <div class="collection-text">
            <span class="label">{{ c.period }} bills</span>
            <span class="headline">
              <strong>{{ c.paid }} of {{ c.total }}</strong> flats paid
              <span class="muted">· {{ c.collected }} collected</span>
            </span>
          </div>
          <div class="meter-wrap">
            <div
              class="meter"
              role="progressbar"
              [attr.aria-valuenow]="c.percent"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-label]="c.percent + '% of billed amount collected'"
            >
              <span [style.width.%]="c.percent"></span>
            </div>
            <span class="outstanding" [class.has]="c.outstandingAmount > 0">
              {{ c.outstanding }} outstanding
            </span>
          </div>
          <mat-icon class="chevron" aria-hidden="true">chevron_right</mat-icon>
        </a>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
      gap: 12px;
    }
    .tile,
    .collection,
    .failed {
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      color: inherit;
      text-decoration: none;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 16px 18px;
      transition: box-shadow 180ms ease;
    }
    a.tile:hover,
    a.tile:focus-visible,
    .collection:hover,
    .collection:focus-visible {
      box-shadow: var(--app-card-shadow-hover);
    }
    .label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }
    .label mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }
    .value {
      font-family: var(--app-font-display);
      font-size: 1.75rem;
      font-weight: 500;
      line-height: 1.15;
      letter-spacing: -0.02em;
      font-variant-numeric: lining-nums tabular-nums;
    }
    [data-tone='positive'] .value {
      color: var(--app-success);
    }
    [data-tone='negative'] .value {
      color: var(--mat-sys-error);
    }
    .delta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .delta mat-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
    }
    .delta.good {
      color: var(--app-success);
    }
    .delta.bad {
      color: var(--mat-sys-error);
    }
    .collection {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) auto;
      align-items: center;
      gap: 12px 24px;
      padding: 16px 12px 16px 18px;
    }
    .collection-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .headline {
      font: var(--mat-sys-title-medium);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .meter-wrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .meter {
      height: 10px;
      overflow: hidden;
      border-radius: 5px;
      background: var(--mat-sys-surface-container-high);
    }
    .meter span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--app-success);
      transition: width 600ms cubic-bezier(0.2, 0, 0, 1);
    }
    .outstanding {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .outstanding.has {
      color: var(--app-warning);
      font-weight: 600;
    }
    .chevron {
      color: var(--mat-sys-on-surface-variant);
    }
    .failed {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px 10px 18px;
      color: var(--mat-sys-on-surface-variant);
    }
    .failed button {
      margin-left: auto;
    }
    @media (max-width: 599.98px) {
      .collection {
        grid-template-columns: 1fr auto;
      }
      .meter-wrap {
        grid-column: 1 / -1;
        grid-row: 2;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tile,
      .meter span {
        transition: none;
      }
    }
  `,
})
export class MoneyGlance {
  private readonly finance = inject(FinanceApi);
  private readonly maintenance = inject(MaintenanceApi);
  private readonly access = inject(MaintenanceAccess);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);

  /** Society-wide report readers always get the summary (residents only when it's shared). */
  private readonly canReadBooks = computed(() =>
    this.auth.can('FINANCE.REPORT.VIEW', this.ctx.selectedSocietyId()),
  );

  protected readonly loading = signal(true);
  private readonly data = signal<Glance>({});
  private readonly attempt = signal(0);

  /** Only a total failure is shown; if one half loaded, show that half. */
  protected readonly failed = computed(() => {
    const d = this.data();
    const asked = [d.summary, d.cycles].filter((x) => x !== undefined);
    return asked.length > 0 && asked.every((x) => x === null);
  });

  private readonly months = computed<MonthSummary[]>(() => this.data().summary?.months ?? []);
  private readonly latest = computed(() => this.months().at(-1) ?? null);
  private readonly previous = computed(() => this.months().at(-2));

  protected readonly monthName = computed(() => {
    const m = this.latest();
    return m ? MONTH_YEAR.format(monthDate(m.month)) : '';
  });
  protected readonly previousName = computed(() => {
    const m = this.previous();
    return m ? MONTH.format(monthDate(m.month)) : '';
  });

  protected readonly tiles = computed<Tile[]>(() => {
    const m = this.latest();
    if (!m) return [];
    const p = this.previous();
    const surplus = m.totalIncome - m.totalExpenditure;
    const prevSurplus = p ? p.totalIncome - p.totalExpenditure : undefined;
    return [
      {
        label: 'Income',
        icon: 'south_west',
        value: rupees(m.totalIncome),
        delta: change(m.totalIncome, p?.totalIncome),
        riseIsGood: true,
        link: '/finance/reports',
      },
      {
        label: 'Spent',
        icon: 'north_east',
        value: rupees(m.totalExpenditure),
        delta: change(m.totalExpenditure, p?.totalExpenditure),
        riseIsGood: false,
        link: '/finance/reports',
      },
      {
        label: surplus < 0 ? 'Deficit' : 'Surplus',
        icon: 'balance',
        value: rupees(Math.abs(surplus)),
        delta: change(surplus, prevSurplus),
        riseIsGood: true,
        tone: surplus < 0 ? 'negative' : surplus > 0 ? 'positive' : undefined,
        link: '/finance/reports',
      },
      {
        label: 'Cash & bank',
        icon: 'account_balance',
        value: rupees(m.closingCashAndBank),
        delta: change(m.closingCashAndBank, p?.closingCashAndBank),
        riseIsGood: true,
        link: '/finance/reports',
      },
    ];
  });

  protected readonly collection = computed(() => {
    const cycle = latestCycle(this.data().cycles ?? []);
    if (!cycle || cycle.billCount === 0) return null;
    const by = cycle.billsByStatus;
    const total = cycle.billCount - (by.CANCELLED ?? 0) - (by.WAIVED ?? 0);
    return {
      id: cycle.id,
      period: periodLabel(cycle.periodStart, cycle.periodEnd),
      paid: by.PAID ?? 0,
      total,
      percent: paidPercent(cycle.totalPaid, cycle.totalBilled),
      collected: rupees(cycle.totalPaid),
      outstanding: rupees(cycle.totalOutstanding),
      outstandingAmount: cycle.totalOutstanding,
    };
  });

  constructor() {
    combineLatest([toObservable(this.ctx.selectedSocietyId), toObservable(this.attempt)])
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.data.set({});
        }),
        switchMap(([societyId]) => this.load(societyId)),
        takeUntilDestroyed(),
      )
      .subscribe((data) => {
        this.data.set(data);
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private load(societyId: number | null): Observable<Glance> {
    if (societyId == null) return of({});
    // A 403 means "not yours to see" (undefined: hide it), anything else a failure (null).
    const settle = <T>(source: Observable<T>) =>
      source.pipe(
        catchError((err: { status?: number }) => of(err?.status === 403 ? undefined : null)),
      );
    const requests: { [K in keyof Glance]?: Observable<Glance[K]> } = {};
    if (this.canReadBooks()) {
      requests.summary = settle(this.finance.summary(societyId, {}, { silent: true }));
    }
    if (this.access.canIssue()) {
      requests.cycles = settle(this.maintenance.cycles(societyId, { silent: true }));
    }
    return Object.keys(requests).length ? forkJoin(requests).pipe(map((d) => d as Glance)) : of({});
  }
}

/**
 * A resident's own dues, front and centre: what's owed, whether any of it is overdue, and the way to
 * pay. `dues` is undefined while loading and null when it failed.
 */
@Component({
  selector: 'app-dues-spotlight',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    @if (dues() === undefined) {
      <div class="card" aria-busy="true">
        <span class="sk-bar" style="width: 30%"></span>
        <span class="sk-bar" style="width: 45%; height: 32px"></span>
      </div>
    } @else if (dues() === null) {
      <div class="card failed" role="alert">
        <mat-icon aria-hidden="true">cloud_off</mat-icon>
        <span>Couldn't load your dues.</span>
        <button mat-button (click)="retry.emit()">Try again</button>
      </div>
    } @else if (totals(); as t) {
      <div class="card" [attr.data-state]="t.state">
        <span class="icon" aria-hidden="true">
          <mat-icon>{{
            t.state === 'clear' ? 'check_circle' : t.state === 'overdue' ? 'error' : 'receipt_long'
          }}</mat-icon>
        </span>
        <div class="text">
          <span class="label">{{ t.flats > 1 ? 'Your flats' : 'Your flat' }}</span>
          @if (t.state === 'clear') {
            <span class="amount">All paid up</span>
            <span class="sub">
              Nothing due right now.
              @if (t.credit > 0) {
                {{ t.creditLabel }} advance will go towards the next bill.
              }
            </span>
          } @else {
            <span class="amount">{{ t.outstandingLabel }} <small>due</small></span>
            <span class="sub">
              @if (t.overdue > 0) {
                <strong>{{ t.overdueLabel }} overdue</strong> ·
              }
              {{ t.bills }} open {{ t.bills === 1 ? 'bill' : 'bills' }}
              @if (t.credit > 0) {
                · {{ t.creditLabel }} advance
              }
            </span>
          }
        </div>
        @if (t.state === 'clear') {
          <a mat-stroked-button class="pay" routerLink="/maintenance">View bills</a>
        } @else {
          <a mat-flat-button class="pay" routerLink="/maintenance">View &amp; pay</a>
        }
      </div>
    }
  `,
  styles: `
    .card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 16px;
      padding: 20px;
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
    }
    .card[aria-busy] {
      display: flex;
      flex-direction: column;
      align-items: stretch;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    [data-state='clear'] .icon {
      background: var(--app-success-container);
      color: var(--app-success);
    }
    [data-state='overdue'] {
      border-color: color-mix(in srgb, var(--mat-sys-error) 30%, transparent);
    }
    [data-state='overdue'] .icon {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .label {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }
    .amount {
      font-family: var(--app-font-display);
      font-size: 1.75rem;
      font-weight: 500;
      line-height: 1.2;
      letter-spacing: -0.02em;
      font-variant-numeric: lining-nums tabular-nums;
    }
    .amount small {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-large);
    }
    .sub {
      color: var(--mat-sys-on-surface-variant);
    }
    [data-state='overdue'] strong {
      color: var(--mat-sys-error);
    }
    .pay {
      --mat-button-filled-container-height: 48px;
      --mat-button-outlined-container-height: 48px;
      padding-inline: 24px;
    }
    .failed {
      display: flex;
      color: var(--mat-sys-on-surface-variant);
    }
    .failed button {
      margin-left: auto;
    }
    @media (max-width: 599.98px) {
      .card {
        grid-template-columns: auto minmax(0, 1fr);
      }
      .pay {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class DuesSpotlight {
  readonly dues = input<FlatDues[] | null | undefined>(undefined);
  readonly retry = output<void>();

  protected readonly totals = computed(() => {
    const dues = this.dues();
    if (!dues) return null;
    const add = (pick: (d: FlatDues) => number) =>
      Math.round(dues.reduce((total, d) => total + pick(d), 0) * 100) / 100;
    const outstanding = add((d) => d.outstanding);
    const overdue = add((d) => d.overdue);
    const credit = add((d) => d.credit);
    return {
      flats: dues.length,
      bills: dues.reduce((n, d) => n + d.openBills, 0),
      outstanding,
      overdue,
      credit,
      outstandingLabel: rupees(outstanding),
      overdueLabel: rupees(overdue),
      creditLabel: rupees(credit),
      state: (outstanding <= 0 ? 'clear' : overdue > 0 ? 'overdue' : 'due') as
        'clear' | 'overdue' | 'due',
    };
  });
}
