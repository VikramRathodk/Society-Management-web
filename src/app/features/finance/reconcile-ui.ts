/**
 * Bank reconciliation pieces shared by the Reconcile pages: labels, date and amount helpers, and the
 * dialogs (statement period, import with the column mapping, an entry recorded from a bank line).
 */
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Observable, Subject, debounceTime, filter, of, switchMap } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { FinanceApi } from '../../core/api/finance.api';
import { ReconciliationApi } from '../../core/api/reconciliation.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  Account,
  AmountStyle,
  BankLine,
  BankLineState,
  BankStatement,
  BookEntry,
  ImportResult,
  Ledger,
  LineVoucherResult,
  MappingSource,
  StatementMapping,
  StatementPreview,
  StatementStatus,
} from '../../core/models';
import { Tone } from '../../shared/ui';
import { dayLabel, inr, todayIso } from '../maintenance/maintenance-ui';
import { entryAccounts, moneyAccounts, signedInr } from './finance-ui';

// ---- Labels ----

export const LINE_STATE: Record<BankLineState, { label: string; tone: Tone }> = {
  UNMATCHED: { label: 'Unmatched', tone: 'warning' },
  MATCHED: { label: 'Matched', tone: 'success' },
  EXCLUDED: { label: 'Set aside', tone: 'neutral' },
};

export const STATEMENT_STATUS: Record<StatementStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'primary' },
  COMPLETED: { label: 'Reconciled', tone: 'success' },
};

export const AMOUNT_STYLES: { value: AmountStyle; label: string; hint: string }[] = [
  {
    value: 'DEBIT_CREDIT',
    label: 'Withdrawal and deposit columns',
    hint: 'Two columns, one for money out and one for money in',
  },
  {
    value: 'AMOUNT_TYPE',
    label: 'Amount and Dr/Cr column',
    hint: 'One amount column and a column saying Dr or Cr',
  },
  { value: 'SIGNED', label: 'One signed amount', hint: 'Money out is negative' },
];

export const DELIMITERS: { value: string; label: string }[] = [
  { value: ',', label: 'Comma ,' },
  { value: ';', label: 'Semicolon ;' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe |' },
];

export const MAPPING_SOURCE: Record<MappingSource, string> = {
  GIVEN: 'The columns as set below.',
  SAVED: "This bank's saved column mapping.",
  SUGGESTED: 'Guessed from the column names. Check it before importing.',
  NONE: "Couldn't guess the columns. Set them below.",
};

// ---- Helpers ----

/** Money in minus money out of a bank line (the bank's view). */
export function lineNet(line: Pick<BankLine, 'debit' | 'credit'>): number {
  return round(line.credit - line.debit);
}

/** Money into the bank minus money out, for a book entry. */
export function entryNet(entry: Pick<BookEntry, 'moneyIn' | 'moneyOut'>): number {
  return round(entry.moneyIn - entry.moneyOut);
}

export function sumNet(entries: Pick<BookEntry, 'moneyIn' | 'moneyOut'>[]): number {
  return round(entries.reduce((sum, e) => sum + entryNet(e), 0));
}

/** "+₹1,000.00" for money in, "−₹500.00" for money out. */
export function flowLabel(net: number): string {
  return net > 0 ? `+${inr(net)}` : signedInr(net);
}

/** Bank ledgers (cash in hand has no statement). */
export function bankAccounts(accounts: Account[]): Account[] {
  return moneyAccounts(accounts, false).filter((a) => a.bank != null);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoOf(new Date(Date.UTC(y, m - 1, d + days)));
}

export function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return isoOf(new Date(Date.UTC(y, m, 0)));
}

/**
 * The period a new statement most likely covers: the month after the latest one (up to today), or,
 * for an account's first statement, last month (not before the books start).
 */
export function nextPeriod(
  latest: Pick<BankStatement, 'periodTo'> | null,
  today: string,
  booksStart: string | null,
): { from: string; to: string } {
  let from: string;
  let to: string;
  if (latest) {
    from = addDays(latest.periodTo, 1);
    to = endOfMonth(from);
  } else {
    const lastMonthEnd = addDays(`${today.slice(0, 8)}01`, -1);
    from = `${lastMonthEnd.slice(0, 8)}01`;
    to = lastMonthEnd;
    if (booksStart && from < booksStart) from = booksStart;
    if (to < from) to = from;
  }
  return { from, to: to > today ? today : to };
}

