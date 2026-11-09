import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  Account,
  AuditEntityType,
  AuditEntry,
  BalanceSheet,
  BankAccountRequest,
  BookDefaults,
  Books,
  CashAndBank,
  ChargeHeadMapping,
  ContraRequest,
  CreateAccountRequest,
  DocumentType,
  FinanceSummary,
  IncomeExpenditure,
  JournalRequest,
  Ledger,
  MaintenanceCheck,
  OpeningEntry,
  Openings,
  PaymentVoucherRequest,
  ReceiptRequest,
  ReceiptsPayments,
  TrialBalance,
  UpdateAccountRequest,
  Voucher,
  VoucherStatus,
  VoucherType,
} from '../models';

export interface VoucherQuery {
  societyId: number;
  type?: VoucherType[];
  status?: VoucherStatus[];
  from?: string | null;
  to?: string | null;
  accountId?: number | null;
  flatId?: number | null;
  q?: string | null;
  page?: number;
  /** Max 200. */
  size?: number;
}

export interface Period {
  from?: string | null;
  to?: string | null;
}

/** Drops empty values so the backend applies its defaults. */
function params(
  values: Record<string, string | number | boolean | (string | number)[] | null | undefined>,
): HttpParams {
  let p = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => (p = p.append(key, String(v))));
    else p = p.set(key, String(value));
  }
  return p;
}

/**
 * The society's books: chart of accounts, vouchers, ledgers, statements and setup. Writes that a
 * form or dialog reports itself use `inlineErrors()`.
 */
