import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Signal, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { Observable, catchError, map, of, startWith, switchMap } from 'rxjs';

import { ReportingApi } from '../../core/api/reporting.api';
import {
  ComplaintStats,
  FinanceStats,
  MaintenanceStats,
  ParkingStats,
  PaymentMethod,
  StaffStats,
  VisitorStats,
} from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { ChartSeries, ChartView } from '../../shared/chart';
import { EmptyState, PageHeader, Section, Skeleton } from '../../shared/ui';
import { methodLabel } from '../maintenance/maintenance-ui';
import { StatsAccess, dayLabel, monthLabel } from './stats-ui';

/** loading | the data | hidden (not allowed, or not in the plan) | failed (anything else). */
type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'hidden' } | { state: 'failed' };

const BUCKET_LABELS: Record<string, string> = {
  'not-due': 'Not due yet',
  '1-30': '1–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': 'Over 90 days',
};

const CATEGORY_LABELS: Record<string, string> = {
  PLUMBING: 'Plumbing',
  ELECTRICAL: 'Electrical',
  SECURITY: 'Security',
  OTHER: 'Other',
};

const VEHICLE_LABELS: Record<string, string> = { CAR: 'Cars', BIKE: 'Bikes', OTHER: 'Other' };

/**
 * Graphs of the society's money and operations, for society-wide roles. Each section loads on its
 * own and disappears when the user may not see it or the plan leaves its module out.
 */
@Component({
  selector: 'app-stats-page',
  imports: [NgTemplateOutlet, MatButtonToggleModule, MatButtonModule, PageHeader, Section, Skeleton, EmptyState, ChartView],
  templateUrl: './stats-page.html',
  styleUrl: './stats-page.scss',
})
export class StatsPage {
  private readonly api = inject(ReportingApi);
  private readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(StatsAccess);

  /** Months for money and complaints; days for visitors and staff. */
  protected readonly months = signal(12);
  protected readonly days = signal(30);
  private readonly attempt = signal(0);

  protected readonly maintenance = this.section(
    () => this.access.maintenance(),
    (id) => this.api.maintenance(id, this.months()),
  );
  protected readonly finance = this.section(
    () => this.access.finance(),
    (id) => this.api.finance(id, this.months()),
  );
  protected readonly complaints = this.section(
    () => this.access.complaints(),
    (id) => this.api.complaints(id, this.months()),
  );
  protected readonly visitors = this.section(
    () => this.access.visitors(),
    (id) => this.api.visitors(id, this.days()),
  );
  protected readonly staff = this.section(
    () => this.access.staff(),
    (id) => this.api.staff(id, this.days()),
  );
  protected readonly parking = this.section(
    () => this.access.parking(),
    (id) => this.api.parking(id),
  );

  /** Nothing at all to show: no section is allowed, or every one was hidden by the server. */
  protected readonly nothing = computed(() =>
    [this.maintenance, this.finance, this.complaints, this.visitors, this.staff, this.parking].every(
      (s) => s().state === 'hidden',
    ),
  );

  // Chart inputs, derived from the loaded data.

  protected readonly billedCollected = computed(() =>
    this.chart(this.maintenance(), (d: MaintenanceStats) => ({
      labels: d.months.map((m) => monthLabel(m.month)),
      series: [
        { label: 'Billed', data: d.months.map((m) => m.billed), color: 'neutral' },
        { label: 'Collected', data: d.months.map((m) => m.collected), color: 'primary' },
      ],
    })),
  );

  protected readonly byMethod = computed(() =>
    this.chart(this.maintenance(), (d: MaintenanceStats) => {
      const methods = [...new Set(d.months.flatMap((m) => Object.keys(m.byMethod)))] as PaymentMethod[];
      return {
        labels: d.months.map((m) => monthLabel(m.month)),
        series: methods.map((method) => ({
          label: methodLabel(method),
          data: d.months.map((m) => m.byMethod[method] ?? 0),
        })),
      };
    }),
  );

  protected readonly ageing = computed(() =>
    this.chart(this.maintenance(), (d: MaintenanceStats) => ({
      labels: d.ageing.map((b) => BUCKET_LABELS[b.bucket] ?? b.bucket),
      series: [{ label: 'Unpaid', data: d.ageing.map((b) => b.amount), color: 'warning' }],
    })),
  );

