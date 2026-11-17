import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { switchMap, tap } from 'rxjs';

import { SubscriptionApi } from '../../core/api/subscription.api';
import { Notifier } from '../../core/notifier';
import { PlatformInvoice } from '../../core/models';
import { SubscriptionAccessStore } from '../../core/subscription/subscription-access.store';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import {
  BillingAccess,
  INVOICE_STATUS,
  RazorpayCheckout,
  amountDialog,
  cycleLabel,
  dayLabel,
  inr,
  modeLabel,
  periodLabel,
  recordPlatformPaymentDialog,
} from './subscription-ui';

/**
 * One platform invoice, printable as a tax invoice: seller and buyer, the charge, GST, payments
 * and credit notes. The society pays it online here; the platform records other payments and
 * credit notes.
 */
@Component({
  selector: 'app-platform-invoice',
  imports: [MatButtonModule, MatIconModule, EmptyState, PageHeader, Section, Skeleton, StatusPill],
  templateUrl: './platform-invoice.html',
  styleUrls: ['../maintenance/maintenance.scss', '../maintenance/payment-detail.scss', './subscription.scss'],
})
export class PlatformInvoicePage {
  /** Route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(SubscriptionApi);
  private readonly dialog = inject(MatDialog);
  private readonly notifier = inject(Notifier);
  private readonly checkout = inject(RazorpayCheckout);
  private readonly accessStore = inject(SubscriptionAccessStore);
  protected readonly access = inject(BillingAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly periodLabel = periodLabel;
  protected readonly cycleLabel = cycleLabel;
  protected readonly modeLabel = modeLabel;

  protected readonly invoice = signal<PlatformInvoice | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  protected readonly paying = signal(false);
  private readonly attempt = signal(0);

  protected readonly status = computed(() => {
    const i = this.invoice()?.summary;
    if (!i) return null;
    return i.overdue ? { label: 'Overdue', tone: 'danger' as const } : INVOICE_STATUS[i.status];
  });
  protected readonly canPay = computed(() => {
    const i = this.invoice()?.summary;
    return !!i && i.balance > 0 && this.access.canUpdate(i.societyId);
  });
  protected readonly back = computed(() => (this.access.platformView() ? '/billing' : '/subscription'));

  constructor() {
    toObservable(computed(() => [this.id(), this.attempt()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadError.set(null);
        }),
        switchMap(([id]) => this.api.invoice(Number(id))),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (invoice) => {
          this.invoice.set(invoice);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.loadError.set(err.status === 404 || err.status === 403 ? 'missing' : 'failed');
        },
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected print(): void {
    window.print();
  }

  protected async pay(): Promise<void> {
    const i = this.invoice();
    if (!i || this.paying()) return;
    this.paying.set(true);
    const outcome = await this.checkout.pay(i.summary.id);
    this.paying.set(false);
    if (outcome.kind === 'paid') {
      this.invoice.set(outcome.invoice);
      this.accessStore.refresh();
      this.notifier.show('Paid — thank you. The receipt is below.', 'Close');
    } else if (outcome.kind === 'failed') {
      this.notifier.show(outcome.message, 'Close');
      this.retry();
    }
  }

  protected recordPayment(): void {
    const i = this.invoice();
    if (!i) return;
    recordPlatformPaymentDialog(this.dialog, i).subscribe((updated) => this.invoice.set(updated));
  }

  protected creditNote(): void {
    const i = this.invoice();
    if (!i) return;
    amountDialog(this.dialog, {
      title: `Credit note for ${i.summary.number}`,
      intro: 'Lowers what the invoice asks for (a mistake, a goodwill credit, a refund made in Razorpay).',
      amountLabel: 'Amount (₹)',
      max: i.summary.balance,
      textLabel: 'Reason',
      textRequired: true,
      confirmText: 'Issue credit note',
      save: (amount, reason) => this.api.creditNote(i.summary.id, amount, reason ?? ''),
    }).subscribe((updated) => this.invoice.set(updated));
  }
}
