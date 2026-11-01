import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { Payment } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import {
  MaintenanceAccess,
  PAYMENT_STATUS,
  dayLabel,
  flatLabel,
  inr,
  methodLabel,
  reasonDialog,
} from './maintenance-ui';

/** A payment's receipt: what was paid and which bills it went to. Printable; void for the committee. */
@Component({
  selector: 'app-payment-detail',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './payment-detail.html',
  styleUrls: ['./maintenance.scss', './payment-detail.scss'],
})
export class PaymentDetail {
  private readonly api = inject(MaintenanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(MaintenanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly methodLabel = methodLabel;

  protected readonly payment = signal<Payment | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  private readonly attempt = signal(0);

  protected readonly status = computed(() => {
    const p = this.payment();
    return p ? PAYMENT_STATUS[p.status] : null;
  });
  protected readonly flat = computed(() => {
    const p = this.payment();
    return p ? flatLabel(p.wingName, p.flatNumber) : '';
  });
  protected readonly societyName = computed(() => {
    const p = this.payment();
    return this.ctx.societies().find((s) => s.id === p?.societyId)?.name ?? null;
  });

  constructor() {
    const id = inject(ActivatedRoute).paramMap.pipe(map((p) => Number(p.get('id'))));
    toObservable(this.attempt)
      .pipe(
        switchMap(() => id),
        tap(() => this.loading.set(true)),
        switchMap((paymentId) =>
          this.api.payment(paymentId).pipe(
            map((payment) => ({ payment, error: null })),
            catchError((err: HttpErrorResponse) =>
              of({
                payment: null,
                error:
                  err.status === 404 || err.status === 403
                    ? ('missing' as const)
                    : ('failed' as const),
              }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ payment, error }) => {
        this.payment.set(payment);
        this.loadError.set(error);
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected print(): void {
    window.print();
  }

  protected voidPayment(): void {
    const p = this.payment();
    if (!p) return;
    reasonDialog(this.dialog, {
      title: `Void receipt ${p.receiptNumber}`,
      message: `The ${inr(p.amount)} comes off the bills it paid, which become unpaid again. The receipt stays, marked void.`,
      label: 'Reason',
      confirmText: 'Void payment',
      save: (reason) => this.api.voidPayment(p.id, reason),
    }).subscribe(() => {
      this.snack.open('Payment voided', undefined, { duration: 3000 });
      this.retry();
    });
  }
}
