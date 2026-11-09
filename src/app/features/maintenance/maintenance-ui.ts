/**
 * Maintenance presentation pieces shared by the maintenance pages: labels and tones, money and
 * period formatting, who-may-do-what, the section tabs and the dialogs. Add further maintenance
 * UI here rather than in new files.
 */
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injectable, computed, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Observable, catchError, filter, forkJoin, map, of, switchMap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { MaintenanceApi } from '../../core/api/maintenance.api';
import { StructureApi } from '../../core/api/structure.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  Account,
  BillStatus,
  BillingFrequency,
  CycleStatus,
  LateFeeType,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Refund,
  RefundStatus,
} from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { sortBy } from '../../shared/sort';
import { Tone } from '../../shared/ui';

// ---- Labels ----

export const BILL_STATUS: Record<BillStatus, { label: string; tone: Tone }> = {
  UNPAID: { label: 'Unpaid', tone: 'warning' },
  PARTIAL: { label: 'Part paid', tone: 'primary' },
  PAID: { label: 'Paid', tone: 'success' },
  WAIVED: { label: 'Waived', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/** Bills that still expect money. */
export const OPEN_BILL_STATUSES: readonly BillStatus[] = ['UNPAID', 'PARTIAL'];

export const CYCLE_STATUS: Record<CycleStatus, { label: string; tone: Tone }> = {
  ISSUED: { label: 'Issued', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  RECORDED: { label: 'Recorded', tone: 'success' },
  VOID: { label: 'Void', tone: 'danger' },
};

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: 'CASH', label: 'Cash', icon: 'payments' },
  { value: 'UPI', label: 'UPI', icon: 'qr_code_2' },
  { value: 'CHEQUE', label: 'Cheque', icon: 'receipt' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer', icon: 'account_balance' },
];

export function methodLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

export const FREQUENCIES: { value: BillingFrequency; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'HALF_YEARLY', label: 'Half-yearly' },
  { value: 'YEARLY', label: 'Yearly' },
];

export const LATE_FEE_TYPES: { value: LateFeeType; label: string; hint: string }[] = [
  { value: 'NONE', label: 'None', hint: 'Overdue bills are not charged extra.' },
  {
    value: 'FIXED',
    label: 'Fixed fee',
    hint: 'A one-time fee per overdue bill, added to the next bill.',
  },
  {
    value: 'SIMPLE_INTEREST',
    label: 'Interest',
    hint: 'Simple interest a year on the unpaid amount, for the days it is late.',
  },
];

// ---- Formatting ----

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₹2,625.00" (Indian digit grouping). */
export function inr(amount: number | null | undefined): string {
  return RUPEES.format(amount ?? 0);
}

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Parses yyyy-mm-dd as a local date (not UTC, which can be a day off). */
export function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayLabel(iso: string | null | undefined): string {
  return iso ? DAY.format(localDate(iso)) : '';
}

/** "Apr 2026" for a calendar month, "Apr 2026 – Jun 2026" for whole months, else the days. */
export function periodLabel(start: string, end: string): string {
  const s = localDate(start);
  const e = localDate(end);
  const lastOfMonth = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate() === e.getDate();
  if (s.getDate() === 1 && lastOfMonth) {
    const first = MONTH.format(s);
    const last = MONTH.format(e);
    return first === last ? first : `${first} – ${last}`;
  }
  return `${DAY.format(s)} – ${DAY.format(e)}`;
}

/** Local calendar date as yyyy-mm-dd. */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIso(): string {
  return isoDate(new Date());
}

/** How much of `total` is paid, 0–100, for progress bars. */
export function paidPercent(paid: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((paid / total) * 100));
}

// ---- Access ----

