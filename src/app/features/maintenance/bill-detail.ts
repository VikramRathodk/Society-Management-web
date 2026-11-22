import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { Bill, BillLine } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import {
  BILL_STATUS,
  MaintenanceAccess,
  OPEN_BILL_STATUSES,
  dayLabel,
  flatLabel,
  inr,
  methodLabel,
  paidPercent,
  periodLabel,
  reasonDialog,
  recordPaymentDialog,
  QrCode,
  upiPayLink,
} from './maintenance-ui';

/** One bill: its lines, what paid it, and (for the committee) record payment and waive. */
@Component({
  selector: 'app-bill-detail',
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
    QrCode,
  ],
  templateUrl: './bill-detail.html',
  styleUrls: ['./maintenance.scss', './bill-detail.scss'],
})
export class BillDetail {
  private readonly api = inject(MaintenanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly access = inject(MaintenanceAccess);
  private readonly ctx = inject(SocietyContextStore);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly methodLabel = methodLabel;

  protected readonly bill = signal<Bill | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  private readonly attempt = signal(0);

  protected readonly status = computed(() => {
    const b = this.bill();
    return b ? BILL_STATUS[b.status] : null;
  });
  protected readonly isOpen = computed(() => {
    const b = this.bill();
    return !!b && OPEN_BILL_STATUSES.includes(b.status);
  });
  protected readonly period = computed(() => {
    const b = this.bill();
    if (!b) return null;
    return b.cycleKind === 'OPENING_BALANCE'
      ? 'Opening balance'
      : periodLabel(b.periodStart, b.periodEnd);
  });
  protected readonly paid = computed(() => {
    const b = this.bill();
    return b ? paidPercent(b.amountPaid, b.total) : 0;
  });
  protected readonly societyName = computed(() => {
    const b = this.bill();
    return this.ctx.societies().find((s) => s.id === b?.societyId)?.name ?? null;
  });
  protected readonly printedOn = new Date();

  protected readonly flat = computed(() => {
    const b = this.bill();
    return b ? flatLabel(b.wingName, b.flatNumber) : '';
  });

  /** The society's UPI details, read from its maintenance settings once the bill is known. */
  private readonly upi = signal<{ upiId: string; payeeName: string | null } | null>(null);
  /** Pay-by-UPI link for what is still owed; null when nothing is owed or no UPI ID is set. */
  protected readonly upiLink = computed(() => {
    const b = this.bill();
    const upi = this.upi();
    if (!b || !upi || !this.isOpen() || b.outstanding <= 0) return null;
    return upiPayLink({
      upiId: upi.upiId,
      payeeName: upi.payeeName ?? this.societyName() ?? 'Society maintenance',
      amount: b.outstanding,
      note: `Maintenance ${b.billNumber} ${this.flat()}`,
    });
  });
  protected readonly upiId = computed(() => this.upi()?.upiId ?? null);

  constructor() {
    const id = inject(ActivatedRoute).paramMap.pipe(map((p) => Number(p.get('id'))));
    toObservable(this.attempt)
      .pipe(
        switchMap(() => id),
        tap(() => this.loading.set(true)),
        switchMap((billId) =>
          this.api.bill(billId).pipe(
            map((bill) => ({ bill, error: null })),
            catchError((err: HttpErrorResponse) =>
              of({
                bill: null,
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
      .subscribe(({ bill, error }) => {
        this.bill.set(bill);
        this.loadError.set(error);
        this.loading.set(false);
      });

    // UPI details of the bill's society. A missing UPI ID (or no access to settings) just hides the QR.
    toObservable(computed(() => this.bill()?.societyId ?? null))
      .pipe(
        distinctUntilChanged(),
        switchMap((societyId) =>
          societyId == null
            ? of(null)
            : this.api.settings(societyId, { silent: true }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((s) =>
        this.upi.set(s?.upiId ? { upiId: s.upiId, payeeName: s.upiPayeeName } : null),
      );
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  /** "₹3.50 × 750 sq ft" style detail for a line. */
  protected lineDetail(line: BillLine): string | null {
    switch (line.calcType) {
      case 'PER_SQFT':
        return `${inr(line.rate)} × ${line.quantity} sq ft`;
      case 'LATE_FEE':
      case 'OPENING_BALANCE':
      case 'PARKING':
        return line.note;
      default:
        return null;
    }
  }

  /** upi:// links are blocked by Angular's URL sanitizer in an href, so open it from code. */
  protected openUpiApp(link: string): void {
    window.location.href = link;
  }

  /** Prints the bill document below (the page itself is hidden when printing). */
  protected print(): void {
    window.print();
  }

  protected record(): void {
    const b = this.bill();
    if (!b) return;
    recordPaymentDialog(this.dialog, {
      societyId: b.societyId,
      flat: { id: b.flatId, label: this.flat() },
      bill: { id: b.id, number: b.billNumber },
      amount: b.outstanding,
    }).subscribe((payment) => {
      this.snack.open(`Payment recorded · receipt ${payment.receiptNumber}`, undefined, {
        duration: 4000,
      });
      this.retry();
    });
  }

  protected waive(): void {
    const b = this.bill();
    if (!b) return;
    reasonDialog(this.dialog, {
      title: `Waive bill ${b.billNumber}`,
      message:
        b.amountPaid > 0
          ? `${inr(b.amountPaid)} already paid stays on the bill; the remaining ${inr(b.outstanding)} is written off. This can't be undone.`
          : `The flat won't owe this bill's ${inr(b.total)}. This can't be undone.`,
      label: 'Reason',
      confirmText: 'Waive bill',
      save: (reason) => this.api.waiveBill(b.id, reason),
    }).subscribe(() => {
      this.snack.open('Bill waived', undefined, { duration: 3000 });
      this.retry();
    });
  }
}
