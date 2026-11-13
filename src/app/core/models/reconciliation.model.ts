/**
 * Bank reconciliation (backend module `finance`, V1.1). A bank's view of money: a debit is money out
 * of the account, a credit money in. Balances are as the bank shows them (negative is overdrawn).
 */
import { VoucherStatus, VoucherType } from './finance.model';

export type AmountStyle = 'DEBIT_CREDIT' | 'AMOUNT_TYPE' | 'SIGNED';
export type StatementStatus = 'OPEN' | 'COMPLETED';
export type BankLineState = 'UNMATCHED' | 'MATCHED' | 'EXCLUDED';
export type MappingSource = 'GIVEN' | 'SAVED' | 'SUGGESTED' | 'NONE';

/** How a bank's CSV reads. Columns are 1-based; data starts on the row after `headerRow`. */
export interface StatementMapping {
  /** One of `,` `;` tab `|`. */
  delimiter: string;
  headerRow: number;
  dateColumn: number;
  dateFormat: string;
  descriptionColumn: number;
  referenceColumn: number | null;
  amountStyle: AmountStyle;
  /** DEBIT_CREDIT: withdrawal and deposit columns. */
  debitColumn: number | null;
  creditColumn: number | null;
  /** AMOUNT_TYPE (with `typeColumn`, Dr/Cr) or SIGNED. */
  amountColumn: number | null;
  typeColumn: number | null;
  balanceColumn: number | null;
}

export interface SavedStatementMapping {
  accountId: number;
  mapping: StatementMapping | null;
  updatedAt: string | null;
  dateFormats: string[];
}

export interface RowNote {
  /** 1-based row of the file. */
  row: number;
  message: string;
}

export interface ParsedLine {
  row: number;
  date: string;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number | null;
}

export interface ParsedStatement {
  lineCount: number;
  firstDate: string | null;
  lastDate: string | null;
  credits: number;
  debits: number;
  /** At most 50 of each list. */
  lines: ParsedLine[];
  ignored: RowNote[];
  errors: RowNote[];
  errorCount: number;
  warnings: RowNote[];
}

export interface StatementPreview {
  delimiter: string;
  /** The first 30 rows as the file has them. */
  rows: string[][];
  totalRows: number;
  mappingSource: MappingSource;
  mapping: StatementMapping | null;
  parsed: ParsedStatement | null;
}

export interface BankStatement {
  id: number;
  accountId: number;
  accountName: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: number;
  closingBalance: number;
  status: StatementStatus;
  lines: number;
  matched: number;
  unmatched: number;
  excluded: number;
  imports: number;
  credits: number;
  debits: number;
  /** Opening + credits − debits of the imported lines. */
  linesClosing: number;
  /** Closing balance − linesClosing: non-zero while lines are missing. */
  linesDifference: number;
  createdAt: string;
  completedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface StatementRequest {
  periodFrom: string;
  periodTo: string;
  openingBalance: number;
  closingBalance: number;
}

export interface StatementImport {
  id: number;
  statementId: number;
  filename: string | null;
  sizeBytes: number;
  rowsImported: number;
  rowsDuplicate: number;
  rowsIgnored: number;
  importedAt: string;
  importedBy: number;
}

export interface ImportResult {
  import: StatementImport;
  statement: BankStatement;
  outsidePeriod: RowNote[];
  ignored: RowNote[];
  warnings: RowNote[];
  autoMatched: number;
  autoPaired: number;
}

/** An entry of the bank's ledger in the books. */
export interface BookEntry {
  /** The voucher line; what matching refers to. */
  lineId: number;
  voucherId: number;
  number: string;
  type: VoucherType;
  date: string;
  status: VoucherStatus;
  /** Reverses a voided entry. */
  reversal: boolean;
  narration: string | null;
  payee: string | null;
  reference: string | null;
  moneyIn: number;
  moneyOut: number;
  /** Cleared lists only. */
  bankLineId?: number | null;
  pairLineId?: number | null;
  auto?: boolean | null;
}

export interface BankLine {
  id: number;
  lineNo: number;
  date: string;
  description: string;
  reference: string | null;
  /** Money out. */
  debit: number;
  /** Money in. */
  credit: number;
  balance: number | null;
  state: BankLineState;
  excludeReason: string | null;
  importId: number;
  entries: BookEntry[];
  auto: boolean | null;
  voucherId: number | null;
  voucherNumber: string | null;
  voucherStatus: VoucherStatus | null;
}

export interface Suggestions {
  single: { entry: BookEntry; daysApart: number; withinWindow: boolean }[];
  /** Several entries adding up to the line (e.g. one deposit of five cheques). */
  groups: BookEntry[][];
}

export interface LineVoucherRequest {
  /** The other side: income, expense, or another cash/bank account for a transfer. */
  accountId: number;
  payee?: string;
  narration?: string;
  reference?: string;
}

export interface LineVoucherResult {
  voucherId: number;
  voucherNumber: string;
  voucherStatus: VoucherStatus;
  line: BankLine;
}

export interface AutoMatchResult {
  matched: number;
  paired: number;
  statement: BankStatement;
}

export interface ExcludedLine {
  id: number;
  statementId: number;
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  reason: string | null;
}

/** Bank reconciliation statement: how the books' balance becomes the bank's. */
export interface Brs {
  statement: BankStatement;
  bankClosing: number;
  bookBalance: number;
  unclearedReceipts: number;
  receipts: BookEntry[];
  unclearedPayments: number;
  payments: BookEntry[];
  excludedNet: number;
  excluded: ExcludedLine[];
  /** books − uncleared receipts + uncleared payments + set-aside lines. */
  explainedBalance: number;
  difference: number;
  canComplete: boolean;
  /** Why it can't be completed yet. */
  problems: string[];
  /** Completed only: entries in its period were added or changed since. */
  booksChanged: boolean;
}
