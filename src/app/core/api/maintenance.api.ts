import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  Bill,
  BillStatus,
  BillingCycle,
  BillingPeriod,
  BillingPreview,
  ChargeHead,
  ChargeHeadRequest,
  FlatDues,
  MaintenanceSettings,
  OpeningBalancesRequest,
  Payment,
  RecordPaymentRequest,
  ReminderResult,
  UpdateSettingsRequest,
} from '../models';

export interface BillQuery {
  societyId: number;
  cycleId?: number | null;
  flatId?: number | null;
  status?: BillStatus | null;
  page?: number;
  /** Max 100. */
  size?: number;
}

export interface PaymentQuery {
  societyId: number;
  flatId?: number | null;
  from?: string | null;
  to?: string | null;
  includeVoid?: boolean;
  page?: number;
  size?: number;
}

/**
 * Maintenance billing (settings, charge heads, cycles, bills), payments and dues reports.
 * Writes that a form or dialog reports itself use `inlineErrors()`.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  private society(societyId: number): string {
    return `${this.api}/societies/${societyId}/maintenance`;
  }

  // ---- Settings and charge heads ----

  /** `silent` skips the error snackbar (e.g. a bill page reading the UPI ID on the side). */
  settings(societyId: number, options: { silent?: boolean } = {}) {
    return this.http.get<MaintenanceSettings>(`${this.society(societyId)}/settings`, {
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  updateSettings(societyId: number, body: UpdateSettingsRequest) {
    return this.http.put<MaintenanceSettings>(`${this.society(societyId)}/settings`, body, {
      context: inlineErrors(),
    });
  }

  chargeHeads(societyId: number) {
    return this.http.get<ChargeHead[]>(`${this.society(societyId)}/charge-heads`);
  }

  addChargeHead(societyId: number, body: ChargeHeadRequest) {
    return this.http.post<ChargeHead>(`${this.society(societyId)}/charge-heads`, body, {
      context: inlineErrors(),
    });
  }

  updateChargeHead(id: number, body: Partial<ChargeHeadRequest>) {
    return this.http.patch<ChargeHead>(`${this.api}/maintenance/charge-heads/${id}`, body, {
      context: inlineErrors(),
    });
  }

  deleteChargeHead(id: number) {
    return this.http.delete<void>(`${this.api}/maintenance/charge-heads/${id}`);
  }

  // ---- Cycles ----

  /** The period after the latest regular cycle, from the society's billing frequency. */
  nextPeriod(societyId: number) {
    return this.http.get<BillingPeriod>(`${this.society(societyId)}/cycles/next`);
  }

  preview(societyId: number, period: BillingPeriod) {
    return this.http.post<BillingPreview>(`${this.society(societyId)}/cycles/preview`, period, {
      context: inlineErrors(),
    });
  }

  issue(societyId: number, period: BillingPeriod) {
    return this.http.post<BillingCycle>(`${this.society(societyId)}/cycles`, period, {
      context: inlineErrors(),
    });
  }

  openingBalances(societyId: number, body: OpeningBalancesRequest) {
    return this.http.post<BillingCycle>(`${this.society(societyId)}/opening-balances`, body, {
      context: inlineErrors(),
    });
  }

  /** Newest first, cancelled ones included. */
  cycles(societyId: number) {
    return this.http.get<BillingCycle[]>(`${this.society(societyId)}/cycles`);
  }

  cycle(id: number) {
    return this.http.get<BillingCycle>(`${this.api}/maintenance/cycles/${id}`);
  }

  cancelCycle(id: number, reason: string) {
    return this.http.post<BillingCycle>(
      `${this.api}/maintenance/cycles/${id}/cancel`,
      { reason },
      { context: inlineErrors() },
    );
  }

  exportCycle(id: number) {
    return this.http.get(`${this.api}/maintenance/cycles/${id}/export`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  // ---- Bills ----

  /** Newest cycle first; residents get their own flats only (the backend scopes it). */
  bills(query: BillQuery) {
    return this.http.get<Bill[]>(`${this.api}/maintenance/bills`, { params: params(query) });
  }

  /** With lines and the payments that paid it. */
  bill(id: number) {
    return this.http.get<Bill>(`${this.api}/maintenance/bills/${id}`);
  }

  waiveBill(id: number, reason: string) {
    return this.http.post<Bill>(
      `${this.api}/maintenance/bills/${id}/waive`,
      { reason },
      { context: inlineErrors() },
    );
  }

  // ---- Payments ----

  recordPayment(societyId: number, body: RecordPaymentRequest) {
    return this.http.post<Payment>(`${this.society(societyId)}/payments`, body, {
      context: inlineErrors(),
    });
  }

  /** Newest first; residents get their own flats only. */
  payments(query: PaymentQuery) {
    return this.http.get<Payment[]>(`${this.api}/maintenance/payments`, {
      params: params(query),
    });
  }

  /** The receipt, with the bills it paid. */
  payment(id: number) {
    return this.http.get<Payment>(`${this.api}/maintenance/payments/${id}`);
  }

  voidPayment(id: number, reason: string) {
    return this.http.post<Payment>(
      `${this.api}/maintenance/payments/${id}/void`,
      { reason },
      { context: inlineErrors() },
    );
  }

  /** CSV of payments between two ISO dates (inclusive). Errors are shown in the dialog. */
  exportPayments(societyId: number, from: string, to: string) {
    return this.http.get(`${this.society(societyId)}/payments/export`, {
      params: { from, to },
      responseType: 'blob',
      observe: 'response',
      context: inlineErrors(),
    });
  }

  // ---- Dues ----

  /** Flats with something outstanding, by wing and flat number. Residents get their own flat. */
  dues(societyId: number, overdueOnly = false, options: { silent?: boolean } = {}) {
    return this.http.get<FlatDues[]>(`${this.society(societyId)}/dues`, {
      params: { overdueOnly },
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  exportDues(societyId: number, overdueOnly = false) {
    return this.http.get(`${this.society(societyId)}/dues/export`, {
      params: { overdueOnly },
      responseType: 'blob',
      observe: 'response',
    });
  }

  /** Pushes a reminder to the given flats, or to every flat with overdue dues when omitted. */
  remind(societyId: number, flatIds?: number[]) {
    return this.http.post<ReminderResult>(
      `${this.society(societyId)}/dues/remind`,
      flatIds ? { flatIds } : {},
    );
  }
}

function params(query: object): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') out[key] = value as string | number | boolean;
  }
  return out;
}