/** "1 Apr 2026 – 30 Apr 2026" */
export function periodText(s: Pick<BankStatement, 'periodFrom' | 'periodTo'>): string {
  return `${dayLabel(s.periodFrom)} – ${dayLabel(s.periodTo)}`;
}

/** Column choices for a mapping: number and the header row's name ("3 · Txn Date"). */
export function columnOptions(
  rows: string[][],
  headerRow: number,
): { value: number; label: string }[] {
  const count = Math.max(0, ...rows.map((r) => r.length));
  const header = rows[headerRow - 1] ?? [];
  return Array.from({ length: count }, (_, i) => ({
    value: i + 1,
    label: header[i]?.trim() ? `${i + 1} · ${header[i].trim()}` : `Column ${i + 1}`,
  }));
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const AMOUNT = [Validators.required, Validators.pattern(/^-?\d+(\.\d{1,2})?$/)];

// ---- Statement dialog ----

export interface StatementDialogData {
  accountId: number;
  accountName: string;
  /** Edit this (open) statement; otherwise create one. */
  statement?: BankStatement;
  /** Create: the account's latest statement, which the new one follows. */
  latest?: BankStatement | null;
  /** Whether this is (or will be) the account's first statement. */
  first: boolean;
  booksStart: string | null;
}

/** Creates or edits a statement period with its opening and closing balances. */
@Component({
  selector: 'app-statement-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.statement ? 'Edit statement' : 'New statement' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="hint">
          {{ data.accountName }}: the period and balances exactly as the bank statement shows them.
          @if (!data.first) {
            It follows the last statement, so it starts the day after it and opens at its closing
            balance.
          }
        </p>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>From</mat-label>
            <input
              matInput
              type="date"
              formControlName="periodFrom"
              [min]="data.booksStart ?? ''"
              [max]="today"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>To</mat-label>
            <input matInput type="date" formControlName="periodTo" [max]="today" />
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Opening balance</mat-label>
            <span matTextPrefix>₹&nbsp;</span>
            <input matInput type="number" step="0.01" formControlName="openingBalance" />
            @if (form.controls.openingBalance.invalid) {
              <mat-error>An amount, up to 2 decimals</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Closing balance</mat-label>
            <span matTextPrefix>₹&nbsp;</span>
            <input matInput type="number" step="0.01" formControlName="closingBalance" />
            @if (form.controls.closingBalance.invalid) {
              <mat-error>An amount, up to 2 decimals</mat-error>
            }
          </mat-form-field>
        </div>
        @if (data.first) {
          <p class="hint">
            The first statement opens at this account's balance in the books at the start of its
            first day; entries before it count as already in the bank.
            <button mat-button type="button" (click)="useBooks()" [disabled]="fetching()">
              <mat-icon>sync</mat-icon>Use the books' balance
            </button>
          </p>
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
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class StatementDialog {
  protected readonly data = inject<StatementDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<StatementDialog, BankStatement>>(MatDialogRef);
  private readonly api = inject(ReconciliationApi);
  private readonly finance = inject(FinanceApi);
  protected readonly today = todayIso();

  private readonly s = this.data.statement;
  private readonly period = this.s
    ? { from: this.s.periodFrom, to: this.s.periodTo }
    : nextPeriod(this.data.latest ?? null, this.today, this.data.booksStart);
  protected readonly form = inject(NonNullableFormBuilder).group({
    periodFrom: [{ value: this.period.from, disabled: !this.data.first }, Validators.required],
    periodTo: [this.period.to, Validators.required],
    openingBalance: [
      {
        value: (this.s?.openingBalance ?? this.data.latest?.closingBalance ?? null) as
          number | null,
        disabled: !this.data.first,
      },
      AMOUNT,
    ],
    closingBalance: [(this.s?.closingBalance ?? null) as number | null, AMOUNT],
  });
  protected readonly saving = signal(false);
  protected readonly fetching = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The books' balance at the start of the first day (see `booksOpening`). */
  protected useBooks(): void {
    const from = this.form.controls.periodFrom.value;
    if (!from) return;
    this.fetching.set(true);
    this.finance.ledger(this.data.accountId, { from, to: from }).subscribe({
      next: (ledger) => {
        this.form.controls.openingBalance.setValue(booksOpening(ledger));
        this.fetching.set(false);
      },
      error: () => this.fetching.set(false),
    });
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      periodFrom: v.periodFrom,
      periodTo: v.periodTo,
      openingBalance: Number(v.openingBalance),
      closingBalance: Number(v.closingBalance),
    };
    const call = this.s
      ? this.api.updateStatement(
          this.s.id,
          this.data.first ? body : { periodTo: body.periodTo, closingBalance: body.closingBalance },
        )
      : this.api.createStatement(this.data.accountId, body);
    this.saving.set(true);
    this.error.set(null);
    call.subscribe({
      next: (statement) => this.ref.close(statement),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function statementDialog(
  dialog: MatDialog,
  data: StatementDialogData,
): Observable<BankStatement> {
  return dialog
    .open<StatementDialog, StatementDialogData, BankStatement>(StatementDialog, {
      data,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((s): s is BankStatement => s !== undefined));
}

// ---- Import dialog (with the column mapping) ----

export interface ImportDialogData {
  accountId: number;
  accountName: string;
  /** Import into this statement; without it the dialog only saves the column mapping. */
  statementId?: number;
}

/** Closes with the import result, or with `'saved'` when only the mapping was saved. */
export type ImportDialogResult = ImportResult | 'saved';

/**
 * Picks a CSV, shows its first rows and the lines a column mapping reads from it (the saved one, or
 * one guessed from the column names), lets the user correct the columns and re-reads as they change,
 * then saves the mapping and imports. Nothing is stored until Import (or Save).
 */
@Component({
  selector: 'app-import-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
  ],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.scss',
})
export class ImportDialog {
  protected readonly data = inject<ImportDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ImportDialog, ImportDialogResult>>(MatDialogRef);
  private readonly api = inject(ReconciliationApi);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly styles = AMOUNT_STYLES;
  protected readonly delimiters = DELIMITERS;
  protected readonly sourceText = MAPPING_SOURCE;

  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<StatementPreview | null>(null);
  protected readonly dateFormats = signal<string[]>([]);
  private readonly saved = signal<StatementMapping | null>(null);
  protected readonly reading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.group({
    delimiter: [','],
    headerRow: [1, [Validators.required, Validators.min(1), Validators.max(100)]],
    dateColumn: [null as number | null, Validators.required],
    dateFormat: ['', Validators.required],
    descriptionColumn: [null as number | null, Validators.required],
    referenceColumn: [null as number | null],
    amountStyle: ['DEBIT_CREDIT' as AmountStyle],
    debitColumn: [null as number | null],
    creditColumn: [null as number | null],
    amountColumn: [null as number | null],
    typeColumn: [null as number | null],
    balanceColumn: [null as number | null],
  });
  private readonly formValue = signal(this.form.getRawValue());

  protected readonly columns = computed(() =>
    columnOptions(this.preview()?.rows ?? [], this.formValue().headerRow || 1),
  );
  /** Raw rows up to a few past the header, for the user to see where data starts. */
  protected readonly sampleRows = computed(() => {
    const rows = this.preview()?.rows ?? [];
    return rows.slice(0, Math.max(8, (this.formValue().headerRow || 1) + 5));
  });
  protected readonly width = computed(() => this.columns().length);

  private readonly reread = new Subject<void>();

  constructor() {
    this.api.mapping(this.data.accountId).subscribe((m) => {
      this.dateFormats.set(m.dateFormats);
      this.saved.set(m.mapping);
    });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.formValue.set(this.form.getRawValue());
      this.reread.next();
    });
    this.reread
      .pipe(
        debounceTime(400),
        filter(() => this.file() != null && this.complete()),
        switchMap(() => {
          this.reading.set(true);
          return this.api.preview(this.data.accountId, this.file()!, this.mapping()).pipe(
            catchError((err: HttpErrorResponse) => {
              this.error.set(errorMessage(err));
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((preview) => {
        this.reading.set(false);
        if (preview) {
          this.error.set(null);
          this.preview.set(preview);
        }
      });
  }

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.file.set(file);
    this.preview.set(null);
    this.error.set(null);
    this.reading.set(true);
    // First read: the saved mapping, else a guess from the column names.
    this.api.preview(this.data.accountId, file).subscribe({
      next: (preview) => {
        this.reading.set(false);
        this.preview.set(preview);
        this.fill(preview);
      },
      error: (err: HttpErrorResponse) => {
        this.reading.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  private fill(preview: StatementPreview): void {
    const m = preview.mapping;
    this.form.setValue(
      {
        delimiter: m?.delimiter ?? preview.delimiter,
        headerRow: m?.headerRow ?? 1,
        dateColumn: m?.dateColumn ?? null,
        dateFormat: m?.dateFormat ?? this.dateFormats()[0] ?? '',
        descriptionColumn: m?.descriptionColumn ?? null,
        referenceColumn: m?.referenceColumn ?? null,
        amountStyle: m?.amountStyle ?? 'DEBIT_CREDIT',
        debitColumn: m?.debitColumn ?? null,
        creditColumn: m?.creditColumn ?? null,
        amountColumn: m?.amountColumn ?? null,
        typeColumn: m?.typeColumn ?? null,
        balanceColumn: m?.balanceColumn ?? null,
      },
      { emitEvent: false },
    );
    this.formValue.set(this.form.getRawValue());
    this.form.markAsPristine();
  }

  /** All the columns the amount style needs are set. */
  protected complete(): boolean {
    const v = this.formValue();
    if (this.form.invalid) return false;
    switch (v.amountStyle) {
      case 'DEBIT_CREDIT':
        return v.debitColumn != null && v.creditColumn != null;
      case 'AMOUNT_TYPE':
        return v.amountColumn != null && v.typeColumn != null;
      case 'SIGNED':
        return v.amountColumn != null;
    }
  }

  private mapping(): StatementMapping {
    const v = this.form.getRawValue();
    const style = v.amountStyle;
    return {
      delimiter: v.delimiter,
      headerRow: Number(v.headerRow),
      dateColumn: v.dateColumn!,
      dateFormat: v.dateFormat,
      descriptionColumn: v.descriptionColumn!,
      referenceColumn: v.referenceColumn,
      amountStyle: style,
      debitColumn: style === 'DEBIT_CREDIT' ? v.debitColumn : null,
      creditColumn: style === 'DEBIT_CREDIT' ? v.creditColumn : null,
      amountColumn: style === 'DEBIT_CREDIT' ? null : v.amountColumn,
      typeColumn: style === 'AMOUNT_TYPE' ? v.typeColumn : null,
      balanceColumn: v.balanceColumn,
    };
  }

  /** The lines read cleanly: something to import and no unreadable rows. */
  protected readonly readable = computed(() => {
    const parsed = this.preview()?.parsed;
    return !!parsed && parsed.lineCount > 0 && parsed.errorCount === 0;
  });

  protected submit(): void {
    if (!this.file() || !this.complete() || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const mapping = this.mapping();
    const unchanged = JSON.stringify(mapping) === JSON.stringify(this.saved());
    const save: Observable<unknown> = unchanged
      ? of(null)
      : this.api.saveMapping(this.data.accountId, mapping);
    this.saving.set(true);
    this.error.set(null);
    save
      .pipe(
        switchMap(() =>
          this.data.statementId != null
            ? this.api.importFile(this.data.statementId, this.file()!)
            : of('saved' as const),
        ),
      )
      .subscribe({
        next: (result) => this.ref.close(result),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

export function importDialog(
  dialog: MatDialog,
  data: ImportDialogData,
): Observable<ImportDialogResult> {
  return dialog
    .open<ImportDialog, ImportDialogData, ImportDialogResult>(ImportDialog, {
      data,
      width: '960px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((r): r is ImportDialogResult => r !== undefined));
}

// ---- Entry from a bank line ----

export interface LineVoucherDialogData {
  statementId: number;
  /** The bank ledger the statement is for. */
  bankAccountId: number;
  line: BankLine;
  accounts: Account[];
}

/**
 * Records the entry the books are missing for a bank line (bank charges, interest, a direct
 * deposit): the bank side and amount come from the line, the user picks the other account.
 */
@Component({
  selector: 'app-line-voucher-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ moneyIn ? 'Record money received' : 'Record money paid' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="hint">
          {{ dayLabel(data.line.date) }} · {{ data.line.description }} ·
          <strong>{{ inr(amount) }}</strong>
          {{ moneyIn ? 'into' : 'out of' }} the bank. The entry is dated and valued as the bank line
          and is matched to it straight away.
        </p>
        <mat-form-field appearance="outline">
          <mat-label>{{
            moneyIn
              ? 'What it was for (income or other account)'
              : 'What it was for (expense or other account)'
          }}</mat-label>
          <mat-select formControlName="accountId">
            @for (r of options; track r.account.id) {
              <mat-option [value]="r.account.id">
                {{ r.account.code }} · {{ r.account.name }}
                <span class="path">{{ r.path }}</span>
              </mat-option>
            }
            @if (transfers.length) {
              <mat-optgroup label="Transfer with">
                @for (a of transfers; track a.id) {
                  <mat-option [value]="a.id">{{ a.code }} · {{ a.name }}</mat-option>
                }
              </mat-optgroup>
            }
          </mat-select>
          @if (form.controls.accountId.invalid) {
            <mat-error>Choose an account</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>{{ moneyIn ? 'Received from (optional)' : 'Paid to (optional)' }}</mat-label>
          <input matInput formControlName="payee" maxlength="200" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Reference</mat-label>
          <input matInput formControlName="reference" maxlength="100" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Narration</mat-label>
          <textarea matInput rows="2" formControlName="narration" maxlength="500"></textarea>
        </mat-form-field>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Record and match' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .hint {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .path {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class LineVoucherDialog {
  protected readonly data = inject<LineVoucherDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<LineVoucherDialog, LineVoucherResult>>(MatDialogRef);
  private readonly api = inject(ReconciliationApi);
  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;

  protected readonly moneyIn = lineNet(this.data.line) > 0;
  protected readonly amount = Math.abs(lineNet(this.data.line));
  protected readonly options = entryAccounts(
    this.data.accounts,
    this.moneyIn
      ? ['INCOME', 'FUND', 'LIABILITY', 'ASSET']
      : ['EXPENSE', 'ASSET', 'LIABILITY', 'FUND'],
  );
  protected readonly transfers = moneyAccounts(this.data.accounts).filter(
    (a) => a.id !== this.data.bankAccountId,
  );
  protected readonly form = inject(NonNullableFormBuilder).group({
    accountId: [null as number | null, Validators.required],
    payee: [''],
    reference: [this.data.line.reference ?? ''],
    narration: [this.data.line.description],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const text = (s: string) => s.trim() || undefined;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .recordVoucher(this.data.statementId, this.data.line.id, {
        accountId: v.accountId!,
        payee: text(v.payee),
        reference: text(v.reference),
        narration: text(v.narration),
      })
      .subscribe({
        next: (result) => this.ref.close(result),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

export function lineVoucherDialog(
  dialog: MatDialog,
  data: LineVoucherDialogData,
): Observable<LineVoucherResult> {
  return dialog
    .open<LineVoucherDialog, LineVoucherDialogData, LineVoucherResult>(LineVoucherDialog, {
      data,
      width: '560px',
      maxWidth: 'calc(100vw - 32px)',
    })
    .afterClosed()
    .pipe(filter((r): r is LineVoucherResult => r !== undefined));
}

/**
 * A bank ledger's balance at the start of its first day, as reconciliation counts it: the ledger's
 * opening plus the opening-balance entry when it falls on that day (the books' start), since
 * reconciliation treats the opening balances as there before anything else.
 */
export function booksOpening(ledger: Ledger): number {
  const openings = ledger.lines
    .filter((l) => l.voucherType === 'OPENING')
    .reduce((sum, l) => sum + l.debit - l.credit, 0);
  return round(ledger.opening + openings);
}
