/**
 * Platform billing presentation shared by the society's Subscription page, the invoice page and the
 * platform's Billing page: labels and tones, paying through Razorpay Checkout, and the dialogs.
 */
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injectable, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Observable, filter, firstValueFrom } from 'rxjs';

import { SubscriptionApi } from '../../core/api/subscription.api';
import { AuthStore } from '../../core/auth/auth.store';
import { RazorpayConstructor, RazorpayResponse, loadRazorpay } from '../../core/razorpay';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  Plan,
  PlanModule,
  PlanRequest,
  PlatformInvoice,
  PlatformInvoiceStatus,
  PlatformPaymentMode,
  SubscriptionCycle,
  SubscriptionEventKind,
  SubscriptionStatus,
} from '../../core/models';
import { Tone } from '../../shared/ui';
import { inr, todayIso } from '../maintenance/maintenance-ui';

export { dayLabel, inr, periodLabel } from '../maintenance/maintenance-ui';

// ---- Labels ----

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  PAST_DUE: { label: 'Payment overdue', tone: 'warning' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const INVOICE_STATUS: Record<PlatformInvoiceStatus, { label: string; tone: Tone }> = {
  ISSUED: { label: 'Unpaid', tone: 'warning' },
  PARTLY_PAID: { label: 'Part paid', tone: 'primary' },
  PAID: { label: 'Paid', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const CYCLES: { value: SubscriptionCycle; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
];

export function cycleLabel(cycle: SubscriptionCycle): string {
  return cycle === 'YEARLY' ? 'Yearly' : 'Monthly';
}

export const PLAN_MODULES: { value: PlanModule; label: string }[] = [
  { value: 'MAINTENANCE', label: 'Maintenance billing' },
  { value: 'FINANCE', label: 'Finance and accounts' },
  { value: 'POLICIES', label: 'Rules and policies' },
  { value: 'GOVERNANCE', label: 'Meetings and governance' },
  { value: 'PARKING', label: 'Parking' },
  { value: 'ONLINE_PAYMENTS', label: 'Online maintenance payments' },
  { value: 'ALL', label: 'Everything (including future modules)' },
];

/** "Maintenance billing, Finance and accounts" (core modules are always included). */
export function modulesLabel(modules: PlanModule[]): string {
  if (modules.includes('ALL')) return 'Everything';
  const labels = PLAN_MODULES.filter((m) => modules.includes(m.value)).map((m) => m.label);
  return labels.length ? labels.join(', ') : 'Core modules only';
}

export const PAYMENT_MODES: { value: PlatformPaymentMode; label: string }[] = [
  { value: 'RAZORPAY', label: 'Online (Razorpay)' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
];

export function modeLabel(mode: PlatformPaymentMode): string {
  return PAYMENT_MODES.find((m) => m.value === mode)?.label ?? mode;
}

const EVENT_LABELS: Record<SubscriptionEventKind, string> = {
  STARTED: 'Started',
  PLAN_CHANGE_SCHEDULED: 'Plan change scheduled',
  PLAN_CHANGED: 'Plan changed',
  CYCLE_CHANGED: 'Billing cycle changed',
  STATUS_CHANGED: 'Status changed',
  DISCOUNT: 'Discount',
  CONTACT_CHANGED: 'Billing contact changed',
  CHANGE_REQUESTED: 'Change requested',
  CANCELLED: 'Cancelled',
};

export function eventLabel(kind: SubscriptionEventKind): string {
  return EVENT_LABELS[kind] ?? kind;
}

/** A plan that costs nothing either way (Free). */
export function isFreePlan(plan: Plan): boolean {
  return plan.priceMonthly === 0 && plan.priceYearly === 0;
}

/** "₹699.00 a month for up to 50 flats, then ₹12.00 a flat"; "Free, up to 15 flats". */
export function priceLabel(plan: Plan, cycle: SubscriptionCycle = 'MONTHLY'): string {
  const yearly = cycle === 'YEARLY';
  const price = yearly ? plan.priceYearly : plan.priceMonthly;
  const extra = yearly ? plan.extraFlatYearly : plan.extraFlatMonthly;
  const per = yearly ? 'a year' : 'a month';
  if (price === 0 && plan.maxFlats) return `Free, up to ${plan.maxFlats} flats`;
  if (!plan.includedFlats) return `${inr(price)} ${per}, any number of flats`;
  const base = `${inr(price)} ${per} for up to ${plan.includedFlats} flats`;
  if (plan.maxFlats != null && plan.maxFlats <= plan.includedFlats) return base;
  return extra != null ? `${base}, then ${inr(extra)} a flat` : base;
}

/** "₹699.00 + 8 extra flats × ₹12.00" for a period's charge (empty extras: just the price). */
export function chargeBreakdown(basePrice: number, extraFlats: number, extraRate: number | null): string {
  if (!extraFlats || extraRate == null) return inr(basePrice);
  return `${inr(basePrice)} + ${extraFlats} extra flat${extraFlats === 1 ? '' : 's'} × ${inr(extraRate)}`;
}

/** Who may do what with platform billing. */
@Injectable({ providedIn: 'root' })
export class BillingAccess {
  private readonly auth = inject(AuthStore);

  readonly platformView = () => this.auth.canOnPlatform('PLATFORM.BILLING.VIEW');
  readonly platformUpdate = () => this.auth.canOnPlatform('PLATFORM.BILLING.UPDATE');
  /** The society's own page (SECRETARY and above) or the platform. */
  readonly canView = (societyId: number | null) =>
    this.platformView() || this.auth.can('SOCIETY.SUBSCRIPTION.VIEW', societyId);
  /** Pay, change the billing contact, ask for a plan change. */
  readonly canUpdate = (societyId: number | null) =>
    this.platformUpdate() || this.auth.can('SOCIETY.SUBSCRIPTION.UPDATE', societyId);
}

// ---- Paying online ----


/** Outcome of "Pay now": paid (and verified), closed without paying, or an error message. */
export type PayOutcome =
  | { kind: 'paid'; invoice: PlatformInvoice }
  | { kind: 'dismissed' }
  | { kind: 'failed'; message: string };

/**
 * Pays an invoice through Razorpay Checkout: the backend creates the order, Checkout takes the
 * payment, and the backend verifies Razorpay's signature before recording it. If the tab closes
 * mid-way, Razorpay's webhook still records the payment.
 */
@Injectable({ providedIn: 'root' })
export class RazorpayCheckout {
  private readonly api = inject(SubscriptionApi);
  private readonly auth = inject(AuthStore);

  async pay(invoiceId: number): Promise<PayOutcome> {
    let order;
    try {
      order = await firstValueFrom(this.api.razorpayOrder(invoiceId));
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
    return new Promise<PayOutcome>((resolve) => {
      const checkout = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.merchantName,
        description: `Invoice ${order.invoiceNumber}`,
        order_id: order.orderId,
        prefill: { name: user?.name ?? '', contact: user?.phone ?? '', email: user?.email ?? '' },
        notes: { invoiceId: String(invoiceId) },
        theme: { color: '#2563eb' },
        handler: (response: RazorpayResponse) => {
          this.api
            .razorpayVerify(
              invoiceId,
              response.razorpay_order_id,
              response.razorpay_payment_id,
              response.razorpay_signature,
            )
            .subscribe({
              next: (invoice) => resolve({ kind: 'paid', invoice }),
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

// ---- Dialog styles ----

const DIALOG_STYLES = `
  mat-form-field {
    width: 100%;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0 12px;
  }
  .row mat-form-field {
    flex: 1 1 160px;
    width: auto;
  }
  .field-label {
    margin-bottom: 8px;
    color: var(--mat-sys-on-surface-variant);
    font: var(--mat-sys-label-large);
  }
  .toggles {
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .modules {
    display: flex;
    flex-direction: column;
    margin-bottom: 12px;
  }
  .hint {
    margin: 0 0 8px;
    color: var(--mat-sys-on-surface-variant);
    font: var(--mat-sys-body-small);
  }
  .dialog-error {
    margin: 0;
    color: var(--mat-sys-error);
  }
`;

const MONEY = [Validators.required, Validators.min(0), Validators.pattern(/^\d+(\.\d{1,2})?$/)];
const OPTIONAL_MONEY = [Validators.min(0), Validators.pattern(/^\d+(\.\d{1,2})?$/)];

/** An empty number field is null (not 0). */
function optionalNumber(value: number | string | null): number | null {
  return value === null || value === '' ? null : Number(value);
}

// ---- Plan (platform) ----

/** Creates a plan, or edits one (`plan` given). Closes with the saved plan. */
@Component({
  selector: 'app-plan-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data ? 'Edit ' + data.name : 'New plan' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Code</mat-label>
            <input matInput formControlName="code" maxlength="30" placeholder="STANDARD" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" maxlength="100" />
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Description (optional)</mat-label>
          <textarea matInput formControlName="description" rows="2" maxlength="1000"></textarea>
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>₹ a month (the society)</mat-label>
            <input matInput type="number" min="0" step="0.01" formControlName="priceMonthly" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>₹ a year (the society)</mat-label>
            <input matInput type="number" min="0" step="0.01" formControlName="priceYearly" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Flats included (empty: any)</mat-label>
            <input matInput type="number" min="1" formControlName="includedFlats" />
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>₹ per extra flat a month</mat-label>
            <input matInput type="number" min="0" step="0.01" formControlName="extraFlatMonthly" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>₹ per extra flat a year</mat-label>
            <input matInput type="number" min="0" step="0.01" formControlName="extraFlatYearly" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Max flats (empty: no limit)</mat-label>
            <input matInput type="number" min="1" formControlName="maxFlats" />
          </mat-form-field>
        </div>
        <p class="hint">
          A society pays the plan's price for up to the included flats, plus each flat beyond them at the
          extra-flat rate. A plan that stops at its included flats needs no extra-flat rate (set max flats).
        </p>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Recommended from (flats)</mat-label>
            <input matInput type="number" min="1" formControlName="recommendedFromFlats" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Commission on online payments (%)</mat-label>
            <input matInput type="number" min="0" max="100" step="0.01" formControlName="onlinePaymentCommissionPercent" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Order</mat-label>
            <input matInput type="number" formControlName="sortOrder" />
          </mat-form-field>
        </div>
        <div class="field-label">Paid modules included</div>
        <div class="modules">
          @for (m of modules; track m.value) {
            <mat-checkbox [checked]="selected().has(m.value)" (change)="toggle(m.value, $event.checked)">
              {{ m.label }}
            </mat-checkbox>
          }
        </div>
        <p class="hint">
          Sign-in, structure, residents, visitors, notices and complaints are in every plan. New prices
          apply to invoices issued from now on.
        </p>
        <div class="modules">
          <mat-checkbox formControlName="active">Offered to societies</mat-checkbox>
          <mat-checkbox formControlName="featured">Featured as "Most popular" (takes it off the other plan)</mat-checkbox>
        </div>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save plan' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class PlanDialog {
  protected readonly data = inject<Plan | null>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<PlanDialog, Plan>>(MatDialogRef);
  private readonly api = inject(SubscriptionApi);

  protected readonly modules = PLAN_MODULES;
  protected readonly selected = signal(new Set<PlanModule>(this.data?.modules ?? []));
  protected readonly form = inject(NonNullableFormBuilder).group({
    code: [this.data?.code ?? '', [Validators.required, Validators.pattern(/^[A-Za-z][A-Za-z0-9_]{1,29}$/)]],
    name: [this.data?.name ?? '', Validators.required],
    description: [this.data?.description ?? ''],
    priceMonthly: [this.data?.priceMonthly ?? (null as number | null), MONEY],
    priceYearly: [this.data?.priceYearly ?? (null as number | null), MONEY],
    includedFlats: [this.data?.includedFlats ?? (null as number | null), Validators.min(1)],
    extraFlatMonthly: [this.data?.extraFlatMonthly ?? (null as number | null), OPTIONAL_MONEY],
    extraFlatYearly: [this.data?.extraFlatYearly ?? (null as number | null), OPTIONAL_MONEY],
    maxFlats: [this.data?.maxFlats ?? (null as number | null), Validators.min(1)],
    recommendedFromFlats: [this.data?.recommendedFromFlats ?? 1, [Validators.required, Validators.min(1)]],
    sortOrder: [this.data?.sortOrder ?? 0],
    onlinePaymentCommissionPercent: [
      this.data?.onlinePaymentCommissionPercent ?? 0,
      [Validators.required, Validators.min(0), Validators.max(100)],
    ],
    active: [this.data?.active ?? true],
    featured: [this.data?.featured ?? false],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected toggle(module: PlanModule, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(module);
    else next.delete(module);
    this.selected.set(next);
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body: PlanRequest = {
      code: v.code.trim().toUpperCase(),
      name: v.name.trim(),
      description: v.description.trim() || null,
      priceMonthly: Number(v.priceMonthly),
      priceYearly: Number(v.priceYearly),
      includedFlats: v.includedFlats ? Number(v.includedFlats) : null,
      extraFlatMonthly: optionalNumber(v.extraFlatMonthly),
      extraFlatYearly: optionalNumber(v.extraFlatYearly),
      maxFlats: v.maxFlats ? Number(v.maxFlats) : null,
      recommendedFromFlats: Number(v.recommendedFromFlats) || 1,
      modules: [...this.selected()],
      active: v.active,
      sortOrder: Number(v.sortOrder) || 0,
      featured: v.featured,
      onlinePaymentCommissionPercent: Number(v.onlinePaymentCommissionPercent) || 0,
    };
    this.saving.set(true);
    this.error.set(null);
    (this.data ? this.api.updatePlan(this.data.id, body) : this.api.createPlan(body)).subscribe({
      next: (plan) => this.ref.close(plan),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function planDialog(dialog: MatDialog, plan: Plan | null): Observable<Plan> {
  return dialog
    .open<PlanDialog, Plan | null, Plan>(PlanDialog, { data: plan, width: '640px', maxWidth: 'calc(100vw - 32px)' })
    .afterClosed()
    .pipe(filter((p): p is Plan => p !== undefined));
}

// ---- Choosing a plan and cycle ----

export interface ChoosePlanData<T> {
  title: string;
  /** Shown above the form. */
  intro?: string;
  confirmText: string;
  plans: Plan[];
  planId: number | null;
  cycle: SubscriptionCycle;
  /** Asks for a note (a request to the platform). */
  withNote?: boolean;
  save: (planId: number | null, cycle: SubscriptionCycle, note: string | null) => Observable<T>;
}

/** Pick a plan and billing cycle: start a subscription, change a plan, or ask the platform for one. */
@Component({
  selector: 'app-choose-plan-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        @if (data.intro) {
          <p class="hint">{{ data.intro }}</p>
        }
        <mat-form-field appearance="outline">
          <mat-label>Plan</mat-label>
          <mat-select formControlName="planId">
            @for (p of data.plans; track p.id) {
              <mat-option [value]="p.id">{{ p.name }} · {{ priceLabel(p) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="field-label" id="cycle-label">Billed</div>
        <mat-button-toggle-group
          class="toggles"
          formControlName="cycle"
          aria-labelledby="cycle-label"
          [hideSingleSelectionIndicator]="true"
        >
          @for (c of cycles; track c.value) {
            <mat-button-toggle [value]="c.value">{{ c.label }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
        @if (data.withNote) {
          <mat-form-field appearance="outline">
            <mat-label>Note for the platform (optional)</mat-label>
            <textarea matInput formControlName="note" rows="2" maxlength="500"></textarea>
          </mat-form-field>
        }
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ saving() ? 'Saving…' : data.confirmText }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class ChoosePlanDialog<T> {
  protected readonly data = inject<ChoosePlanData<T>>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ChoosePlanDialog<T>, T>>(MatDialogRef);

  protected readonly cycles = CYCLES;
  protected readonly priceLabel = priceLabel;
  protected readonly form = inject(NonNullableFormBuilder).group({
    planId: [this.data.planId, Validators.required],
    cycle: [this.data.cycle, Validators.required],
    note: [''],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.data.save(v.planId, v.cycle, v.note.trim() || null).subscribe({
      next: (result) => this.ref.close(result),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function choosePlanDialog<T>(dialog: MatDialog, data: ChoosePlanData<T>): Observable<T> {
  return dialog
    .open<ChoosePlanDialog<T>, ChoosePlanData<T>, T>(ChoosePlanDialog, {
      data,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((r): r is T => r !== undefined));
}

// ---- Recording a payment (platform) ----

/** A bank transfer, UPI, cheque or cash payment against an invoice. Closes with the invoice. */
@Component({
  selector: 'app-record-platform-payment-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>Record payment for {{ data.summary.number }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="hint">{{ data.summary.societyName }} · {{ inr(data.summary.balance) }} to pay</p>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Amount (₹)</mat-label>
            <input matInput type="number" min="0.01" step="0.01" formControlName="amount" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Paid on</mat-label>
            <input matInput type="date" [max]="today" formControlName="paidOn" />
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Mode</mat-label>
            <mat-select formControlName="mode">
              @for (m of modes; track m.value) {
                <mat-option [value]="m.value">{{ m.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Reference (optional)</mat-label>
            <input matInput formControlName="reference" maxlength="100" />
          </mat-form-field>
        </div>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Record payment' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class RecordPlatformPaymentDialog {
  protected readonly data = inject<PlatformInvoice>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<RecordPlatformPaymentDialog, PlatformInvoice>>(MatDialogRef);
  private readonly api = inject(SubscriptionApi);

  protected readonly inr = inr;
  protected readonly today = todayIso();
  protected readonly modes = PAYMENT_MODES.filter((m) => m.value !== 'RAZORPAY');
  protected readonly form = inject(NonNullableFormBuilder).group({
    amount: [this.data.summary.balance as number | null, [Validators.required, Validators.min(0.01), Validators.max(this.data.summary.balance)]],
    paidOn: [this.today, Validators.required],
    mode: ['BANK_TRANSFER' as Exclude<PlatformPaymentMode, 'RAZORPAY'>, Validators.required],
    reference: [''],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .recordPayment(this.data.summary.id, {
        amount: Number(v.amount),
        mode: v.mode,
        reference: v.reference.trim() || undefined,
        paidOn: v.paidOn,
      })
      .subscribe({
        next: (invoice) => this.ref.close(invoice),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

export function recordPlatformPaymentDialog(
  dialog: MatDialog,
  invoice: PlatformInvoice,
): Observable<PlatformInvoice> {
  return dialog
    .open<RecordPlatformPaymentDialog, PlatformInvoice, PlatformInvoice>(RecordPlatformPaymentDialog, {
      data: invoice,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((i): i is PlatformInvoice => i !== undefined));
}

// ---- Amount + text (credit note, discount) ----

export interface AmountDialogData<T> {
  title: string;
  intro?: string;
  amountLabel: string;
  amount?: number | null;
  max?: number;
  /** A whole number (a percentage) rather than rupees. */
  whole?: boolean;
  /** A second whole-number field (e.g. how many periods). */
  countLabel?: string;
  count?: number;
  textLabel: string;
  textRequired?: boolean;
  confirmText: string;
  save: (amount: number, text: string | null, count: number) => Observable<T>;
}

/** An amount with a reason: a credit note, or a discount for a number of periods. */
@Component({
  selector: 'app-amount-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        @if (data.intro) {
          <p class="hint">{{ data.intro }}</p>
        }
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>{{ data.amountLabel }}</mat-label>
            <input matInput type="number" min="0" [step]="data.whole ? 1 : 0.01" formControlName="amount" />
          </mat-form-field>
          @if (data.countLabel) {
            <mat-form-field appearance="outline">
              <mat-label>{{ data.countLabel }}</mat-label>
              <input matInput type="number" min="0" step="1" formControlName="count" />
            </mat-form-field>
          }
        </div>
        <mat-form-field appearance="outline">
          <mat-label>{{ data.textLabel }}</mat-label>
          <textarea matInput formControlName="text" rows="2" maxlength="500"></textarea>
        </mat-form-field>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ saving() ? 'Saving…' : data.confirmText }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class AmountDialog<T> {
  protected readonly data = inject<AmountDialogData<T>>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AmountDialog<T>, T>>(MatDialogRef);

  protected readonly form = inject(NonNullableFormBuilder).group({
    amount: [
      this.data.amount ?? (null as number | null),
      [Validators.required, Validators.min(0), ...(this.data.max != null ? [Validators.max(this.data.max)] : [])],
    ],
    count: [this.data.count ?? 0, [Validators.min(0)]],
    text: ['', this.data.textRequired ? Validators.required : []],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.data.save(Number(v.amount), v.text.trim() || null, Number(v.count) || 0).subscribe({
      next: (result) => this.ref.close(result),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function amountDialog<T>(dialog: MatDialog, data: AmountDialogData<T>): Observable<T> {
  return dialog
    .open<AmountDialog<T>, AmountDialogData<T>, T>(AmountDialog, {
      data,
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((r): r is T => r !== undefined));
}

// ---- Billing contact ----

export interface ContactOption {
  id: number;
  label: string;
  hasEmail: boolean;
}

export interface BillingContactData<T> {
  options: ContactOption[];
  current: number | null;
  save: (userId: number) => Observable<T>;
}

/** Who gets the invoices, receipts and reminders: a member of the committee or staff. */
@Component({
  selector: 'app-billing-contact-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Billing contact</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="hint">
          Invoices, receipts and payment reminders go to this person, by push and email. Without a
          billing contact they go to the secretary and above.
        </p>
        <mat-form-field appearance="outline">
          <mat-label>Person</mat-label>
          <mat-select formControlName="userId">
            @for (o of data.options; track o.id) {
              <mat-option [value]="o.id">{{ o.label }}{{ o.hasEmail ? '' : ' · no email' }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class BillingContactDialog<T> {
  protected readonly data = inject<BillingContactData<T>>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<BillingContactDialog<T>, T>>(MatDialogRef);

  protected readonly form = inject(NonNullableFormBuilder).group({
    userId: [this.data.current, Validators.required],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    const userId = this.form.getRawValue().userId;
    if (userId == null || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.data.save(userId).subscribe({
      next: (result) => this.ref.close(result),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function billingContactDialog<T>(dialog: MatDialog, data: BillingContactData<T>): Observable<T> {
  return dialog
    .open<BillingContactDialog<T>, BillingContactData<T>, T>(BillingContactDialog, {
      data,
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((r): r is T => r !== undefined));
}
