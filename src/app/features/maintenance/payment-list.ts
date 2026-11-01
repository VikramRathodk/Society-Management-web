import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, of, switchMap, tap } from 'rxjs';

import { MaintenanceApi, PaymentQuery } from '../../core/api/maintenance.api';
import { Payment } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { exportDialog } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import {
  MaintenanceAccess,
  MaintenanceTabs,
  PAYMENT_STATUS,
  dayLabel,
  flatLabel,
  inr,
  methodLabel,
  recordPaymentDialog,
  todayIso,
} from './maintenance-ui';

const PAGE_SIZE = 20;

/**
 * Payments received, newest first, with a date range filter. Residents see their own flat's.
 * `?record=1` opens the record dialog (from the command palette).
 */
@Component({
  selector: 'app-payment-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    MaintenanceTabs,
  ],
  templateUrl: './payment-list.html',
  styleUrl: './maintenance.scss',
})
export class PaymentList {
  private readonly api = inject(MaintenanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(MaintenanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly flatLabel = flatLabel;
  protected readonly methodLabel = methodLabel;
  protected readonly paymentStatus = PAYMENT_STATUS;
  protected readonly today = todayIso();

  protected readonly from = signal<string>('');
  protected readonly to = signal<string>('');
  protected readonly includeVoid = signal(true);
  protected readonly payments = signal<Payment[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  protected readonly filtered = computed(() => !!this.from() || !!this.to() || !this.includeVoid());

  private readonly query = computed<PaymentQuery | null>(() => {
    const societyId = this.ctx.selectedSocietyId();
    return societyId == null
      ? null
      : {
          societyId,
          from: this.from() || null,
          to: this.to() || null,
          includeVoid: this.includeVoid(),
        };
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
                .payments({ ...query, page: 0, size: PAGE_SIZE })
                .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.payments.set(list ?? []);
        this.hasMore.set(list?.length === PAGE_SIZE);
        this.loading.set(false);
      });

    const route = inject(ActivatedRoute);
    if (route.snapshot.queryParamMap.get('record') === '1') {
      // Drop the flag so a reload doesn't reopen the dialog.
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
      queueMicrotask(() => this.access.canRecord() && this.record());
    }
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected record(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    recordPaymentDialog(this.dialog, { societyId }).subscribe((payment) =>
      this.router.navigate(['/maintenance/payments', payment.id]),
    );
  }

  protected export(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    exportDialog(this.dialog, {
      title: 'Export payments',
      download: ({ from, to }) => this.api.exportPayments(societyId, from, to),
    }).subscribe();
  }

  protected clearFilters(): void {
    this.from.set('');
    this.to.set('');
    this.includeVoid.set(true);
  }

  protected loadMore(): void {
    const query = this.query();
    if (query == null) return;
    this.loadingMore.set(true);
    this.api
      .payments({ ...query, page: this.page + 1, size: PAGE_SIZE })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (list) => {
          if (query !== this.query()) return;
          this.page++;
          const seen = new Set(this.payments().map((p) => p.id));
          this.payments.update((current) => [...current, ...list.filter((p) => !seen.has(p.id))]);
          this.hasMore.set(list.length === PAGE_SIZE);
        },
        error: () => {}, // reported by the error interceptor
      });
  }
}
