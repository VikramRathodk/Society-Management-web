import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { catchError, of, switchMap, tap } from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { Refund } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import {
  MaintenanceAccess,
  MaintenanceTabs,
  REFUND_STATUS,
  dayLabel,
  flatLabel,
  inr,
  methodLabel,
  reasonDialog,
} from './maintenance-ui';

/**
 * Refunds of unused maintenance credit, newest first. Residents see their own flat's. Waiting ones
 * are approved or rejected here by someone other than their maker, who may withdraw them instead;
 * completed ones can be voided (the credit comes back). New refunds start from a flat's credit on the
 * Dues page.
 */
@Component({
  selector: 'app-refund-list',
  imports: [
    MatButtonModule,
    MatIconModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    MaintenanceTabs,
  ],
  templateUrl: './refund-list.html',
  styleUrl: './maintenance.scss',
})
export class RefundList {
  private readonly api = inject(MaintenanceApi);
  private readonly dialog = inject(MatDialog);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(MaintenanceAccess);
  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly flatLabel = flatLabel;
  protected readonly methodLabel = methodLabel;
  protected readonly refundStatus = REFUND_STATUS;

  protected readonly refunds = signal<Refund[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  private readonly attempt = signal(0);

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) =>
          societyId == null ? of([]) : this.api.refunds(societyId).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.refunds.set(list ?? []);
        this.loading.set(false);
      });
  }

  protected reload(): void {
    this.attempt.update((n) => n + 1);
  }

  protected isMaker(r: Refund): boolean {
    return r.createdBy === this.access.userId();
  }

  protected approve(r: Refund): void {
    confirmDialog(this.dialog, {
      title: `Approve refund ${r.refundNumber}?`,
      message: `${inr(r.amount)} back to flat ${flatLabel(r.wingName, r.flatNumber)}.`,
      confirmText: 'Approve',
    }).subscribe((ok) => ok && this.api.approveRefund(r.id).subscribe(() => this.reload()));
  }

  protected reject(r: Refund): void {
    reasonDialog(this.dialog, {
      title: `Reject refund ${r.refundNumber}?`,
      message: 'The credit stays with the flat.',
      label: 'Reason',
      confirmText: 'Reject',
      save: (reason) => this.api.rejectRefund(r.id, reason),
    }).subscribe(() => this.reload());
  }

  protected withdraw(r: Refund): void {
    confirmDialog(this.dialog, {
      title: `Withdraw refund ${r.refundNumber}?`,
      message: 'The credit stays with the flat.',
      confirmText: 'Withdraw',
    }).subscribe((ok) => ok && this.api.withdrawRefund(r.id).subscribe(() => this.reload()));
  }

  protected voidRefund(r: Refund): void {
    reasonDialog(this.dialog, {
      title: `Void refund ${r.refundNumber}?`,
      message: 'Use this when the money never reached the owner. The credit goes back to the flat.',
      label: 'Reason',
      confirmText: 'Void',
      save: (reason) => this.api.voidRefund(r.id, reason),
    }).subscribe(() => this.reload());
  }
}
