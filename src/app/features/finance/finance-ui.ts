/**
 * Finance presentation pieces shared by the finance pages: labels, the chart helpers, who-may-do-what,
 * the section tabs and the dialogs. Money and date formatting come from the maintenance helpers.
 * Add further finance UI here rather than in new files.
 */
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injectable, computed, inject, signal } from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Observable, filter } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  Account,
  AccountType,
  BankAccountType,
  Voucher,
  VoucherStatus,
  VoucherType,
} from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { Tone } from '../../shared/ui';
import { inr, todayIso } from '../maintenance/maintenance-ui';

// ---- Labels ----

export const ACCOUNT_TYPES: { value: AccountType; label: string; plural: string }[] = [
  { value: 'ASSET', label: 'Asset', plural: 'Assets' },
  { value: 'LIABILITY', label: 'Liability', plural: 'Liabilities' },
  { value: 'FUND', label: 'Fund', plural: 'Funds' },
  { value: 'INCOME', label: 'Income', plural: 'Income' },
  { value: 'EXPENSE', label: 'Expense', plural: 'Expenses' },
];

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type;
}

export const VOUCHER_TYPE: Record<VoucherType, { label: string; icon: string }> = {
  RECEIPT: { label: 'Receipt', icon: 'call_received' },
  PAYMENT: { label: 'Payment', icon: 'call_made' },
  CONTRA: { label: 'Transfer', icon: 'swap_horiz' },
  JOURNAL: { label: 'Journal', icon: 'edit_note' },
  OPENING: { label: 'Opening balances', icon: 'flag' },
  SYSTEM: { label: 'From maintenance', icon: 'receipt_long' },
};

