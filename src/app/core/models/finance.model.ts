/** Finance & accounting (backend module `finance`). Amounts are rupees; dates are yyyy-mm-dd. */

export type AccountType = 'ASSET' | 'LIABILITY' | 'FUND' | 'INCOME' | 'EXPENSE';
export type BankAccountType = 'SAVINGS' | 'CURRENT';
export type VoucherType = 'RECEIPT' | 'PAYMENT' | 'CONTRA' | 'JOURNAL' | 'OPENING' | 'SYSTEM';
export type VoucherStatus = 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED' | 'VOID';
export type DocumentType = 'INVOICE' | 'RECEIPT' | 'APPROVAL' | 'BANK_PROOF' | 'OTHER';
export type AuditEntityType =
  | 'VOUCHER'
  | 'ACCOUNT'
  | 'BANK_ACCOUNT'
  | 'BOOKS'
  | 'MAPPING'
  | 'SETTING'
  | 'REFUND'
  | 'DOCUMENT'
  | 'RECONCILIATION';

export interface BookDefaults {
  cashDepositAccountId: number | null;
  chequeDepositAccountId: number | null;
  upiDepositAccountId: number | null;
  transferDepositAccountId: number | null;
  defaultPayingAccountId: number | null;
}

export interface Books {
  societyId: number;
  started: boolean;
  hasChart: boolean;
  startDate: string | null;
  lockedUntil: string | null;
  openingVoucherId: number | null;
  openingVoucherNumber: string | null;
  openingsEditable: boolean;
  defaults: BookDefaults | null;
}

export interface BankDetails {
  bankName: string;
  accountType: BankAccountType;
  last4: string | null;
  ifsc: string | null;
}

export interface Account {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  parentId: number | null;
  /** A group holds accounts; only ledgers take entries. */
  group: boolean;
  systemKey: string | null;
  active: boolean;
  /** Natural sign; a group's is the total of everything under it. */
  balance: number;
  bank: BankDetails | null;
}

export interface CreateAccountRequest {
  code: string;
  name: string;
  parentId: number;
  group: boolean;
}

export interface UpdateAccountRequest {
  code?: string;
  name?: string;
  parentId?: number;
  group?: boolean;
  active?: boolean;
}

export interface BankAccountRequest {
  name: string;
  bankName: string;
  accountType: BankAccountType;
  last4?: string;
  ifsc?: string;
  code?: string;
}

/** Natural sign: positive on the account's usual side. */
export interface OpeningEntry {
  accountId: number;
  amount: number;
}

export interface Openings {
  startDate: string;
  voucherId: number;
  voucherNumber: string;
  entries: (OpeningEntry & { code: string; name: string; type: AccountType })[];
  generalFund: number;
  memberDues: number;
  memberAdvances: number;
  editable: boolean;
}

export interface VoucherLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  flatId: number | null;
  flatLabel: string | null;
  debit: number;
  credit: number;
}