  protected readonly incomeExpenditure = computed(() =>
    this.chart(this.finance(), (d: FinanceStats) => ({
      labels: d.months.map((m) => monthLabel(m.month)),
      series: [
        { label: 'Income', data: d.months.map((m) => m.income), color: 'success' },
        { label: 'Expenditure', data: d.months.map((m) => m.expenditure), color: 'warning' },
      ],
    })),
  );

  protected readonly expenses = computed(() =>
    this.chart(this.finance(), (d: FinanceStats) => ({
      labels: d.expensesByAccount.map((e) => e.name),
      series: [{ label: 'Spent', data: d.expensesByAccount.map((e) => e.amount) }],
    })),
  );

  protected readonly complaintMonths = computed(() =>
    this.chart(this.complaints(), (d: ComplaintStats) => ({
      labels: d.months.map((m) => monthLabel(m.month)),
      series: [
        { label: 'Raised', data: d.months.map((m) => m.opened), color: 'warning' },
        { label: 'Resolved', data: d.months.map((m) => m.resolved), color: 'success' },
      ],
    })),
  );

  protected readonly complaintCategories = computed(() =>
    this.chart(this.complaints(), (d: ComplaintStats) => {
      const entries = Object.entries(d.unresolvedByCategory).filter(([, n]) => n > 0);
      return {
        labels: entries.map(([c]) => CATEGORY_LABELS[c] ?? c),
        series: [{ label: 'Open', data: entries.map(([, n]) => n) }],
      };
    }),
  );

  protected readonly visitorDays = computed(() =>
    this.chart(this.visitors(), (d: VisitorStats) => ({
      labels: d.days.map((day) => dayLabel(day.date)),
      series: [
        { label: 'Logged', data: d.days.map((day) => day.logged), color: 'primary' },
        { label: 'Let in', data: d.days.map((day) => day.entered), color: 'success' },
        { label: 'Turned away', data: d.days.map((day) => day.rejected), color: 'warning' },
      ],
    })),
  );

  protected readonly staffDays = computed(() =>
    this.chart(this.staff(), (d: StaffStats) => ({
      labels: d.days.map((day) => dayLabel(day.date)),
      series: [{ label: 'Staff present', data: d.days.map((day) => day.present), color: 'tertiary' }],
    })),
  );

  protected readonly parkingSlots = computed(() =>
    this.chart(this.parking(), (d: ParkingStats) => {
      const types = d.resident.filter((r) => r.slots > 0 || r.waiting > 0);
      return {
        labels: types.map((r) => VEHICLE_LABELS[r.vehicleType] ?? r.vehicleType),
        series: [
          { label: 'Allotted', data: types.map((r) => r.allotted), color: 'primary' },
          { label: 'Free', data: types.map((r) => r.free), color: 'success' },
          { label: 'Waiting', data: types.map((r) => r.waiting), color: 'warning' },
        ],
      };
    }),
  );

  protected readonly parkingData = computed(() => {
    const p = this.parking();
    return p.state === 'ready' ? p.data : null;
  });

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  /**
   * One section's data for the selected society, reloaded when the society, the ranges or a retry
   * change. 403/402 hide the section; other errors show "Couldn't load".
   */
  private section<T>(allowed: () => boolean, fetch: (societyId: number) => Observable<T>): Signal<Load<T>> {
    const params = computed(() => ({
      societyId: this.ctx.selectedSocietyId(),
      allowed: allowed(),
      months: this.months(),
      days: this.days(),
      attempt: this.attempt(),
    }));
    return toSignal(
      toObservable(params).pipe(
        switchMap(({ societyId, allowed }) => {
          if (!allowed || societyId == null) return of<Load<T>>({ state: 'hidden' });
          return fetch(societyId).pipe(
            map((data): Load<T> => ({ state: 'ready', data })),
            catchError((error: unknown) =>
              of<Load<T>>(
                error instanceof HttpErrorResponse && (error.status === 403 || error.status === 402)
                  ? { state: 'hidden' }
                  : { state: 'failed' },
              ),
            ),
            startWith<Load<T>>({ state: 'loading' }),
          );
        }),
      ),
      { initialValue: { state: 'loading' } as Load<T> },
    );
  }

  /** Chart inputs once the data is in; null while loading, hidden or failed, or with nothing to plot. */
  private chart<T>(load: Load<T>, build: (data: T) => { labels: string[]; series: ChartSeries[] }) {
    if (load.state !== 'ready') return null;
    const chart = build(load.data);
    const empty = chart.series.every((s) => s.data.every((v) => v === 0));
    return { ...chart, empty };
  }
}