export const VOUCHER_STATUS: Record<VoucherStatus, { label: string; tone: Tone }> = {
  PENDING_APPROVAL: { label: 'Waiting for approval', tone: 'warning' },
  POSTED: { label: 'Posted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  VOID: { label: 'Void', tone: 'danger' },
};

export const BANK_ACCOUNT_TYPES: { value: BankAccountType; label: string }[] = [
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CURRENT', label: 'Current' },
];

/** "₹1,200.00 Dr" style isn't used: balances show in the account's natural sign, negatives in red. */
export function signedInr(amount: number): string {
  return amount < 0 ? `−${inr(-amount)}` : inr(amount);
}

// ---- Chart helpers ----

export const SYSTEM = {
  CASH_AND_BANK: 'CASH_AND_BANK',
  BANK_ACCOUNTS: 'BANK_ACCOUNTS',
  CASH: 'CASH',
  MEMBER_DUES: 'MEMBER_DUES',
  MEMBER_ADVANCE: 'MEMBER_ADVANCE',
  GENERAL_FUND: 'GENERAL_FUND',
} as const;

const MEMBER_KEYS = new Set<string>([SYSTEM.MEMBER_DUES, SYSTEM.MEMBER_ADVANCE]);

/** An account with its depth in the tree, for indented lists and pickers. */
export interface ChartRow {
  account: Account;
  depth: number;
  /** "Expenses › Utilities" */
  path: string;
}

/** The chart in tree order (each type's root, then its children by code), with depth. */
export function chartRows(accounts: Account[]): ChartRow[] {
  const children = new Map<number | null, Account[]>();
  for (const a of accounts) {
    const list = children.get(a.parentId) ?? [];
    list.push(a);
    children.set(a.parentId, list);
  }
  for (const list of children.values())
    list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const rows: ChartRow[] = [];
  const walk = (parent: number | null, depth: number, path: string) => {
    for (const a of children.get(parent) ?? []) {
      rows.push({ account: a, depth, path });
      walk(a.id, depth + 1, path ? `${path} › ${a.name}` : a.name);
    }
  };
  walk(null, 0, '');
  return rows;
}

/** Ledgers under "Cash & bank": where money actually sits. */
export function moneyAccounts(accounts: Account[], activeOnly = true): Account[] {
  const root = accounts.find((a) => a.systemKey === SYSTEM.CASH_AND_BANK);
  if (!root) return [];
  const inside = new Set<number>([root.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of accounts) {
      if (a.parentId != null && inside.has(a.parentId) && !inside.has(a.id)) {
        inside.add(a.id);
        grew = true;
      }
    }
  }
  return accounts.filter((a) => inside.has(a.id) && !a.group && (!activeOnly || a.active));
}

/** Ledgers a hand-made entry may use on its non-money side: active, not cash/bank, not member accounts. */
export function entryAccounts(accounts: Account[], types?: AccountType[]): ChartRow[] {
  const money = new Set(moneyAccounts(accounts, false).map((a) => a.id));
  return chartRows(accounts).filter(
    (r) =>
      !r.account.group &&
      r.account.active &&
      !money.has(r.account.id) &&
      !MEMBER_KEYS.has(r.account.systemKey ?? '') &&
      (!types || types.includes(r.account.type)),
  );
}

/** Ledgers a journal may use: any active ledger except the member accounts. */
export function journalAccounts(accounts: Account[]): ChartRow[] {
  return chartRows(accounts).filter(
    (r) => !r.account.group && r.account.active && !MEMBER_KEYS.has(r.account.systemKey ?? ''),
  );
}

export function isProtected(account: Account): boolean {
  return account.parentId == null || account.systemKey != null;
}

// ---- Access ----

/**
 * What the signed-in user may do with the books of the selected society. Every finance permission
 * counts only through a society-wide role (not a flat's resident role), like the backend.
 */
@Injectable({ providedIn: 'root' })
export class FinanceAccess {
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);

  private wide(permission: string): boolean {
    if (this.auth.canOnPlatform(permission)) return true;
    const societyId = this.ctx.selectedSocietyId();
    if (!this.auth.can(permission, societyId)) return false;
    return (this.auth.user()?.roles ?? []).some(
      (r) => r.societyId === societyId && r.flatId == null,
    );
  }

  readonly canView = computed(() => this.wide('FINANCE.ACCOUNT.VIEW'));
  readonly canViewVouchers = computed(() => this.wide('FINANCE.VOUCHER.VIEW'));
  readonly canRecord = computed(() => this.wide('FINANCE.VOUCHER.CREATE'));
  readonly canJournal = computed(() => this.wide('FINANCE.JOURNAL.CREATE'));
  readonly canVoid = computed(() => this.wide('FINANCE.VOUCHER.UPDATE'));
  readonly canApprove = computed(() => this.wide('FINANCE.VOUCHER.APPROVE'));
  readonly canManage = computed(() => this.wide('FINANCE.ACCOUNT.UPDATE'));
  readonly canReports = computed(() => this.wide('FINANCE.REPORT.VIEW'));
  readonly canExport = computed(() => this.wide('FINANCE.REPORT.EXPORT'));
  readonly canAudit = computed(() => this.wide('FINANCE.AUDIT.VIEW'));
  readonly canReconcile = computed(() => this.wide('FINANCE.RECONCILIATION.VIEW'));
  /** Column mapping, statements, imports and matching. */
  readonly canReconcileEdit = computed(() => this.wide('FINANCE.RECONCILIATION.UPDATE'));
  /** Complete and reopen a reconciliation. */
  readonly canReconcileComplete = computed(() => this.wide('FINANCE.RECONCILIATION.COMPLETE'));
  /** Residents: may ask for the summary (the society decides whether they get it). */
  readonly canSummary = computed(() =>
    this.auth.can('FINANCE.SUMMARY.VIEW', this.ctx.selectedSocietyId()),
  );
  readonly userId = computed(() => this.auth.user()?.id ?? null);
}

// ---- Section tabs ----

