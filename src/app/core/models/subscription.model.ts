/** Platform billing: what the platform charges a society (not maintenance, which a society charges residents). */

/** Paid modules a plan may include; core modules are in every plan. ALL covers everything. */
export type PlanModule = 'MAINTENANCE' | 'FINANCE' | 'POLICIES' | 'GOVERNANCE' | 'ALL';

export type SubscriptionCycle = 'MONTHLY' | 'YEARLY';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export type PlatformInvoiceStatus = 'ISSUED' | 'PARTLY_PAID' | 'PAID' | 'CANCELLED';

export type PlatformPaymentMode = 'RAZORPAY' | 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH';

export type SubscriptionEventKind =
  | 'STARTED'
  | 'PLAN_CHANGE_SCHEDULED'
  | 'PLAN_CHANGED'
  | 'CYCLE_CHANGED'
  | 'STATUS_CHANGED'
  | 'DISCOUNT'
  | 'CONTACT_CHANGED'
  | 'CHANGE_REQUESTED'
  | 'CANCELLED';

export interface Plan {
  id: number;
  code: string;
  name: string;
  description: string | null;
  /** The price per society for a period, covering `includedFlats` flats (any number when null). */
  priceMonthly: number;
  priceYearly: number;
  includedFlats: number | null;
  /** Per flat beyond the included ones, per period. */
  extraFlatMonthly: number | null;
  extraFlatYearly: number | null;
  /** The most flats a society on the plan may have (null: no limit). */
  maxFlats: number | null;
  trialDays: number;
  modules: PlanModule[];
  active: boolean;
  sortOrder: number;
  /** Shown as "Most popular" (at most one plan). */
  featured: boolean;
  /** The recommended plan from this many flats (the highest one not above a society's count). */
  recommendedFromFlats: number;
}

export interface PlanRequest {
  code: string;
  name: string;
  description?: string | null;
  priceMonthly: number;
  priceYearly: number;
  includedFlats?: number | null;
  extraFlatMonthly?: number | null;
  extraFlatYearly?: number | null;
  maxFlats?: number | null;
  trialDays: number;
  modules: PlanModule[];
  active: boolean;
  sortOrder: number;
  featured: boolean;
  recommendedFromFlats: number;
}

/** A plan's cost for a flat count (before GST). */
export interface PlanQuote {
  plan: Plan;
  flats: number;
  extraFlats: number;
  /** False when the plan allows fewer flats. */
  fits: boolean;
  monthly: number;
  yearly: number;
  recommended: boolean;
}

export interface PlanRecommendation {
  flats: number;
  recommendedPlanId: number | null;
  quotes: PlanQuote[];
}

export interface SubscriptionEvent {
  kind: SubscriptionEventKind;
  from: string | null;
  to: string | null;
  note: string | null;
  by: number | null;
  at: string;
}

export interface SocietySubscription {
  societyId: number;
  societyName: string | null;
  plan: Plan;
  cycle: SubscriptionCycle;
  status: SubscriptionStatus;
  trialEndsOn: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextInvoiceOn: string;
  /** Applies from the next period. */
  pendingPlan: Plan | null;
  pendingCycle: SubscriptionCycle | null;
  billingContactId: number | null;
  discountPercent: number;
  discountPeriodsLeft: number;
  flats: number;
  /** Flats beyond the ones the next period's plan includes. */
  extraFlats: number;
  /** One period at today's flat count with the next period's plan (before discount and GST). */
  chargePerPeriod: number;
  cancelledAt: string | null;
  events: SubscriptionEvent[];
}

/** What every member's app needs: which paid modules to show and whether paid work is paused. */
export interface SubscriptionAccess {
  billing: boolean;
  status: SubscriptionStatus | null;
  planName: string | null;
  modules: PlanModule[];
  readOnly: boolean;
  trialEndsOn: string | null;
  overdueInvoiceId: number | null;
  overdueInvoiceNumber: string | null;
  overdueBalance: number | null;
  overdueSince: string | null;
}

export interface PlatformInvoiceSummary {
  id: number;
  number: string;
  societyId: number;
  societyName: string;
  periodStart: string;
  periodEnd: string;
  planName: string;
  cycle: SubscriptionCycle;
  total: number;
  balance: number;
  status: PlatformInvoiceStatus;
  issuedOn: string;
  dueOn: string;
  overdue: boolean;
}

export interface PlatformPayment {
  id: number;
  receiptNumber: string;
  amount: number;
  mode: PlatformPaymentMode;
  reference: string | null;
  paidOn: string;
  createdAt: string;
}

export interface PlatformCreditNote {
  id: number;
  number: string;
  amount: number;
  reason: string;
  createdAt: string;
}

/** Everything a printable invoice needs. */
export interface PlatformInvoice {
  summary: PlatformInvoiceSummary;
  seller: { legalName: string; gstin: string | null; address: string | null; state: string | null };
  societyAddress: string | null;
  societyState: string | null;
  planCode: string;
  flats: number;
  /** The plan's price for the period, the flats it covers (null: all), and flats beyond them at a rate. */
  basePrice: number;
  includedFlats: number | null;
  extraFlats: number;
  extraFlatRate: number | null;
  amount: number;
  discountPercent: number;
  discountAmount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  gstPercent: number;
  total: number;
  paidAmount: number;
  creditedAmount: number;
  payments: PlatformPayment[];
  creditNotes: PlatformCreditNote[];
}

export interface RecordPlatformPaymentRequest {
  amount: number;
  mode: Exclude<PlatformPaymentMode, 'RAZORPAY'>;
  reference?: string;
  paidOn?: string;
}

/** What Razorpay Checkout is opened with. */
export interface CheckoutOrder {
  keyId: string;
  orderId: string;
  /** In paise. */
  amount: number;
  currency: string;
  invoiceId: number;
  invoiceNumber: string;
  merchantName: string;
}

export interface BillingRunResult {
  invoiced: number;
  reminded: number;
  pastDue: number;
  suspended: number;
}