/**
 * What the signed-in user may do with maintenance in the selected society. The backend has the
 * final say; this only decides what to show.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceAccess {
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);

  private can(permission: string): boolean {
    return this.auth.can(permission, this.ctx.selectedSocietyId());
  }

  /**
   * Holds `permission` for the whole society rather than only for their own flat: platform-wide,
   * or through a role assigned without a flat (committee, secretary, a custom treasurer role).
   */
  private canSocietyWide(permission: string): boolean {
    if (this.auth.canOnPlatform(permission)) return true;
    const societyId = this.ctx.selectedSocietyId();
    if (!this.auth.can(permission, societyId)) return false;
    return (this.auth.user()?.roles ?? []).some(
      (r) => r.societyId === societyId && r.flatId == null,
    );
  }

  /** Sees every flat's bills, cycles and dues. */
  readonly committee = computed(() => this.canSocietyWide('MAINTENANCE.BILL.VIEW'));
  readonly canViewPayments = computed(() => this.can('MAINTENANCE.PAYMENT.VIEW'));
  readonly canIssue = computed(() => this.canSocietyWide('MAINTENANCE.BILL.CREATE'));
  /** Waive bills, cancel cycles, send reminders. */
  readonly canUpdateBills = computed(() => this.canSocietyWide('MAINTENANCE.BILL.UPDATE'));
  readonly canExportBills = computed(() => this.canSocietyWide('MAINTENANCE.BILL.EXPORT'));
  readonly canRecord = computed(() => this.canSocietyWide('MAINTENANCE.PAYMENT.CREATE'));
  readonly canVoid = computed(() => this.canSocietyWide('MAINTENANCE.PAYMENT.UPDATE'));
  readonly canExportPayments = computed(() => this.canSocietyWide('MAINTENANCE.PAYMENT.EXPORT'));
  readonly canViewConfig = computed(() => this.can('MAINTENANCE.CHARGE.VIEW'));
  readonly canConfigure = computed(() => this.canSocietyWide('MAINTENANCE.CHARGE.UPDATE'));
  readonly canSetArea = computed(() => this.can('FLAT.STRUCTURE.UPDATE'));
  /** Refund a flat's unused credit, or void a refund. */
  readonly canRefund = computed(() => this.canSocietyWide('MAINTENANCE.REFUND.CREATE'));
  readonly canApproveRefund = computed(() => this.canSocietyWide('MAINTENANCE.REFUND.APPROVE'));
  /** Keeps the books: may pick the cash/bank account a payment goes into. */
  readonly keepsBooks = computed(() => this.canSocietyWide('FINANCE.ACCOUNT.VIEW'));
  readonly userId = computed(() => this.auth.user()?.id ?? null);
}