@Component({
  selector: 'app-finance-tabs',
  imports: [MatTabsModule, RouterLink, RouterLinkActive],
  template: `
    <nav mat-tab-nav-bar [tabPanel]="panel" mat-stretch-tabs="false" aria-label="Finance">
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
export class FinanceTabs {
  private readonly access = inject(FinanceAccess);

  protected readonly tabs = computed(() => {
    const a = this.access;
    const tabs = [{ label: 'Overview', link: '/finance', exact: true }];
    if (a.canViewVouchers())
      tabs.push({ label: 'Entries', link: '/finance/entries', exact: false });
    tabs.push({ label: 'Accounts', link: '/finance/accounts', exact: false });
    if (a.canReconcile())
      tabs.push({ label: 'Reconcile', link: '/finance/reconcile', exact: false });
    if (a.canReports()) tabs.push({ label: 'Reports', link: '/finance/reports', exact: false });
    tabs.push({ label: 'Settings', link: '/finance/settings', exact: false });
    if (a.canAudit()) tabs.push({ label: 'Audit log', link: '/finance/audit', exact: false });
    return tabs;
  });
}

// ---- Entry dialog (receipt, payment, transfer, journal) ----

export type EntryKind = 'RECEIPT' | 'PAYMENT' | 'CONTRA' | 'JOURNAL';

export interface EntryDialogData {
  societyId: number;
  kind: EntryKind;
  accounts: Account[];
  /** Preselected cash/bank ledger (e.g. the books' default paying account). */
  moneyAccountId?: number | null;
  /** Edit a waiting payment or journal instead of recording a new one. */
  voucher?: Voucher;
}

type LineForm = FormGroup<{
  accountId: FormControl<number | null>;
  amount: FormControl<number | null>;
  side: FormControl<'DEBIT' | 'CREDIT'>;
}>;

const AMOUNT = [Validators.required, Validators.min(0.01), Validators.pattern(/^\d+(\.\d{1,2})?$/)];

/** Records (or edits) a hand-made entry; closes with the saved voucher. */
@Component({
  selector: 'app-entry-dialog',
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
    <h2 mat-dialog-title>{{ title }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="hint">{{ hint }}</p>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput type="date" formControlName="date" [max]="today" />
          </mat-form-field>
          @if (kind === 'RECEIPT' || kind === 'PAYMENT') {
            <mat-form-field appearance="outline">
              <mat-label>{{ kind === 'RECEIPT' ? 'Received into' : 'Paid from' }}</mat-label>
              <mat-select formControlName="money">
                @for (a of money; track a.id) {
                  <mat-option [value]="a.id">{{ a.name }}</mat-option>
                }
              </mat-select>
              @if (form.controls.money.invalid) {
                <mat-error>Choose the cash or bank account</mat-error>
              }
            </mat-form-field>
          }
        </div>

        @if (kind === 'CONTRA') {
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>From</mat-label>
              <mat-select formControlName="from">
                @for (a of money; track a.id) {
                  <mat-option [value]="a.id">{{ a.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>To</mat-label>
              <mat-select formControlName="to">
                @for (a of money; track a.id) {
                  <mat-option [value]="a.id">{{ a.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
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
          </mat-form-field>
        } @else {
          <div class="lines" formArrayName="lines">
            @for (line of lines.controls; track line; let i = $index) {
              <div class="line" [formGroupName]="i">
                <mat-form-field appearance="outline" class="account">
                  <mat-label>{{
                    kind === 'RECEIPT'
                      ? 'Income or other account'
                      : kind === 'PAYMENT'
                        ? 'Expense or other account'
                        : 'Account'
                  }}</mat-label>
                  <mat-select formControlName="accountId">
                    @for (r of options; track r.account.id) {
                      <mat-option [value]="r.account.id">
                        {{ r.account.code }} · {{ r.account.name }}
                        <span class="path">{{ r.path }}</span>
                      </mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                @if (kind === 'JOURNAL') {
                  <mat-button-toggle-group
                    formControlName="side"
                    [hideSingleSelectionIndicator]="true"
                    aria-label="Debit or credit"
                  >
                    <mat-button-toggle value="DEBIT">Dr</mat-button-toggle>
                    <mat-button-toggle value="CREDIT">Cr</mat-button-toggle>
                  </mat-button-toggle-group>
                }
                <mat-form-field appearance="outline" class="amount">
                  <mat-label>Amount</mat-label>
                  <input
                    matInput
                    type="number"
                    inputmode="decimal"
                    min="0.01"
                    step="0.01"
                    formControlName="amount"
                  />
                </mat-form-field>
                @if (lines.length > minLines) {
                  <button
                    mat-icon-button
                    type="button"
                    (click)="removeLine(i)"
                    aria-label="Remove line"
                  >
                    <mat-icon>close</mat-icon>
                  </button>
                }
              </div>
            }
          </div>
          <div class="lines-foot">
            <button mat-button type="button" (click)="addLine()">
              <mat-icon>add</mat-icon>Add line
            </button>
            @if (kind === 'JOURNAL') {
              <span [class.danger-text]="difference() !== 0">
                Dr {{ inr(totals().debit) }} · Cr {{ inr(totals().credit) }}
                @if (difference() !== 0) {
                  · off by {{ inr(abs(difference())) }}
                }
              </span>
            } @else {
              <span>Total {{ inr(totals().debit + totals().credit) }}</span>
            }
          </div>
        }

        @if (kind === 'RECEIPT' || kind === 'PAYMENT') {
          <mat-form-field appearance="outline">
            <mat-label>{{ kind === 'RECEIPT' ? 'Received from (optional)' : 'Paid to' }}</mat-label>
            <input matInput formControlName="payee" maxlength="200" />
            @if (form.controls.payee.invalid) {
              <mat-error>Say who was paid</mat-error>
            }
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Reference (cheque no., UPI ref, invoice no.)</mat-label>
          <input matInput formControlName="reference" maxlength="100" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>{{
            kind === 'JOURNAL' ? 'Narration (why this entry)' : 'Narration (optional)'
          }}</mat-label>
          <textarea matInput rows="2" formControlName="narration" maxlength="500"></textarea>
          @if (form.controls.narration.invalid) {
            <mat-error>A journal entry needs a narration</mat-error>
          }
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
      flex: 1 1 180px;
      width: auto;
    }
    .hint {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .lines {
      display: flex;
      flex-direction: column;
    }
    .line {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 0 8px;
    }
    .line .account {
      flex: 1 1 240px;
      width: auto;
    }
    .line .amount {
      flex: 0 1 140px;
      width: auto;
    }
    .line mat-button-toggle-group {
      margin-top: 6px;
    }
    .path {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .lines-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: -4px 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .danger-text {
      color: var(--mat-sys-error);
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class EntryDialog {
  protected readonly data = inject<EntryDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<EntryDialog, Voucher>>(MatDialogRef);
  private readonly api = inject(FinanceApi);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly inr = inr;
  protected readonly abs = Math.abs;
  protected readonly today = todayIso();
  protected readonly kind = this.data.kind;
  protected readonly money = moneyAccounts(this.data.accounts);
  protected readonly options =
    this.kind === 'JOURNAL'
      ? journalAccounts(this.data.accounts)
      : entryAccounts(
          this.data.accounts,
          this.kind === 'RECEIPT'
            ? ['INCOME', 'FUND', 'LIABILITY', 'ASSET']
            : ['EXPENSE', 'ASSET', 'LIABILITY', 'FUND'],
        );
  protected readonly minLines = this.kind === 'JOURNAL' ? 2 : 1;
  protected readonly title =
    (this.data.voucher ? 'Edit ' : 'Record ') +
    { RECEIPT: 'income', PAYMENT: 'expense', CONTRA: 'transfer', JOURNAL: 'journal entry' }[
      this.kind
    ];
  protected readonly hint = {
    RECEIPT: 'Money that came in, into a cash or bank account, and what it was for.',
    PAYMENT:
      'Money paid out of a cash or bank account, and what it was for. Large amounts may need a second person to approve.',
    CONTRA: 'Money moved between cash and bank, e.g. cash deposited in the bank.',
    JOURNAL: 'Debits and credits by hand, for adjustments. They must add up to the same total.',
  }[this.kind];

  private readonly v = this.data.voucher;
  protected readonly form = this.fb.group({
    date: [this.v?.date ?? this.today, Validators.required],
    money: [
      this.initialMoney(),
      this.kind === 'RECEIPT' || this.kind === 'PAYMENT' ? Validators.required : [],
    ],
    from: [this.money[0]?.id ?? (null as number | null)],
    to: [this.money[1]?.id ?? (null as number | null)],
    amount: [null as number | null, this.kind === 'CONTRA' ? AMOUNT : []],
    payee: [
      this.v?.payee ?? '',
      this.kind === 'PAYMENT' ? [Validators.required, Validators.pattern(/\S/)] : [],
    ],
    reference: [this.v?.reference ?? ''],
    narration: [
      this.v?.narration ?? '',
      this.kind === 'JOURNAL' ? [Validators.required, Validators.pattern(/\S/)] : [],
    ],
    lines: this.fb.array<LineForm>([]),
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly lineValues = signal(0);

  constructor() {
    const moneyIds = new Set(this.money.map((a) => a.id));
    const existing =
      this.v?.lines.filter((l) => this.kind === 'JOURNAL' || !moneyIds.has(l.accountId)) ?? [];
    if (existing.length)
      existing.forEach((l) =>
        this.addLine(l.accountId, l.debit || l.credit, l.debit > 0 ? 'DEBIT' : 'CREDIT'),
      );
    else
      for (let i = 0; i < this.minLines; i++)
        this.addLine(null, null, i === 0 ? 'DEBIT' : 'CREDIT');
    this.form.controls.lines.valueChanges.subscribe(() => this.lineValues.update((n) => n + 1));
  }

  protected get lines(): FormArray<LineForm> {
    return this.form.controls.lines;
  }

  protected readonly totals = computed(() => {
    this.lineValues();
    let debit = 0;
    let credit = 0;
    for (const l of this.lines.getRawValue()) {
      const amount = Number(l.amount) || 0;
      if (this.kind === 'JOURNAL' && l.side === 'CREDIT') credit += amount;
      else debit += amount;
    }
    return { debit: round(debit), credit: round(credit) };
  });

  protected readonly difference = computed(() => round(this.totals().debit - this.totals().credit));

  protected addLine(
    accountId: number | null = null,
    amount: number | null = null,
    side: 'DEBIT' | 'CREDIT' = 'DEBIT',
  ): void {
    this.lines.push(
      this.fb.group({
        accountId: [accountId, Validators.required],
        amount: [amount, AMOUNT],
        side: [side],
      }),
    );
    this.lineValues.update((n) => n + 1);
  }

  protected removeLine(i: number): void {
    this.lines.removeAt(i);
    this.lineValues.update((n) => n + 1);
  }

  private initialMoney(): number | null {
    if (this.v) {
      const ids = new Set(moneyAccounts(this.data.accounts, false).map((a) => a.id));
      return this.v.lines.find((l) => ids.has(l.accountId))?.accountId ?? null;
    }
    return this.data.moneyAccountId ?? moneyAccounts(this.data.accounts)[0]?.id ?? null;
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.kind === 'JOURNAL' && this.difference() !== 0) {
      this.error.set('Debits and credits must be equal');
      return;
    }
    const v = this.form.getRawValue();
    const text = (s: string) => s.trim() || undefined;
    const lines = v.lines.map((l) => ({ accountId: l.accountId!, amount: Number(l.amount) }));
    const societyId = this.data.societyId;
    let call: Observable<Voucher>;
    switch (this.kind) {
      case 'RECEIPT':
        call = this.api.recordReceipt(societyId, {
          date: v.date,
          depositAccountId: v.money!,
          lines,
          payee: text(v.payee),
          reference: text(v.reference),
          narration: text(v.narration),
        });
        break;
      case 'PAYMENT': {
        const body = {
          date: v.date,
          payingAccountId: v.money!,
          lines,
          payee: v.payee.trim(),
          reference: text(v.reference),
          narration: text(v.narration),
        };
        call = this.v
          ? this.api.updatePayment(this.v.id, body)
          : this.api.recordPayment(societyId, body);
        break;
      }
      case 'CONTRA':
        if (v.from === v.to) {
          this.error.set('Choose two different accounts');
          return;
        }
        call = this.api.recordContra(societyId, {
          date: v.date,
          fromAccountId: v.from!,
          toAccountId: v.to!,
          amount: Number(v.amount),
          reference: text(v.reference),
          narration: text(v.narration),
        });
        break;
      case 'JOURNAL': {
        const body = {
          date: v.date,
          narration: v.narration.trim(),
          reference: text(v.reference),
          lines: v.lines.map((l) =>
            l.side === 'DEBIT'
              ? { accountId: l.accountId!, debit: Number(l.amount) }
              : { accountId: l.accountId!, credit: Number(l.amount) },
          ),
        };
        call = this.v
          ? this.api.updateJournal(this.v.id, body)
          : this.api.recordJournal(societyId, body);
        break;
      }
    }
    this.saving.set(true);
    this.error.set(null);
    call.subscribe({
      next: (voucher) => this.ref.close(voucher),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Emits the saved voucher; nothing if the dialog was dismissed. */
export function entryDialog(dialog: MatDialog, data: EntryDialogData): Observable<Voucher> {
  return dialog
    .open<EntryDialog, EntryDialogData, Voucher>(EntryDialog, {
      data,
      width: '640px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((v): v is Voucher => v !== undefined));
}

// ---- Account dialog ----

export interface AccountDialogData {
  societyId: number;
  accounts: Account[];
  /** Edit this account; otherwise create one. */
  account?: Account;
  /** For a new account: the group to put it in. */
  parentId?: number;
}

/** Creates or edits a group or ledger of the chart; closes with the saved account. */
@Component({
  selector: 'app-account-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.account ? 'Edit account' : 'New account' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <div class="row">
          <mat-form-field appearance="outline" class="code">
            <mat-label>Code</mat-label>
            <input matInput formControlName="code" maxlength="20" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" maxlength="100" cdkFocusInitial />
          </mat-form-field>
        </div>
        @if (!isRoot) {
          <mat-form-field appearance="outline">
            <mat-label>Under</mat-label>
            <mat-select formControlName="parentId">
              @for (r of groups; track r.account.id) {
                <mat-option [value]="r.account.id">
                  <span [style.padding-left.px]="r.depth * 12"
                    >{{ r.account.code }} · {{ r.account.name }}</span
                  >
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        @if (!protectedAccount) {
          <mat-checkbox formControlName="group"
            >A group (holds other accounts, takes no entries)</mat-checkbox
          >
        }
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
  styles: `
    mat-form-field {
      width: 100%;
    }
    .row {
      display: flex;
      gap: 0 12px;
    }
    .row .code {
      flex: 0 0 120px;
    }
    .dialog-error {
      margin: 12px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class AccountDialog {
  protected readonly data = inject<AccountDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AccountDialog, Account>>(MatDialogRef);
  private readonly api = inject(FinanceApi);

  private readonly a = this.data.account;
  protected readonly isRoot = this.a?.parentId === null;
  protected readonly protectedAccount = !!this.a && isProtected(this.a);
  private readonly type =
    this.a?.type ?? this.data.accounts.find((x) => x.id === this.data.parentId)?.type;
  protected readonly groups = chartRows(this.data.accounts).filter(
    (r) =>
      r.account.group &&
      r.account.active &&
      r.account.id !== this.a?.id &&
      (!this.type || r.account.type === this.type),
  );
  protected readonly form = inject(NonNullableFormBuilder).group({
    code: [
      this.a?.code ?? '',
      [Validators.required, Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9./-]{0,19}$/)],
    ],
    name: [this.a?.name ?? '', [Validators.required, Validators.pattern(/\S/)]],
    parentId: [
      this.a?.parentId ?? this.data.parentId ?? (null as number | null),
      this.isRoot ? [] : Validators.required,
    ],
    group: [this.a?.group ?? false],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const call = this.a
      ? this.api.updateAccount(this.a.id, {
          code: v.code.trim(),
          name: v.name.trim(),
          parentId: this.isRoot ? undefined : v.parentId!,
          group: this.protectedAccount ? undefined : v.group,
        })
      : this.api.createAccount(this.data.societyId, {
          code: v.code.trim(),
          name: v.name.trim(),
          parentId: v.parentId!,
          group: v.group,
        });
    this.saving.set(true);
    this.error.set(null);
    call.subscribe({
      next: (account) => this.ref.close(account),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function accountDialog(dialog: MatDialog, data: AccountDialogData): Observable<Account> {
  return dialog
    .open<AccountDialog, AccountDialogData, Account>(AccountDialog, {
      data,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((a): a is Account => a !== undefined));
}

// ---- Bank account dialog ----

export interface BankDialogData {
  societyId: number;
  /** Edit this bank ledger; otherwise add one. */
  account?: Account;
}

/** Adds or edits a bank account (only the last 4 digits of its number are kept). */
@Component({
  selector: 'app-bank-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.account ? 'Edit bank account' : 'Add bank account' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>Name in the books</mat-label>
          <input
            matInput
            formControlName="name"
            maxlength="100"
            placeholder="HDFC Savings"
            cdkFocusInitial
          />
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Bank</mat-label>
            <input matInput formControlName="bankName" maxlength="100" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Type</mat-label>
            <mat-select formControlName="accountType">
              @for (t of types; track t.value) {
                <mat-option [value]="t.value">{{ t.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Last 4 digits (optional)</mat-label>
            <input matInput formControlName="last4" maxlength="4" inputmode="numeric" />
            @if (form.controls.last4.invalid) {
              <mat-error>Exactly 4 digits</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>IFSC (optional)</mat-label>
            <input matInput formControlName="ifsc" maxlength="11" />
            @if (form.controls.ifsc.invalid) {
              <mat-error>Like HDFC0001234</mat-error>
            }
          </mat-form-field>
        </div>
        <p class="hint">
          Only the last 4 digits of the account number are stored. Never enter passwords or PINs.
        </p>
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
    .hint {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .dialog-error {
      margin: 12px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class BankDialog {
  protected readonly data = inject<BankDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<BankDialog, Account>>(MatDialogRef);
  private readonly api = inject(FinanceApi);
  protected readonly types = BANK_ACCOUNT_TYPES;
  private readonly a = this.data.account;
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.a?.name ?? '', [Validators.required, Validators.pattern(/\S/)]],
    bankName: [this.a?.bank?.bankName ?? '', [Validators.required, Validators.pattern(/\S/)]],
    accountType: [this.a?.bank?.accountType ?? ('SAVINGS' as BankAccountType)],
    last4: [this.a?.bank?.last4 ?? '', Validators.pattern(/^(\d{4})?$/)],
    ifsc: [this.a?.bank?.ifsc ?? '', Validators.pattern(/^([A-Za-z]{4}0[A-Za-z0-9]{6})?$/)],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      name: v.name.trim(),
      bankName: v.bankName.trim(),
      accountType: v.accountType,
      last4: v.last4.trim(),
      ifsc: v.ifsc.trim().toUpperCase(),
    };
    const call = this.a
      ? this.api.updateBank(this.a.id, body)
      : this.api.addBank(this.data.societyId, {
          ...body,
          last4: body.last4 || undefined,
          ifsc: body.ifsc || undefined,
        });
    this.saving.set(true);
    this.error.set(null);
    call.subscribe({
      next: (account) => this.ref.close(account),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function bankDialog(dialog: MatDialog, data: BankDialogData): Observable<Account> {
  return dialog
    .open<BankDialog, BankDialogData, Account>(BankDialog, {
      data,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((a): a is Account => a !== undefined));
}
