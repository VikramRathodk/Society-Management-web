/**
 * Online payments (module 16): labels, paying maintenance through Razorpay Checkout, the "Pay online"
 * dialog, and a reason dialog for refunds and suspensions.
 */
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Observable, catchError, debounceTime, filter, firstValueFrom, of, switchMap } from 'rxjs';

import { PaymentApi } from '../../core/api/payment.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  FeeMode,
  GatewayRefundStatus,
  OnlineCapture,
  OnlineOrderStatus,
  OnlineQuote,
  PaymentAccountStatus,
  TransferStatus,
} from '../../core/models';
import { RazorpayConstructor, RazorpayResponse, loadRazorpay } from '../../core/razorpay';
import { Tone } from '../../shared/ui';

/** Indian rupees, e.g. "₹1,250.50". */
export function rupees(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export const ACCOUNT_STATUS: Record<PaymentAccountStatus, { label: string; tone: Tone; help: string }> = {
  SUBMITTED: { label: 'Sending to Razorpay', tone: 'primary', help: 'The details are on their way to Razorpay.' },
  UNDER_REVIEW: {
    label: 'Under review',
    tone: 'primary',
    help: 'Razorpay is checking the details and the bank account. This takes from minutes to a few days.',
  },
  NEEDS_CLARIFICATION: {
    label: 'Needs a correction',
    tone: 'warning',
    help: 'Razorpay needs something corrected. Fix the details below and send them again.',
  },
  ACTIVATED: { label: 'Active', tone: 'success', help: 'Razorpay activated the account.' },
  FAILED: {
    label: 'Failed',
    tone: 'danger',
    help: 'Razorpay refused the details. Correct them and send them again.',
  },
  SUSPENDED: { label: 'Suspended', tone: 'danger', help: 'Online payments are stopped for this society.' },
};

export const ORDER_STATUS: Record<OnlineOrderStatus, { label: string; tone: Tone }> = {
  CREATED: { label: 'Not paid', tone: 'neutral' },
  PAID: { label: 'Paid', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  PROBLEM: { label: 'Needs a refund', tone: 'danger' },
};

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Transfer pending', tone: 'warning' },
  CREATED: { label: 'Transferred', tone: 'primary' },
  PROCESSED: { label: 'Settled to the society', tone: 'success' },
  FAILED: { label: 'Transfer failed', tone: 'danger' },
};

export const REFUND_STATUS: Record<GatewayRefundStatus, { label: string; tone: Tone }> = {
  PENDING_APPROVAL: { label: 'Refund awaiting approval', tone: 'warning' },
  REQUESTED: { label: 'Refund sent', tone: 'primary' },
  PROCESSED: { label: 'Refunded', tone: 'success' },
  FAILED: { label: 'Refund failed', tone: 'danger' },
  REJECTED: { label: 'Refund rejected', tone: 'neutral' },
};

export function feeModeLabel(mode: FeeMode): string {
  switch (mode) {
    case 'SOCIETY_ABSORBS':
      return 'Society pays the gateway fee';
    case 'CONVENIENCE_PERCENT':
      return 'Convenience fee (%)';
    case 'CONVENIENCE_FIXED':
      return 'Convenience fee (fixed)';
  }
}

/** Razorpay's business types; a housing society is usually "society". */
export const BUSINESS_TYPES: { value: string; label: string }[] = [
  { value: 'society', label: 'Society (co-operative housing society)' },
  { value: 'trust', label: 'Trust' },
  { value: 'ngo', label: 'NGO' },
  { value: 'not_yet_registered', label: 'Not registered yet' },
  { value: 'other', label: 'Other' },
];

// ---- Paying maintenance online ----

export type MaintenancePayOutcome =
  | { kind: 'paid'; capture: OnlineCapture }
  | { kind: 'dismissed' }
  | { kind: 'failed'; message: string };

/**
 * Pays part or all of a flat's dues through Razorpay Checkout: the backend makes the order, Checkout
 * takes the payment, and the backend verifies Razorpay's signature and records it on the bills. If the
 * tab closes mid-way, Razorpay's webhook still records the payment.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceCheckout {
  private readonly api = inject(PaymentApi);
  private readonly auth = inject(AuthStore);

  async pay(flatId: number, amount: number | null, billId: number | null = null): Promise<MaintenancePayOutcome> {
    let order;
    try {
      order = await firstValueFrom(this.api.order(flatId, amount, billId));
    } catch (err) {
      return { kind: 'failed', message: errorMessage(err as HttpErrorResponse) };
    }
    let Razorpay: RazorpayConstructor;
    try {
      Razorpay = await loadRazorpay();
    } catch {
      return { kind: 'failed', message: "Couldn't load Razorpay. Check the connection and try again." };
    }
    const user = this.auth.user();
    return new Promise<MaintenancePayOutcome>((resolve) => {
      const checkout = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.merchantName,
        description: order.description,
        order_id: order.orderId,
        prefill: { name: user?.name ?? '', contact: user?.phone ?? '', email: user?.email ?? '' },
        notes: { flatId: String(flatId) },
        theme: { color: '#2563eb' },
        handler: (response: RazorpayResponse) => {
          this.api
            .verify(flatId, response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature)
            .subscribe({
              next: (capture) => resolve({ kind: 'paid', capture }),
              error: (err: HttpErrorResponse) => resolve({ kind: 'failed', message: errorMessage(err) }),
            });
        },
        modal: { ondismiss: () => resolve({ kind: 'dismissed' }) },
      });
      checkout.on('payment.failed', (response) =>
        resolve({ kind: 'failed', message: response.error?.description ?? 'The payment failed' }),
      );
      checkout.open();
    });
  }
}

export interface PayOnlineData {
  flatId: number;
  flatLabel: string;
  quote: OnlineQuote;
}

/** Choose how much to pay (any amount up to the dues), see the fee, then pay in Razorpay Checkout. */
@Component({
  selector: 'app-pay-online-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Pay online · flat {{ data.flatLabel }}</h2>
    <mat-dialog-content>
      <p class="muted">You owe {{ rupees(data.quote.owed) }}. Pay all of it or part (at least {{ rupees(data.quote.minimum) }}).</p>
      <mat-form-field appearance="outline">
        <mat-label>Amount (₹)</mat-label>
        <input matInput type="number" [formControl]="amount" [min]="data.quote.minimum" [max]="data.quote.owed" step="0.01" cdkFocusInitial />
      </mat-form-field>
      @if (quote(); as q) {
        <dl class="facts">
          <dt>Towards your dues</dt>
          <dd>{{ rupees(q.amount) }}</dd>
          @if (q.convenienceFee > 0) {
            <dt>Convenience fee</dt>
            <dd>{{ rupees(q.convenienceFee) }}</dd>
          }
          <dt><strong>You pay</strong></dt>
          <dd><strong>{{ rupees(q.total) }}</strong></dd>
        </dl>
      }
      <p class="muted small">UPI, cards and netbanking through Razorpay. Your receipt comes at once.</p>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="paying()">Cancel</button>
      <button mat-flat-button (click)="pay()" [disabled]="paying() || !quote()">
        <mat-icon>lock</mat-icon>
        {{ paying() ? 'Opening…' : 'Pay ' + rupees(quote()?.total) }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .facts {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 16px;
      margin: 0 0 12px;
    }
    .facts dd {
      margin: 0;
      text-align: right;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .small {
      font-size: 0.85rem;
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class PayOnlineDialog {
  private readonly ref = inject<MatDialogRef<PayOnlineDialog, OnlineCapture>>(MatDialogRef);
  private readonly api = inject(PaymentApi);
  private readonly checkout = inject(MaintenanceCheckout);
  protected readonly data = inject<PayOnlineData>(MAT_DIALOG_DATA);
  protected readonly rupees = rupees;

  protected readonly amount = new FormControl<number | null>(this.data.quote.amount);
  protected readonly quote = signal<OnlineQuote | null>(this.data.quote);
  protected readonly error = signal<string | null>(null);
  protected readonly paying = signal(false);

  constructor() {
    this.amount.valueChanges
      .pipe(
        debounceTime(300),
        switchMap((value) => {
          this.error.set(null);
          if (value == null || value <= 0) {
            this.quote.set(null);
            return of(null);
          }
          return this.api.quote(this.data.flatId, Number(value)).pipe(
            catchError((err: HttpErrorResponse) => {
              this.error.set(errorMessage(err));
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((q) => this.quote.set(q));
  }

  protected async pay(): Promise<void> {
    const q = this.quote();
    if (!q) return;
    this.paying.set(true);
    this.error.set(null);
    const outcome = await this.checkout.pay(this.data.flatId, q.amount, q.billId);
    this.paying.set(false);
    if (outcome.kind === 'paid') this.ref.close(outcome.capture);
    else if (outcome.kind === 'failed') this.error.set(outcome.message);
  }
}

/** Emits the recorded payment once paid. */
export function payOnlineDialog(dialog: MatDialog, data: PayOnlineData): Observable<OnlineCapture> {
  return dialog
    .open<PayOnlineDialog, PayOnlineData, OnlineCapture>(PayOnlineDialog, { data, width: '440px' })
    .afterClosed()
    .pipe(filter((r): r is OnlineCapture => r !== undefined));
}

// ---- A reason (refunds, rejections, suspensions) ----

export interface ReasonDialogData<T> {
  title: string;
  message?: string;
  label: string;
  confirmText: string;
  danger?: boolean;
  save: (reason: string) => Observable<T>;
}

@Component({
  selector: 'app-payment-reason-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (data.message) {
        <p>{{ data.message }}</p>
      }
      <mat-form-field appearance="outline">
        <mat-label>{{ data.label }}</mat-label>
        <textarea matInput rows="3" [formControl]="text" maxlength="500" cdkFocusInitial></textarea>
      </mat-form-field>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [class.danger]="data.danger" (click)="save()" [disabled]="saving()">{{ data.confirmText }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class PaymentReasonDialog<T> {
  private readonly ref = inject<MatDialogRef<PaymentReasonDialog<T>, T>>(MatDialogRef);
  protected readonly data = inject<ReasonDialogData<T>>(MAT_DIALOG_DATA);
  protected readonly text = new FormControl('', { nonNullable: true });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(): void {
    const value = this.text.value.trim();
    if (!value) {
      this.error.set('Give a reason');
      return;
    }
    this.saving.set(true);
    this.data.save(value).subscribe({
      next: (r) => this.ref.close(r),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function reasonDialog<T>(dialog: MatDialog, data: ReasonDialogData<T>): Observable<T> {
  return dialog
    .open<PaymentReasonDialog<T>, ReasonDialogData<T>, T>(PaymentReasonDialog, { data, width: '440px' })
    .afterClosed()
    .pipe(filter((r): r is T => r !== undefined));
}
