import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, of, switchMap, tap } from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { FlatDues } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton, StatCard, StatusPill } from '../../shared/ui';
import {
  MaintenanceAccess,
  MaintenanceTabs,
  dayLabel,
  flatLabel,
  inr,
  recordPaymentDialog,
} from './maintenance-ui';

/**
 * What each flat owes. The committee sees every flat with dues and can chase defaulters;
 * a resident sees their own flat (the backend scopes the list).
 */
@Component({
  selector: 'app-maintenance-dues',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatTooltipModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatCard,
    StatusPill,
    MaintenanceTabs,
  ],
  templateUrl: './maintenance-dues.html',
  styleUrl: './maintenance.scss',
})
export class MaintenanceDues {
  private readonly api = inject(MaintenanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(MaintenanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly flatLabel = flatLabel;

  protected readonly overdueOnly = signal(false);
  protected readonly dues = signal<FlatDues[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly busy = signal(false);
  private readonly attempt = signal(0);

  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  protected readonly totalOutstanding = computed(() => sum(this.dues(), (d) => d.outstanding));
  protected readonly totalOverdue = computed(() => sum(this.dues(), (d) => d.overdue));
  protected readonly defaulters = computed(() => this.dues().filter((d) => d.overdue > 0).length);

  constructor() {
    toObservable(
      computed(() => [this.ctx.selectedSocietyId(), this.overdueOnly(), this.attempt()] as const),
    )
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId, overdueOnly]) =>
          societyId == null
            ? of([])
            : this.api.dues(societyId, overdueOnly).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.dues.set(list ?? []);
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected record(d?: FlatDues): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    recordPaymentDialog(this.dialog, {
      societyId,
      flat: d ? { id: d.flatId, label: flatLabel(d.wingName, d.flatNumber) } : undefined,
      amount: d?.outstanding,
    }).subscribe((payment) => {
      this.snack.open(`Payment recorded · receipt ${payment.receiptNumber}`, undefined, {
        duration: 4000,
      });
      this.retry();
    });
  }

  protected async remind(d?: FlatDues): Promise<void> {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || this.busy()) return;
    const ok = await firstValueFrom(
      confirmDialog(this.dialog, {
        title: d ? `Remind flat ${flatLabel(d.wingName, d.flatNumber)}` : 'Remind defaulters',
        message: d
          ? `Residents of this flat get a notification about ${inr(d.overdue)} overdue.`
          : `Residents of the ${this.defaulters()} flat(s) with overdue dues get a notification.`,
        confirmText: 'Send reminder',
      }),
    );
    if (!ok) return;
    this.busy.set(true);
    this.api.remind(societyId, d ? [d.flatId] : undefined).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.snack.open(
          r.flatCount === 0
            ? 'No flat has overdue dues'
            : `Reminder sent to ${r.flatCount} flat(s) · ${inr(r.totalOverdue)} overdue`,
          undefined,
          { duration: 4000 },
        );
      },
      error: () => this.busy.set(false), // reported by the error interceptor
    });
  }

  protected export(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || this.busy()) return;
    this.busy.set(true);
    this.api.exportDues(societyId, this.overdueOnly()).subscribe({
      next: (res) => {
        this.busy.set(false);
        saveResponse(res, 'maintenance-dues.csv');
      },
      error: () => this.busy.set(false),
    });
  }
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return Math.round(items.reduce((total, item) => total + value(item), 0) * 100) / 100;
}