export interface FinanceDocument {
  id: number;
  documentType: DocumentType;
  filename: string | null;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

export interface Voucher {
  id: number;
  societyId: number;
  type: VoucherType;
  number: string;
  financialYear: string;
  date: string;
  status: VoucherStatus;
  amount: number;
  payee: string | null;
  reference: string | null;
  narration: string | null;
  flatId: number | null;
  flatLabel: string | null;
  sourceType: string | null;
  sourceId: number | null;
  reversesVoucherId: number | null;
  reversedByVoucherId: number | null;
  reversedByNumber: string | null;
  createdAt: string | null;
  createdBy: number;
  createdByName: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  reason: string | null;
  lines: VoucherLine[];
  documents: FinanceDocument[];
}

export interface AmountLine {
  accountId: number;
  amount: number;
}

export interface ReceiptRequest {
  date: string;
  depositAccountId: number;
  lines: AmountLine[];
  payee?: string;
  flatId?: number;
  reference?: string;
  narration?: string;
}

export interface PaymentVoucherRequest {
  date: string;
  payingAccountId: number;
  lines: AmountLine[];
  payee: string;
  flatId?: number;
  reference?: string;
  narration?: string;
}

export interface ContraRequest {
  date: string;
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  reference?: string;
  narration?: string;
}

export interface JournalRequest {
  date: string;
  narration: string;
  reference?: string;
  lines: { accountId: number; debit?: number; credit?: number }[];
}

export interface LedgerLine {
  voucherId: number;
  voucherNumber: string;
  voucherType: VoucherType;
  date: string;
  narration: string | null;
  payee: string | null;
  flatId: number | null;
  flatLabel: string | null;
  debit: number;
  credit: number;
  balance: number;
  /** Bank ledgers: the day it cleared at the bank (null while it hasn't, and before the first statement). */
  clearedOn?: string | null;
}

export interface Ledger {
  accountId: number;
  code: string;
  name: string;
  type: AccountType;
  flatId: number | null;
  flatLabel: string | null;
  from: string;
  to: string;
  opening: number;
  lines: LedgerLine[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

export interface MoneyAccountSummary {
  accountId: number;
  code: string;
  name: string;
  active: boolean;
  opening: number;
  received: number;
  paid: number;
  closing: number;
}

export interface CashAndBank {
  from: string;
  to: string;
  accounts: MoneyAccountSummary[];
  totalOpening: number;
  totalReceived: number;
  totalPaid: number;
  totalClosing: number;
}

export interface AuditEntry {
  id: number;
  entityType: AuditEntityType;
  entityId: number | null;
  action: string;
  /** JSON objects as recorded. */
  oldValues: string | null;
  newValues: string | null;
  reason: string | null;
  performedBy: number;
  performedByName: string | null;
  performedAt: string;
}

export interface ChargeHeadMapping {
  chargeHeadId: number;
  chargeHeadName: string;
  chargeHeadActive: boolean;
  accountId: number;
  accountCode: string;
  accountName: string;
  /** false: no ledger chosen, Maintenance charges applies. */
  mapped: boolean;
}

export interface FlatMismatch {
  flatId: number;
  flatLabel: string;
  booksDues: number;
  maintenanceDues: number;
  booksAdvance: number;
  maintenanceAdvance: number;
}

export interface MaintenanceCheck {
  ok: boolean;
  booksDues: number;
  maintenanceDues: number;
  booksAdvance: number;
  maintenanceAdvance: number;
  mismatches: FlatMismatch[];
}

// ---- Statements ----

export interface StatementLine {
  accountId: number;
  code: string;
  name: string;
  amount: number;
}

export interface StatementGroup {
  groupId: number;
  code: string;
  name: string;
  total: number;
  lines: StatementLine[];
}

export interface TrialBalance {
  asOf: string;
  rows: {
    accountId: number;
    code: string;
    name: string;
    type: AccountType;
    debit: number;
    credit: number;
  }[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface IncomeExpenditure {
  from: string;
  to: string;
  income: StatementGroup[];
  expenditure: StatementGroup[];
  totalIncome: number;
  totalExpenditure: number;
  /** Negative is a deficit. */
  surplus: number;
}

export interface ReceiptsPayments {
  from: string;
  to: string;
  opening: StatementLine[];
  openingTotal: number;
  receipts: StatementGroup[];
  receiptsTotal: number;
  payments: StatementGroup[];
  paymentsTotal: number;
  closing: StatementLine[];
  closingTotal: number;
}

export interface BalanceSheet {
  asOf: string;
  assets: StatementGroup[];
  liabilities: StatementGroup[];
  funds: StatementGroup[];
  surplus: number;
  totalAssets: number;
  totalLiabilities: number;
  /** Including the surplus. */
  totalFunds: number;
  balanced: boolean;
}

export interface MonthSummary {
  /** yyyy-mm */
  month: string;
  income: { name: string; amount: number }[];
  expenditure: { name: string; amount: number }[];
  totalIncome: number;
  totalExpenditure: number;
  closingCashAndBank: number;
}

export interface FinanceSummary {
  from: string;
  to: string;
  months: MonthSummary[];
}