export const REFUND_STATUS: Record<RefundStatus, { label: string; tone: Tone }> = {
  PENDING_APPROVAL: { label: 'Waiting for approval', tone: 'warning' },
  COMPLETED: { label: 'Refunded', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  VOID: { label: 'Void', tone: 'danger' },
};

// ---- Section tabs ----

/** Links between the maintenance pages, shown under each page header. */
@Component({
  selector: 'app-maintenance-tabs',
  imports: [MatTabsModule, RouterLink, RouterLinkActive],
  template: `
    <nav mat-tab-nav-bar [tabPanel]="panel" mat-stretch-tabs="false" aria-label="Maintenance">
      @for (tab of tabs(); track tab.link) {
        <a
          mat-tab-link
          [routerLink]="tab.link"
          routerLinkActive
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: tab.exact }"
          [active]="rla.isActive"
          >{{ tab.label }}</a
        >
      }
    </nav>
    <mat-tab-nav-panel #panel />
  `,
  styles: `
    :host {
      display: block;
      margin: -12px 0 20px;
    }
  `,
})
export class MaintenanceTabs {
  private readonly access = inject(MaintenanceAccess);

  protected readonly tabs = computed(() => {
    const a = this.access;
    const tabs = [
      { label: 'Dues', link: '/maintenance', exact: true },
      { label: 'Bills', link: '/maintenance/bills', exact: false },
    ];
    if (a.canViewPayments())
      tabs.push({ label: 'Payments', link: '/maintenance/payments', exact: false });
    if (a.canViewPayments())
      tabs.push({ label: 'Refunds', link: '/maintenance/refunds', exact: false });
    if (a.committee())
      tabs.push({ label: 'Billing cycles', link: '/maintenance/cycles', exact: false });
    if (a.canViewConfig())
      tabs.push({ label: 'Charges & settings', link: '/maintenance/settings', exact: false });
    return tabs;
  });
}

// ---- UPI ----

/** UPI apps truncate the transaction note; keep it short. */
const UPI_NOTE_MAX = 50;

/**
 * A `upi://pay` link (NPCI's UPI deep-link format) for the amount due. Scanned as a QR code or opened
 * on a phone, it fills in the payee, amount and note in the resident's UPI app.
 */
export function upiPayLink(p: {
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
}): string {
  const params = [
    ['pa', p.upiId],
    ['pn', p.payeeName],
    ['am', p.amount.toFixed(2)],
    ['cu', 'INR'],
    ['tn', p.note.slice(0, UPI_NOTE_MAX)],
  ];
  return 'upi://pay?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** A QR code image for `value` (rendered locally; nothing is sent anywhere). */
@Component({
  selector: 'app-qr-code',
  template: `
    @if (src(); as s) {
      <img [src]="s" [attr.width]="size()" [attr.height]="size()" [alt]="alt()" />
    } @else {
      <span class="placeholder" [style.width.px]="size()" [style.height.px]="size()"></span>
    }
  `,
  styles: `
    :host {
      display: inline-block;
      line-height: 0;
    }
    img {
      image-rendering: pixelated;
    }
    .placeholder {
      display: block;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
    }
  `,
})
export class QrCode {
  readonly value = input.required<string>();
  readonly size = input(180);
  readonly alt = input('QR code');
  protected readonly src = signal<string | null>(null);

  constructor() {
    effect(() => {
      const value = this.value();
      const size = this.size();
      // Loaded on first use, so the library stays out of every other page's bundle.
      import('qrcode')
        .then((qr) =>
          qr.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' }),
        )
        .then((url) => {
          if (value === this.value()) this.src.set(url);
        })
        .catch(() => this.src.set(null));
    });
  }
}

// ---- Flats ----

export interface FlatOption {
  id: number;
  wingName: string;
  flatNumber: string;
  /** "A-101" */
  label: string;
  areaSqft: number | null;
}

/** Every flat of the society, sorted by wing then flat number. */
export function societyFlats(structure: StructureApi, societyId: number): Observable<FlatOption[]> {
  return structure.wings(societyId).pipe(
    switchMap((wings) =>
      wings.length === 0
        ? of([])
        : forkJoin(
            sortBy(wings, (w) => w.name).map((wing) =>
              structure.flats(wing.id).pipe(
                map((flats) =>
                  sortBy(flats, (f) => f.flatNumber).map<FlatOption>((f) => ({
                    id: f.id,
                    wingName: wing.name,
                    flatNumber: f.flatNumber,
                    label: `${wing.name}-${f.flatNumber}`,
                    areaSqft: f.areaSqft ?? null,
                  })),
                ),
              ),
            ),
          ).pipe(map((lists) => lists.flat())),
    ),
  );
}

export function flatLabel(wingName: string, flatNumber: string): string {
  return `${wingName}-${flatNumber}`;
}

// ---- Reason dialog ----

export interface ReasonDialogData<T> {
  title: string;
  message: string;
  label: string;
  confirmText: string;
  /** Called with the trimmed reason; closes with its result or shows the error inline. */
  save: (reason: string) => Observable<T>;
}

/** Asks for the reason behind a waive, cancel or void, and runs it. */
@Component({
  selector: 'app-reason-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="message">{{ data.message }}</p>
        <mat-form-field appearance="outline">
          <mat-label>{{ data.label }}</mat-label>
          <textarea
            matInput
            formControlName="reason"
            rows="3"
            maxlength="2000"
            cdkFocusInitial
          ></textarea>
          @if (form.controls.reason.invalid) {
            <mat-error>A reason is required</mat-error>
          }
        </mat-form-field>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Keep</button>
        <button mat-flat-button type="submit" class="danger" [disabled]="saving()">
          {{ data.confirmText }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .message {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
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
export class ReasonDialog<T> {
  protected readonly data = inject<ReasonDialogData<T>>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ReasonDialog<T>, T>>(MatDialogRef);

  protected readonly form = inject(NonNullableFormBuilder).group({
    reason: ['', [Validators.required, Validators.pattern(/\S/)]],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.data.save(this.form.controls.reason.value.trim()).subscribe({
      next: (result) => this.ref.close(result),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

/** Emits the action's result once it succeeded; nothing if the dialog was dismissed. */
export function reasonDialog<T>(dialog: MatDialog, data: ReasonDialogData<T>): Observable<T> {
  return dialog
    .open<ReasonDialog<T>, ReasonDialogData<T>, T>(ReasonDialog, { data, width: '460px' })
    .afterClosed()
    .pipe(filter((result): result is T => result !== undefined));
}

// ---- Record payment ----

export interface RecordPaymentData {
  societyId: number;
  /** Preselected flat; omit to pick one. */
  flat?: { id: number; label: string };
  /** Pay this bill first (from a bill's page). */
  bill?: { id: number; number: string };
  /** Prefilled amount, e.g. the flat's outstanding. */
  amount?: number;
}

/** Records an offline payment; closes with the new payment (the receipt). */
@Component({
  selector: 'app-record-payment-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>Record payment</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        @if (data.flat; as flat) {
          <p class="for">
            <mat-icon>home</mat-icon>
            Flat <strong>{{ flat.label }}</strong>
            @if (data.bill; as bill) {
              · bill {{ bill.number }} first
            }
          </p>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Flat</mat-label>
            <mat-select formControlName="flatId">
              @for (f of flats(); track f.id) {
                <mat-option [value]="f.id">{{ f.label }}</mat-option>
              }
            </mat-select>
            @if (flatsError()) {
              <mat-hint>Couldn't load flats</mat-hint>
            }
            @if (form.controls.flatId.invalid) {
              <mat-error>Choose a flat</mat-error>
            }
          </mat-form-field>
        }

        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Amount</mat-label>
            <span matTextPrefix>₹&nbsp;</span>
            <input
              matInput
              type="number"
              inputmode="decimal"
              min="0.01"
              step="0.01"
              formControlName="amount"
            />
            @if (form.controls.amount.invalid) {
              <mat-error>Enter an amount above zero, up to 2 decimals</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Paid on</mat-label>
            <input matInput type="date" formControlName="paidOn" [max]="today" />
            @if (form.controls.paidOn.invalid) {
              <mat-error>Choose a date, not in the future</mat-error>
            }
          </mat-form-field>
        </div>

        <div class="field-label" id="method-label">Method</div>
        <mat-button-toggle-group
          formControlName="method"
          class="methods"
          aria-labelledby="method-label"
          [hideSingleSelectionIndicator]="true"
        >
          @for (m of methods; track m.value) {
            <mat-button-toggle [value]="m.value">
              <mat-icon>{{ m.icon }}</mat-icon>
              {{ m.label }}
            </mat-button-toggle>
          }
        </mat-button-toggle-group>

        <mat-form-field appearance="outline">
          <mat-label>{{ referenceLabel() }}</mat-label>
          <input matInput formControlName="reference" maxlength="100" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Note (optional)</mat-label>
          <input matInput formControlName="note" maxlength="2000" />
        </mat-form-field>
        @if (depositAccounts().length) {
          <mat-form-field appearance="outline">
            <mat-label>Into account (books)</mat-label>
            <mat-select formControlName="depositAccountId">
              <mat-option [value]="null">The usual account for this method</mat-option>
              @for (a of depositAccounts(); track a.id) {
                <mat-option [value]="a.id">{{ a.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        <p class="hint">
          Applied to the flat's oldest unpaid bills first. Anything above what the flat owes is kept
          as its credit and pays its next bills (unless the society doesn't accept advance
          payments).
        </p>
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
  styles: `
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
    .for {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .field-label {
      margin-bottom: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }
    .methods {
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .methods mat-icon {
      margin-right: 6px;
      vertical-align: middle;
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
  `,
})
export class RecordPaymentDialog {
  protected readonly data = inject<RecordPaymentData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<RecordPaymentDialog, Payment>>(MatDialogRef);
  private readonly api = inject(MaintenanceApi);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly today = todayIso();
  protected readonly form = inject(NonNullableFormBuilder).group({
    flatId: [this.data.flat?.id ?? (null as number | null), Validators.required],
    amount: [
      this.data.amount && this.data.amount > 0 ? this.data.amount : (null as number | null),
      [Validators.required, Validators.min(0.01), Validators.pattern(/^\d+(\.\d{1,2})?$/)],
    ],
    paidOn: [this.today, [Validators.required, notAfter(this.today)]],
    method: ['CASH' as PaymentMethod, Validators.required],
    reference: [''],
    note: [''],
    depositAccountId: [null as number | null],
  });
  /** Cash and bank ledgers of the books, once they are started (empty otherwise). */
  protected readonly depositAccounts = signal<{ id: number; name: string }[]>([]);
  private readonly method = signal<PaymentMethod>('CASH');
  protected readonly referenceLabel = computed(() =>
    this.method() === 'CHEQUE'
      ? 'Cheque number (optional)'
      : this.method() === 'CASH'
        ? 'Reference (optional)'
        : 'Transaction ID (optional)',
  );
  protected readonly flats = signal<FlatOption[]>([]);
  protected readonly flatsError = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.form.controls.method.valueChanges.subscribe((m) => this.method.set(m));
    if (inject(MaintenanceAccess).keepsBooks()) {
      cashAndBankAccounts(inject(FinanceApi), this.data.societyId).subscribe((accounts) =>
        this.depositAccounts.set(accounts),
      );
    }
    if (!this.data.flat) {
      societyFlats(inject(StructureApi), this.data.societyId)
        .pipe(catchError(() => (this.flatsError.set(true), of([]))))
        .subscribe((flats) => this.flats.set(flats));
    }
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .recordPayment(this.data.societyId, {
        flatId: v.flatId!,
        amount: Number(v.amount),
        paidOn: v.paidOn,
        method: v.method,
        reference: v.reference.trim() || undefined,
        note: v.note.trim() || undefined,
        billId: this.data.bill?.id,
        depositAccountId: v.depositAccountId ?? undefined,
      })
      .subscribe({
        next: (payment) => this.ref.close(payment),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

/** Emits the recorded payment; nothing if the dialog was dismissed. */
export function recordPaymentDialog(
  dialog: MatDialog,
  data: RecordPaymentData,
): Observable<Payment> {
  return dialog
    .open<RecordPaymentDialog, RecordPaymentData, Payment>(RecordPaymentDialog, {
      data,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((p): p is Payment => p !== undefined));
}

function notAfter(max: string) {
  return (control: { value: string }) =>
    control.value && control.value > max ? { future: true } : null;
}

// ---- Flat area ----

interface AreaDialogData {
  flatId: number;
  label: string;
}

/** Sets a flat's area, which per-sq-ft charge heads need. Closes with true once saved. */
@Component({
  selector: 'app-area-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Area of flat {{ data.label }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>Area</mat-label>
          <input
            matInput
            type="number"
            inputmode="decimal"
            min="0.01"
            step="0.01"
            formControlName="area"
            cdkFocusInitial
          />
          <span matTextSuffix>sq ft</span>
          @if (form.controls.area.invalid) {
            <mat-error>Enter the area in sq ft, up to 2 decimals</mat-error>
          }
        </mat-form-field>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving() || flatNumber() == null">
          Save
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class AreaDialog {
  protected readonly data = inject<AreaDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AreaDialog, boolean>>(MatDialogRef);
  private readonly structure = inject(StructureApi);

  protected readonly form = inject(NonNullableFormBuilder).group({
    area: [
      null as number | null,
      [Validators.required, Validators.min(0.01), Validators.pattern(/^\d{1,6}(\.\d{1,2})?$/)],
    ],
  });
  /** Updating a flat needs its number too; loaded first. */
  protected readonly flatNumber = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.structure.getFlat(this.data.flatId).subscribe({
      next: (flat) => {
        this.flatNumber.set(flat.flatNumber);
        if (flat.areaSqft) this.form.controls.area.setValue(flat.areaSqft);
      },
      error: (err: HttpErrorResponse) => this.error.set(errorMessage(err)),
    });
  }

  protected submit(): void {
    const flatNumber = this.flatNumber();
    if (this.form.invalid || this.saving() || flatNumber == null) return;
    this.saving.set(true);
    this.error.set(null);
    this.structure
      .updateFlat(this.data.flatId, flatNumber, Number(this.form.controls.area.value))
      .subscribe({
        next: () => this.ref.close(true),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

/** Emits true once the area was saved. */
export function areaDialog(dialog: MatDialog, data: AreaDialogData): Observable<boolean> {
  return dialog
    .open<AreaDialog, AreaDialogData, boolean>(AreaDialog, { data, width: '400px' })
    .afterClosed()
    .pipe(map((saved) => saved === true));
}

// ---- Books (finance) ----

/**
 * The cash and bank ledgers of the society's books, or none while the books aren't started (or can't be
 * read). Quiet: callers only offer the choice when there is one.
 */
export function cashAndBankAccounts(
  finance: FinanceApi,
  societyId: number,
): Observable<{ id: number; name: string }[]> {
  return finance.books(societyId, { silent: true }).pipe(
    switchMap((books) =>
      books.started ? finance.accounts(societyId, { silent: true }) : of([] as Account[]),
    ),
    map((accounts) => {
      const root = accounts.find((a) => a.systemKey === 'CASH_AND_BANK');
      if (!root) return [];
      const inside = new Set<number>([root.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const a of accounts) {
          if (a.parentId != null && inside.has(a.parentId) && !inside.has(a.id)) {
            inside.add(a.id);
            grew = true;
          }
        }
      }
      return accounts
        .filter((a) => inside.has(a.id) && !a.group && a.active)
        .map((a) => ({ id: a.id, name: a.name }));
    }),
    catchError(() => of([])),
  );
}

// ---- Refund credit ----

export interface RefundDialogData {
  societyId: number;
  flat: { id: number; label: string };
  /** The flat's unused credit: the most that can be refunded. */
  credit: number;
}

/** Pays a flat's unused credit back; closes with the refund. */
@Component({
  selector: 'app-refund-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>Refund credit</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="for">
          <mat-icon>home</mat-icon>
          Flat <strong>{{ data.flat.label }}</strong> · unused credit {{ inr(data.credit) }}
        </p>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Amount</mat-label>
            <span matTextPrefix>₹&nbsp;</span>
            <input
              matInput
              type="number"
              inputmode="decimal"
              min="0.01"
              step="0.01"
              [max]="data.credit"
              formControlName="amount"
              cdkFocusInitial
            />
            @if (form.controls.amount.invalid) {
              <mat-error>Up to {{ inr(data.credit) }}, up to 2 decimals</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Paid on</mat-label>
            <input matInput type="date" formControlName="paidOn" [max]="today" />
          </mat-form-field>
        </div>
        <mat-button-toggle-group
          formControlName="method"
          class="methods"
          aria-label="Method"
          [hideSingleSelectionIndicator]="true"
        >
          @for (m of methods; track m.value) {
            <mat-button-toggle [value]="m.value">{{ m.label }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
        @if (accounts().length) {
          <mat-form-field appearance="outline">
            <mat-label>Paid from (books)</mat-label>
            <mat-select formControlName="paidFromAccountId">
              <mat-option [value]="null">The usual paying account</mat-option>
              @for (a of accounts(); track a.id) {
                <mat-option [value]="a.id">{{ a.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Reference (optional)</mat-label>
          <input matInput formControlName="reference" maxlength="100" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Reason</mat-label>
          <input matInput formControlName="reason" maxlength="500" />
          @if (form.controls.reason.invalid) {
            <mat-error>A reason is required</mat-error>
          }
        </mat-form-field>
        <p class="hint">Large refunds may need a committee member's approval before they count.</p>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Refund' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
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
    .for {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .methods {
      flex-wrap: wrap;
      margin-bottom: 20px;
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
  `,
})
export class RefundDialog {
  protected readonly data = inject<RefundDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<RefundDialog, Refund>>(MatDialogRef);
  private readonly api = inject(MaintenanceApi);
  protected readonly inr = inr;
  protected readonly methods = PAYMENT_METHODS;
  protected readonly today = todayIso();
  protected readonly form = inject(NonNullableFormBuilder).group({
    amount: [
      this.data.credit as number | null,
      [
        Validators.required,
        Validators.min(0.01),
        Validators.max(this.data.credit),
        Validators.pattern(/^\d+(\.\d{1,2})?$/),
      ],
    ],
    paidOn: [this.today, [Validators.required, notAfter(this.today)]],
    method: ['BANK_TRANSFER' as PaymentMethod],
    paidFromAccountId: [null as number | null],
    reference: [''],
    reason: ['', [Validators.required, Validators.pattern(/\S/)]],
  });
  protected readonly accounts = signal<{ id: number; name: string }[]>([]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (inject(MaintenanceAccess).keepsBooks()) {
      cashAndBankAccounts(inject(FinanceApi), this.data.societyId).subscribe((a) =>
        this.accounts.set(a),
      );
    }
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .recordRefund(this.data.societyId, {
        flatId: this.data.flat.id,
        amount: Number(v.amount),
        paidOn: v.paidOn,
        method: v.method,
        reason: v.reason.trim(),
        reference: v.reference.trim() || undefined,
        paidFromAccountId: v.paidFromAccountId ?? undefined,
      })
      .subscribe({
        next: (refund) => this.ref.close(refund),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

/** Emits the refund; nothing if the dialog was dismissed. */
export function refundDialog(dialog: MatDialog, data: RefundDialogData): Observable<Refund> {
  return dialog
    .open<RefundDialog, RefundDialogData, Refund>(RefundDialog, {
      data,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((r): r is Refund => r !== undefined));
}
