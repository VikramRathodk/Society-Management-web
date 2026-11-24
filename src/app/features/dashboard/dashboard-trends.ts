import { Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';

import { ReportingApi } from '../../core/api/reporting.api';
import { ComplaintStats, MaintenanceStats } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { ChartSeries, ChartView } from '../../shared/chart';
import { Section } from '../../shared/ui';
import { StatsAccess, monthLabel } from '../stats/stats-ui';

/** Months in the dashboard's small charts; the Stats page has the longer ranges. */
const MONTHS = 6;

/**
 * Two small trend charts for the committee dashboard: maintenance billed vs collected, and complaints
 * raised vs resolved, over the last six months. Each shows only when the user may see it and it
 * loaded; nothing is shown on failure (the Stats page has the full view and its errors).
 */
@Component({
  selector: 'app-dashboard-trends',
  imports: [RouterLink, MatButtonModule, Section, ChartView],
  template: `
    @if (collections() || complaints()) {
      <div class="trends">
        @if (collections(); as c) {
          <app-section title="Maintenance collected" subtitle="Last 6 months" padded>
            <a sectionActions mat-button routerLink="/stats">All stats</a>
            <app-chart
              type="bar"
              [labels]="c.labels"
              [series]="c.series"
              money
              [height]="180"
              ariaLabel="Maintenance billed and collected over the last 6 months"
            />
          </app-section>
        }
        @if (complaints(); as c) {
          <app-section title="Complaints" subtitle="Last 6 months" padded>
            <a sectionActions mat-button routerLink="/stats">All stats</a>
            <app-chart
              type="bar"
              [labels]="c.labels"
              [series]="c.series"
              [height]="180"
              ariaLabel="Complaints raised and resolved over the last 6 months"
            />
          </app-section>
        }
      </div>
    }
  `,
  styles: `
    .trends {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
      gap: 16px;
    }
  `,
})
export class DashboardTrends {
  private readonly api = inject(ReportingApi);
  private readonly ctx = inject(SocietyContextStore);
  private readonly access = inject(StatsAccess);

  private readonly maintenance = this.load<MaintenanceStats>(
    () => this.access.maintenance(),
    (id) => this.api.maintenance(id, MONTHS),
  );
  private readonly complaintStats = this.load<ComplaintStats>(
    () => this.access.complaints(),
    (id) => this.api.complaints(id, MONTHS),
  );

  protected readonly collections = computed(() => {
    const d = this.maintenance();
    if (!d || d.months.every((m) => m.billed === 0 && m.collected === 0)) return null;
    const series: ChartSeries[] = [
      { label: 'Billed', data: d.months.map((m) => m.billed), color: 'neutral' },
      { label: 'Collected', data: d.months.map((m) => m.collected), color: 'primary' },
    ];
    return { labels: d.months.map((m) => monthLabel(m.month)), series };
  });

  protected readonly complaints = computed(() => {
    const d = this.complaintStats();
    if (!d || d.months.every((m) => m.opened === 0 && m.resolved === 0)) return null;
    const series: ChartSeries[] = [
      { label: 'Raised', data: d.months.map((m) => m.opened), color: 'warning' },
      { label: 'Resolved', data: d.months.map((m) => m.resolved), color: 'success' },
    ];
    return { labels: d.months.map((m) => monthLabel(m.month)), series };
  });

  /** The series for the selected society, or null when not allowed or it failed. */
  private load<T>(allowed: () => boolean, fetch: (societyId: number) => Observable<T>) {
    const allowedNow = computed(allowed);
    return toSignal(
      combineLatest([toObservable(this.ctx.selectedSocietyId), toObservable(allowedNow)]).pipe(
        switchMap(([societyId, ok]) =>
          ok && societyId != null
            ? fetch(societyId).pipe(
                map((data): T | null => data),
                catchError(() => of(null)),
              )
            : of(null),
        ),
      ),
      { initialValue: null },
    );
  }
}