@Injectable({ providedIn: 'root' })
export class FinanceApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  private society(societyId: number): string {
    return `${this.api}/societies/${societyId}/finance`;
  }

  // ---- Books and setup ----

  /** `silent` skips the error snackbar (e.g. the maintenance pay dialog checking for books). */
  books(societyId: number, options: { silent?: boolean } = {}) {
    return this.http.get<Books>(`${this.society(societyId)}/books`, {
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  seedChart(societyId: number) {
    return this.http.post<{ accounts: number }>(`${this.society(societyId)}/chart`, null);
  }

  start(societyId: number, startDate: string, openings: OpeningEntry[]) {
    return this.http.post<Books>(
      `${this.society(societyId)}/start`,
      { startDate, openings },
      {
        context: inlineErrors(),
      },
    );
  }

  openings(societyId: number) {
    return this.http.get<Openings>(`${this.society(societyId)}/openings`);
  }

  correctOpenings(
    societyId: number,
    body: { startDate?: string; openings: OpeningEntry[]; reason: string },
  ) {
    return this.http.put<Openings>(`${this.society(societyId)}/openings`, body, {
      context: inlineErrors(),
    });
  }

  setLock(societyId: number, lockedUntil: string | null, reason?: string) {
    return this.http.put<Books>(
      `${this.society(societyId)}/lock`,
      { lockedUntil, reason },
      {
        context: inlineErrors(),
      },
    );
  }

  setDefaults(societyId: number, defaults: BookDefaults) {
    return this.http.put<Books>(`${this.society(societyId)}/defaults`, defaults, {
      context: inlineErrors(),
    });
  }

  // ---- Accounts ----

  accounts(societyId: number, options: { asOf?: string; silent?: boolean } = {}) {
    return this.http.get<Account[]>(`${this.society(societyId)}/accounts`, {
      params: params({ asOf: options.asOf }),
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  createAccount(societyId: number, body: CreateAccountRequest) {
    return this.http.post<Account>(`${this.society(societyId)}/accounts`, body, {
      context: inlineErrors(),
    });
  }

  updateAccount(id: number, body: UpdateAccountRequest) {
    return this.http.patch<Account>(`${this.api}/finance/accounts/${id}`, body, {
      context: inlineErrors(),
    });
  }

  deleteAccount(id: number) {
    return this.http.delete<void>(`${this.api}/finance/accounts/${id}`);
  }

  addBank(societyId: number, body: BankAccountRequest) {
    return this.http.post<Account>(`${this.society(societyId)}/bank-accounts`, body, {
      context: inlineErrors(),
    });
  }

  updateBank(id: number, body: Partial<BankAccountRequest> & { active?: boolean }) {
    return this.http.patch<Account>(`${this.api}/finance/bank-accounts/${id}`, body, {
      context: inlineErrors(),
    });
  }

  ledger(accountId: number, query: Period & { flatId?: number | null } = {}) {
    return this.http.get<Ledger>(`${this.api}/finance/accounts/${accountId}/ledger`, {
      params: params({ ...query }),
    });
  }

  exportLedger(accountId: number, query: Period & { flatId?: number | null } = {}) {
    return this.http.get(`${this.api}/finance/accounts/${accountId}/ledger/export`, {
      params: params({ ...query }),
      responseType: 'blob',
      observe: 'response',
    });
  }

  // ---- Vouchers ----

  vouchers(query: VoucherQuery) {
    const { societyId, ...rest } = query;
    return this.http.get<Voucher[]>(`${this.society(societyId)}/vouchers`, {
      params: params({ ...rest }),
    });
  }

  voucher(id: number) {
    return this.http.get<Voucher>(`${this.api}/finance/vouchers/${id}`);
  }

  recordReceipt(societyId: number, body: ReceiptRequest) {
    return this.http.post<Voucher>(`${this.society(societyId)}/receipts`, body, {
      context: inlineErrors(),
    });
  }

  recordPayment(societyId: number, body: PaymentVoucherRequest) {
    return this.http.post<Voucher>(`${this.society(societyId)}/payments`, body, {
      context: inlineErrors(),
    });
  }

  updatePayment(id: number, body: PaymentVoucherRequest) {
    return this.http.put<Voucher>(`${this.api}/finance/payments/${id}`, body, {
      context: inlineErrors(),
    });
  }

  recordContra(societyId: number, body: ContraRequest) {
    return this.http.post<Voucher>(`${this.society(societyId)}/contras`, body, {
      context: inlineErrors(),
    });
  }

  recordJournal(societyId: number, body: JournalRequest) {
    return this.http.post<Voucher>(`${this.society(societyId)}/journals`, body, {
      context: inlineErrors(),
    });
  }

  updateJournal(id: number, body: JournalRequest) {
    return this.http.put<Voucher>(`${this.api}/finance/journals/${id}`, body, {
      context: inlineErrors(),
    });
  }

  approve(id: number) {
    return this.http.post<Voucher>(`${this.api}/finance/vouchers/${id}/approve`, null);
  }

  reject(id: number, reason: string) {
    return this.http.post<Voucher>(
      `${this.api}/finance/vouchers/${id}/reject`,
      { reason },
      { context: inlineErrors() },
    );
  }

  withdraw(id: number, reason?: string) {
    return this.http.post<Voucher>(
      `${this.api}/finance/vouchers/${id}/withdraw`,
      { reason },
      { context: inlineErrors() },
    );
  }

  void(id: number, reason: string) {
    return this.http.post<Voucher>(
      `${this.api}/finance/vouchers/${id}/void`,
      { reason },
      { context: inlineErrors() },
    );
  }

  addDocument(voucherId: number, file: File, documentType: DocumentType) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<Voucher>(`${this.api}/finance/vouchers/${voucherId}/documents`, form, {
      params: params({ documentType }),
      context: inlineErrors(),
    });
  }

  documentUrl(id: number): string {
    return `${this.api}/finance/documents/${id}`;
  }

  document(id: number) {
    return this.http.get(`${this.api}/finance/documents/${id}`, { responseType: 'blob' });
  }

  removeDocument(id: number) {
    return this.http.delete<void>(`${this.api}/finance/documents/${id}`);
  }

  dayBook(societyId: number, period: Period = {}) {
    return this.http.get<Voucher[]>(`${this.society(societyId)}/day-book`, {
      params: params({ ...period }),
    });
  }

  cashAndBank(societyId: number, period: Period = {}) {
    return this.http.get<CashAndBank>(`${this.society(societyId)}/cash-bank`, {
      params: params({ ...period }),
    });
  }

  // ---- Maintenance in the books ----

  chargeHeadMappings(societyId: number) {
    return this.http.get<ChargeHeadMapping[]>(`${this.society(societyId)}/charge-head-accounts`);
  }

  setChargeHeadMappings(
    societyId: number,
    mappings: { chargeHeadId: number; accountId: number | null }[],
  ) {
    return this.http.put<ChargeHeadMapping[]>(
      `${this.society(societyId)}/charge-head-accounts`,
      { mappings },
      {
        context: inlineErrors(),
      },
    );
  }

  maintenanceCheck(societyId: number) {
    return this.http.get<MaintenanceCheck>(`${this.society(societyId)}/maintenance-check`);
  }

  audit(
    societyId: number,
    query: {
      entityType?: AuditEntityType | null;
      entityId?: number | null;
      page?: number;
      size?: number;
    } = {},
  ) {
    return this.http.get<AuditEntry[]>(`${this.society(societyId)}/audit`, {
      params: params({ ...query }),
    });
  }

  // ---- Statements ----

  trialBalance(societyId: number, asOf?: string | null) {
    return this.http.get<TrialBalance>(`${this.society(societyId)}/reports/trial-balance`, {
      params: params({ asOf }),
    });
  }

  incomeExpenditure(societyId: number, period: Period = {}) {
    return this.http.get<IncomeExpenditure>(
      `${this.society(societyId)}/reports/income-expenditure`,
      {
        params: params({ ...period }),
      },
    );
  }

  receiptsPayments(societyId: number, period: Period = {}) {
    return this.http.get<ReceiptsPayments>(`${this.society(societyId)}/reports/receipts-payments`, {
      params: params({ ...period }),
    });
  }

  balanceSheet(societyId: number, asOf?: string | null) {
    return this.http.get<BalanceSheet>(`${this.society(societyId)}/reports/balance-sheet`, {
      params: params({ asOf }),
    });
  }

  /** report: trial-balance, income-expenditure, receipts-payments or balance-sheet; or the day book. */
  exportReport(
    societyId: number,
    report:
      'trial-balance' | 'income-expenditure' | 'receipts-payments' | 'balance-sheet' | 'day-book',
    query: Period & { asOf?: string | null } = {},
  ) {
    const path = report === 'day-book' ? 'day-book/export' : `reports/${report}/export`;
    return this.http.get(`${this.society(societyId)}/${path}`, {
      params: params({ ...query }),
      responseType: 'blob',
      observe: 'response',
    });
  }

  /** `silent`: a dashboard card probing whether the society shares it. */
  summary(societyId: number, period: Period = {}, options: { silent?: boolean } = {}) {
    return this.http.get<FinanceSummary>(`${this.society(societyId)}/summary`, {
      params: params({ ...period }),
      context: options.silent ? inlineErrors() : undefined,
    });
  }
}
