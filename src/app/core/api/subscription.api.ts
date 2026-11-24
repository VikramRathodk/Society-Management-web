import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  SubscriptionCycle,
  BillingRunResult,
  CheckoutOrder,
  Plan,
  PlanRecommendation,
  PlanRequest,
  PlatformInvoice,
  PlatformInvoiceStatus,
  PlatformInvoiceSummary,
  RecordPlatformPaymentRequest,
  SocietySubscription,
  SubscriptionAccess,
} from '../models';

/** Platform billing: plans, subscriptions, the platform's invoices to societies and paying them. */
@Injectable({ providedIn: 'root' })
export class SubscriptionApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  // ---- Plans ----

  /** The plans on offer, without sign-in (the landing page). Errors leave pricing hidden. */
  publicPlans() {
    return this.http.get<Plan[]>(`${this.api}/public/plans`, { context: inlineErrors() });
  }

  /** Every plan's cost for a flat count and the recommended one, without sign-in. Errors are shown inline. */
  quote(flats: number) {
    return this.http.get<PlanRecommendation>(`${this.api}/public/plans/quote`, {
      params: { flats },
      context: inlineErrors(),
    });
  }

  /** The society's recommendation at its flat count today. Errors leave it hidden. */
  recommendation(societyId: number) {
    return this.http.get<PlanRecommendation>(`${this.api}/societies/${societyId}/subscription/recommendation`, {
      context: inlineErrors(),
    });
  }

  plans() {
    return this.http.get<Plan[]>(`${this.api}/plans`);
  }

  /** Errors are shown in the dialog. */
  createPlan(body: PlanRequest) {
    return this.http.post<Plan>(`${this.api}/platform/plans`, body, { context: inlineErrors() });
  }

  /** Errors are shown in the dialog. */
  updatePlan(id: number, body: PlanRequest) {
    return this.http.put<Plan>(`${this.api}/platform/plans/${id}`, body, {
      context: inlineErrors(),
    });
  }

  // ---- Subscriptions ----

  /** Every society's (platform). */
  subscriptions() {
    return this.http.get<SocietySubscription[]>(`${this.api}/platform/subscriptions`);
  }

  startAll() {
    return this.http.post<{ started: number }>(`${this.api}/platform/subscriptions/start-all`, {});
  }

  /** The society's own (SECRETARY and above, or the platform). */
  get(societyId: number) {
    return this.http.get<SocietySubscription>(`${this.api}/societies/${societyId}/subscription`);
  }

  /** Any member: paid modules and the suspension banner. Errors stay quiet (the app works without). */
  access(societyId: number) {
    return this.http.get<SubscriptionAccess>(
      `${this.api}/societies/${societyId}/subscription/access`,
      { context: inlineErrors() },
    );
  }

  /** Platform: starts a live society's subscription (its plan, or Free / the plan for its size). */
  startSubscription(societyId: number, planId: number | null, cycle: SubscriptionCycle) {
    return this.http.post<SocietySubscription>(
      `${this.api}/societies/${societyId}/subscription`,
      { planId, cycle },
      { context: inlineErrors() },
    );
  }

  /** Platform: off a free plan at once (first period invoiced today), otherwise from the next period. Errors in the dialog. */
  changePlan(societyId: number, planId: number | null, cycle: SubscriptionCycle | null) {
    return this.http.patch<SocietySubscription>(
      `${this.api}/societies/${societyId}/subscription/plan`,
      { planId, cycle },
      { context: inlineErrors() },
    );
  }

  setDiscount(societyId: number, percent: number, periods: number, note: string | null) {
    return this.http.put<SocietySubscription>(
      `${this.api}/societies/${societyId}/subscription/discount`,
      { percent, periods, note },
      { context: inlineErrors() },
    );
  }

  cancel(societyId: number, note: string) {
    return this.http.post<SocietySubscription>(
      `${this.api}/societies/${societyId}/subscription/cancel`,
      { note },
      { context: inlineErrors() },
    );
  }

  setBillingContact(societyId: number, userId: number) {
    return this.http.put<SocietySubscription>(
      `${this.api}/societies/${societyId}/subscription/billing-contact`,
      { userId },
      { context: inlineErrors() },
    );
  }

  /** The society asks the platform for another plan or cycle. */
  requestChange(
    societyId: number,
    planId: number | null,
    cycle: SubscriptionCycle | null,
    note: string | null,
  ) {
    return this.http.post<SocietySubscription>(
      `${this.api}/societies/${societyId}/subscription/request-change`,
      { planId, cycle, note },
      { context: inlineErrors() },
    );
  }

  // ---- Invoices ----

  invoicesOf(societyId: number) {
    return this.http.get<PlatformInvoiceSummary[]>(
      `${this.api}/societies/${societyId}/subscription/invoices`,
    );
  }

  /** Every invoice (platform), optionally only one status or only overdue ones. */
  allInvoices(filter: { status?: PlatformInvoiceStatus | null; overdue?: boolean } = {}) {
    const params: Record<string, string> = {};
    if (filter.status) params['status'] = filter.status;
    if (filter.overdue) params['overdue'] = 'true';
    return this.http.get<PlatformInvoiceSummary[]>(`${this.api}/platform/invoices`, { params });
  }

  invoice(id: number) {
    return this.http.get<PlatformInvoice>(`${this.api}/platform-invoices/${id}`);
  }

  /** The next period's invoice when it is due; null (204) when nothing is due yet. */
  issueDue(societyId: number) {
    return this.http.post<PlatformInvoice | null>(
      `${this.api}/societies/${societyId}/subscription/invoices/issue-due`,
      {},
    );
  }

  /** Platform: a bank transfer, UPI, cheque or cash payment. Errors in the dialog. */
  recordPayment(invoiceId: number, body: RecordPlatformPaymentRequest) {
    return this.http.post<PlatformInvoice>(
      `${this.api}/platform-invoices/${invoiceId}/payments`,
      body,
      { context: inlineErrors() },
    );
  }

  creditNote(invoiceId: number, amount: number, reason: string) {
    return this.http.post<PlatformInvoice>(
      `${this.api}/platform-invoices/${invoiceId}/credit-notes`,
      { amount, reason },
      { context: inlineErrors() },
    );
  }

  // ---- Paying online (Razorpay) ----

  razorpayOrder(invoiceId: number) {
    return this.http.post<CheckoutOrder>(
      `${this.api}/platform-invoices/${invoiceId}/razorpay-order`,
      {},
      { context: inlineErrors() },
    );
  }

  razorpayVerify(invoiceId: number, orderId: string, paymentId: string, signature: string) {
    return this.http.post<PlatformInvoice>(
      `${this.api}/platform-invoices/${invoiceId}/razorpay-verify`,
      { orderId, paymentId, signature },
      { context: inlineErrors() },
    );
  }

  // ---- Billing run ----

  run() {
    return this.http.post<BillingRunResult>(`${this.api}/platform/billing/run`, {});
  }
}
