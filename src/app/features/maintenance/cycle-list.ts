import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { BillingCycle } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import {
  CYCLE_STATUS,
  MaintenanceAccess,
  MaintenanceTabs,
  dayLabel,
  inr,
  paidPercent,
  periodLabel,
} from './maintenance-ui';

/** The society's billing cycles, newest first, with how much of each has been collected. */
@Component({
  selector: 'app-cycle-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    MaintenanceTabs,
  ],
  templateUrl: './cycle-list.html',
  styleUrl: './maintenance.scss',
})
export class CycleList {
  private readonly api = inject(MaintenanceApi);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(MaintenanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly paidPercent = paidPercent;
  protected readonly cycleStatus = CYCLE_STATUS;

  protected readonly cycles = signal<BillingCycle[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'forbidden' | 'failed' | null>(null);
  private readonly attempt = signal(0);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  /** Opening balances can be entered once per society. */
  protected readonly hasOpening = computed(() =>
    this.cycles().some((c) => c.kind === 'OPENING_BALANCE' && c.status === 'ISSUED'),
  );

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) =>
          societyId == null
            ? of({ list: [] as BillingCycle[], error: null })
            : this.api.cycles(societyId).pipe(
                map((list) => ({ list, error: null })),
                catchError((err: HttpErrorResponse) =>
                  of({
                    list: [],
                    error: err.status === 403 ? ('forbidden' as const) : ('failed' as const),
                  }),
                ),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ list, error }) => {
        this.cycles.set(list);
        this.loadError.set(error);
        this.loading.set(false);
      });
  }

  protected title(c: BillingCycle): string {
    return c.kind === 'OPENING_BALANCE'
      ? 'Opening balances'
      : periodLabel(c.periodStart, c.periodEnd);
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }
}
