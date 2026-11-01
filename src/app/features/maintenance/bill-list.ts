import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, of, switchMap, tap } from 'rxjs';

import { BillQuery, MaintenanceApi } from '../../core/api/maintenance.api';
import { Bill, BillStatus, BillingCycle } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import {
  BILL_STATUS,
  MaintenanceAccess,
  MaintenanceTabs,
  dayLabel,
  flatLabel,
  inr,
  periodLabel,
} from './maintenance-ui';

const PAGE_SIZE = 20;
const STATUSES: readonly BillStatus[] = ['UNPAID', 'PARTIAL', 'PAID', 'WAIVED', 'CANCELLED'];

/**
 * Bills of the selected society, newest period first. Residents get their own flat's bills.
 * `?flatId=` and `?cycleId=` narrow the list (links from the dues page and a cycle).
 */
@Component({
  selector: 'app-bill-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    MaintenanceTabs,
  ],
  templateUrl: './bill-list.html',
  styleUrl: './maintenance.scss',
})
export class BillList {
  private readonly api = inject(MaintenanceApi);
  private readonly router = inject(Router);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(MaintenanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly periodLabel = periodLabel;
  protected readonly flatLabel = flatLabel;
  protected readonly billStatus = BILL_STATUS;
  protected readonly statusFilters: { label: string; value: BillStatus | null }[] = [
    { label: 'All', value: null },
    ...STATUSES.map((s) => ({ label: BILL_STATUS[s].label, value: s })),
  ];

  private readonly params = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly status = signal<BillStatus | null>(
    STATUSES.find((s) => s === this.params.get('status')) ?? null,
  );
  protected readonly cycleId = signal<number | null>(numberParam(this.params.get('cycleId')));
  protected readonly flatId = signal<number | null>(numberParam(this.params.get('flatId')));

  protected readonly cycles = signal<BillingCycle[]>([]);
  protected readonly bills = signal<Bill[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  /** Shown as a removable filter once the list has loaded a bill of it. */
  protected readonly flatName = computed(() => {
    const b = this.bills()[0];
    return this.flatId() != null && b ? flatLabel(b.wingName, b.flatNumber) : null;
  });

  private readonly query = computed<BillQuery | null>(() => {
    const societyId = this.ctx.selectedSocietyId();
    return societyId == null
      ? null
      : { societyId, status: this.status(), cycleId: this.cycleId(), flatId: this.flatId() };
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
                .bills({ ...query, page: 0, size: PAGE_SIZE })
                .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.bills.set(list ?? []);
        this.hasMore.set(list?.length === PAGE_SIZE);
        this.loading.set(false);
      });

    // Cycles for the filter; committee only (residents can't list cycles).
    toObservable(computed(() => (this.access.committee() ? this.ctx.selectedSocietyId() : null)))
      .pipe(
        switchMap((societyId) =>
          societyId == null ? of([]) : this.api.cycles(societyId).pipe(catchError(() => of([]))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((cycles) => this.cycles.set(cycles));
  }

  protected setStatus(status: BillStatus | null): void {
    this.status.set(status);
    this.syncUrl();
  }

  protected setCycle(cycleId: number | null): void {
    this.cycleId.set(cycleId);
    this.syncUrl();
  }

  protected clearFlat(): void {
    this.flatId.set(null);
    this.syncUrl();
  }

  protected cycleLabel(c: BillingCycle): string {
    const label =
      c.kind === 'OPENING_BALANCE' ? 'Opening balances' : periodLabel(c.periodStart, c.periodEnd);
    return c.status === 'CANCELLED' ? `${label} (cancelled)` : label;
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected loadMore(): void {
    const query = this.query();
    if (query == null) return;
    this.loadingMore.set(true);
    this.api
      .bills({ ...query, page: this.page + 1, size: PAGE_SIZE })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (list) => {
          if (query !== this.query()) return;
          this.page++;
          const seen = new Set(this.bills().map((b) => b.id));
          this.bills.update((current) => [...current, ...list.filter((b) => !seen.has(b.id))]);
          this.hasMore.set(list.length === PAGE_SIZE);
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  /** Keeps the filters in the URL so back/forward and reloads keep them. */
  private syncUrl(): void {
    this.router.navigate([], {
      queryParams: { status: this.status(), cycleId: this.cycleId(), flatId: this.flatId() },
      replaceUrl: true,
    });
  }
}

function numberParam(value: string | null): number | null {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : null;
}
