import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  GatewayRefund,
  MaintenanceCheckout,
  OnlineCapture,
  OnlineOptions,
  OnlinePaymentRow,
  OnlineQuote,
  PaymentAccount,
  PaymentAccountRequest,
} from '../models';

/** Online payments (module 16). */
@Injectable({ providedIn: 'root' })
export class PaymentApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  // ---- The society's linked account ----

  account(societyId: number) {
    return this.http.get<PaymentAccount>(`${this.api}/societies/${societyId}/payment-account`);
  }

  /** Creates, resumes or corrects the linked account. Errors shown in the form. */
  submitAccount(societyId: number, body: PaymentAccountRequest, resubmit: boolean) {
    const url = `${this.api}/societies/${societyId}/payment-account`;
    return resubmit
      ? this.http.put<PaymentAccount>(url, body, { context: inlineErrors() })
      : this.http.post<PaymentAccount>(url, body, { context: inlineErrors() });
  }

  // ---- Paying online (residents) ----

  options(flatId: number) {
    // Quiet: outside the plan (402) or not the payer (403) just means no "Pay online" button.
    return this.http.get<OnlineOptions>(`${this.api}/flats/${flatId}/online-payments/options`, {
      context: inlineErrors(),
    });
  }

  quote(flatId: number, amount: number | null, billId: number | null = null) {
    return this.http.post<OnlineQuote>(
      `${this.api}/flats/${flatId}/online-payments/quote`,
      { amount, billId },
      { context: inlineErrors() },
    );
  }

  order(flatId: number, amount: number | null, billId: number | null = null) {
    return this.http.post<MaintenanceCheckout>(
      `${this.api}/flats/${flatId}/online-payments/order`,
      { amount, billId },
      { context: inlineErrors() },
    );
  }

  verify(flatId: number, orderId: string, paymentId: string, signature: string) {
    return this.http.post<OnlineCapture>(
      `${this.api}/flats/${flatId}/online-payments/verify`,
      { orderId, paymentId, signature },
      { context: inlineErrors() },
    );
  }

  // ---- The society's report and refunds ----

  payments(societyId: number, from: string | null, to: string | null) {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.http.get<OnlinePaymentRow[]>(`${this.api}/societies/${societyId}/online-payments`, { params });
  }

  exportPayments(societyId: number, from: string, to: string) {
    return this.http.get(`${this.api}/societies/${societyId}/online-payments/export`, {
      params: { from, to },
      responseType: 'blob',
      observe: 'response',
    });
  }

  refunds(societyId: number) {
    return this.http.get<GatewayRefund[]>(`${this.api}/societies/${societyId}/gateway-refunds`);
  }

  refundPayment(societyId: number, maintenancePaymentId: number, reason: string) {
    return this.http.post<GatewayRefund>(
      `${this.api}/societies/${societyId}/maintenance/payments/${maintenancePaymentId}/gateway-refund`,
      { reason },
      { context: inlineErrors() },
    );
  }

  refundOrder(societyId: number, orderId: number, reason: string) {
    return this.http.post<GatewayRefund>(
      `${this.api}/societies/${societyId}/online-orders/${orderId}/refund`,
      { reason },
      { context: inlineErrors() },
    );
  }

  approveRefund(id: number) {
    return this.http.post<GatewayRefund>(`${this.api}/gateway-refunds/${id}/approve`, {});
  }

  rejectRefund(id: number, reason: string) {
    return this.http.post<GatewayRefund>(
      `${this.api}/gateway-refunds/${id}/reject`,
      { reason },
      { context: inlineErrors() },
    );
  }

  // ---- Platform ----

  platformAccounts() {
    return this.http.get<PaymentAccount[]>(`${this.api}/platform/payment-accounts`);
  }

  suspendAccount(societyId: number, reason: string) {
    return this.http.post<PaymentAccount>(
      `${this.api}/platform/payment-accounts/${societyId}/suspend`,
      { reason },
      { context: inlineErrors() },
    );
  }

  resumeAccount(societyId: number) {
    return this.http.post<PaymentAccount>(`${this.api}/platform/payment-accounts/${societyId}/resume`, {});
  }

  problems() {
    return this.http.get<OnlinePaymentRow[]>(`${this.api}/platform/online-payments/problems`);
  }

  stuckTransfers() {
    return this.http.get<OnlinePaymentRow[]>(`${this.api}/platform/payment-transfers`);
  }

  retryTransfer(transferId: number) {
    return this.http.post<{ id: number; status: string }>(
      `${this.api}/platform/payment-transfers/${transferId}/retry`,
      {},
    );
  }

  platformRefundOrder(orderId: number, reason: string) {
    return this.http.post<GatewayRefund>(
      `${this.api}/platform/online-orders/${orderId}/refund`,
      { reason },
      { context: inlineErrors() },
    );
  }
}
