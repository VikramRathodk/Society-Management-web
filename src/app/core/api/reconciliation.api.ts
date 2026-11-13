import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  AutoMatchResult,
  BankLine,
  BankLineState,
  BankStatement,
  BookEntry,
  Brs,
  ImportResult,
  LineVoucherRequest,
  LineVoucherResult,
  SavedStatementMapping,
  StatementImport,
  StatementMapping,
  StatementPreview,
  StatementRequest,
  Suggestions,
} from '../models';

/**
 * Bank reconciliation: how a bank's CSV reads, statement periods and their imports, matching bank
 * lines to the books, and the bank reconciliation statement. Writes a dialog or page reports itself
 * use `inlineErrors()`.
 */
@Injectable({ providedIn: 'root' })
export class ReconciliationApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  private bank(accountId: number): string {
    return `${this.api}/finance/bank-accounts/${accountId}`;
  }

  private statementUrl(id: number): string {
    return `${this.api}/finance/statements/${id}`;
  }

  // ---- Column mapping ----

  mapping(accountId: number) {
    return this.http.get<SavedStatementMapping>(`${this.bank(accountId)}/statement-mapping`);
  }

  saveMapping(accountId: number, mapping: StatementMapping) {
    return this.http.put<SavedStatementMapping>(
      `${this.bank(accountId)}/statement-mapping`,
      mapping,
      { context: inlineErrors() },
    );
  }

  /** Reads a file without saving anything; `mapping` tries one before saving it. */
  preview(accountId: number, file: File, mapping?: StatementMapping | null) {
    const form = new FormData();
    form.append('file', file);
    if (mapping)
      form.append('mapping', new Blob([JSON.stringify(mapping)], { type: 'application/json' }));
    return this.http.post<StatementPreview>(`${this.bank(accountId)}/statement-preview`, form, {
      context: inlineErrors(),
    });
  }

  // ---- Statements ----

  statements(societyId: number, accountId?: number | null) {
    let params = new HttpParams();
    if (accountId != null) params = params.set('accountId', accountId);
    return this.http.get<BankStatement[]>(`${this.api}/societies/${societyId}/finance/statements`, {
      params,
    });
  }

  createStatement(accountId: number, body: StatementRequest) {
    return this.http.post<BankStatement>(`${this.bank(accountId)}/statements`, body, {
      context: inlineErrors(),
    });
  }

  statement(id: number) {
    return this.http.get<BankStatement>(this.statementUrl(id));
  }

  updateStatement(id: number, body: Partial<StatementRequest>) {
    return this.http.patch<BankStatement>(this.statementUrl(id), body, {
      context: inlineErrors(),
    });
  }

  deleteStatement(id: number) {
    return this.http.delete<void>(this.statementUrl(id));
  }

  lines(id: number, state?: BankLineState | null) {
    let params = new HttpParams();
    if (state) params = params.set('state', state);
    return this.http.get<BankLine[]>(`${this.statementUrl(id)}/lines`, { params });
  }

  // ---- Imports ----

  imports(id: number) {
    return this.http.get<StatementImport[]>(`${this.statementUrl(id)}/imports`);
  }

  importFile(id: number, file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportResult>(`${this.statementUrl(id)}/imports`, form, {
      context: inlineErrors(),
    });
  }

  deleteImport(importId: number) {
    return this.http.delete<void>(`${this.api}/finance/statement-imports/${importId}`);
  }

  downloadImport(importId: number) {
    return this.http.get(`${this.api}/finance/statement-imports/${importId}/file`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  // ---- Matching ----

  /** cleared=false: still waiting to clear by the statement's end; true: cleared by this statement. */
  bookEntries(id: number, cleared = false) {
    return this.http.get<BookEntry[]>(`${this.statementUrl(id)}/book-entries`, {
      params: new HttpParams().set('cleared', cleared),
    });
  }

  suggestions(id: number, lineId: number) {
    return this.http.get<Suggestions>(`${this.statementUrl(id)}/lines/${lineId}/suggestions`);
  }

  autoMatch(id: number) {
    return this.http.post<AutoMatchResult>(`${this.statementUrl(id)}/auto-match`, null);
  }

  match(id: number, lineId: number, bookLineIds: number[]) {
    return this.http.post<BankLine>(
      `${this.statementUrl(id)}/lines/${lineId}/match`,
      { bookLineIds },
      { context: inlineErrors() },
    );
  }

  unmatch(id: number, lineId: number) {
    return this.http.delete<BankLine>(`${this.statementUrl(id)}/lines/${lineId}/match`);
  }

  exclude(id: number, lineId: number, reason: string) {
    return this.http.post<BankLine>(
      `${this.statementUrl(id)}/lines/${lineId}/exclude`,
      { reason },
      { context: inlineErrors() },
    );
  }

  include(id: number, lineId: number) {
    return this.http.post<BankLine>(`${this.statementUrl(id)}/lines/${lineId}/include`, null);
  }

  /** Records the missing entry from a bank line (needs FINANCE.VOUCHER.CREATE too). */
  recordVoucher(id: number, lineId: number, body: LineVoucherRequest) {
    return this.http.post<LineVoucherResult>(
      `${this.statementUrl(id)}/lines/${lineId}/voucher`,
      body,
      { context: inlineErrors() },
    );
  }

  /** Two book entries that cancel each other out (e.g. a bounced cheque and its reversal). */
  pair(id: number, firstLineId: number, secondLineId: number) {
    return this.http.post<void>(
      `${this.statementUrl(id)}/pairs`,
      { firstLineId, secondLineId },
      { context: inlineErrors() },
    );
  }

  unpair(id: number, bookLineId: number) {
    return this.http.delete<void>(`${this.statementUrl(id)}/pairs/${bookLineId}`);
  }

  // ---- Bank reconciliation statement ----

  brs(id: number) {
    return this.http.get<Brs>(`${this.statementUrl(id)}/brs`);
  }

  exportBrs(id: number) {
    return this.http.get(`${this.statementUrl(id)}/brs.csv`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  complete(id: number) {
    return this.http.post<Brs>(`${this.statementUrl(id)}/complete`, null, {
      context: inlineErrors(),
    });
  }

  reopen(id: number, reason: string) {
    return this.http.post<BankStatement>(
      `${this.statementUrl(id)}/reopen`,
      { reason },
      { context: inlineErrors() },
    );
  }
}
