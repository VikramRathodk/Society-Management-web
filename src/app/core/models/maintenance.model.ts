/** Money arrives as JSON numbers with two decimals (rupees). Dates are ISO yyyy-mm-dd. */

export type BillingFrequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';
export type LateFeeType = 'NONE' | 'FIXED' | 'SIMPLE_INTEREST';
export type ChargeCalcType = 'FIXED' | 'PER_SQFT';
export type BillLineType = 'FIXED' | 'PER_SQFT' | 'LATE_FEE' | 'OPENING_BALANCE';
export type CycleKind = 'REGULAR' | 'OPENING_BALANCE';
export type CycleStatus = 'ISSUED' | 'CANCELLED';
export type BillStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'WAIVED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'CHEQUE' | 'UPI' | 'BANK_TRANSFER';
export type PaymentStatus = 'RECORDED' | 'VOID';

export interface MaintenanceSettings {
  societyId: number;
  billingFrequency: BillingFrequency;
  dueDays: number;
  roundToRupee: boolean;
  lateFeeType: LateFeeType;
  /** Rupees for FIXED, % a year for SIMPLE_INTEREST. */
  lateFeeValue: number;
  graceDays: number;
  /** The society's UPI ID (VPA); null hides the pay-by-UPI QR on bills. */
  upiId: string | null;
  /** Name UPI apps show the payer; null falls back to the society name. */
  upiPayeeName: string | null;
  /** null until the society first saves its settings (defaults in use). */
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface UpdateSettingsRequest {
  billingFrequency: BillingFrequency;
  dueDays: number;
  roundToRupee: boolean;
  lateFeeType?: LateFeeType;
  lateFeeValue?: number;
  graceDays?: number;
  /** Omitted keeps the saved value; an empty string removes it. */
  upiId?: string;
  upiPayeeName?: string;
}

export interface ChargeHead {
  id: number;
  societyId: number;
  name: string;
  calcType: ChargeCalcType;
  /** Rupees for FIXED, rupees per sq ft for PER_SQFT. */
  amount: number;
  active: boolean;
  sortOrder: number;
}

export interface ChargeHeadRequest {
  name: string;
  calcType: ChargeCalcType;
  amount: number;
  active?: boolean;
  sortOrder?: number;
}

export interface BillingPeriod {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
}

export interface BillLine {
  headName: string;
  calcType: BillLineType;
  rate: number;
  quantity: number;
  amount: number;
  note: string | null;
}

export interface PreviewBill {
  flatId: number;
  wingName: string;
  flatNumber: string;
  lines: BillLine[];
  total: number;
}

export interface PreviewProblem {
  flatId: number;
  wingName: string;
  flatNumber: string;
  message: string;
}

/** Issuing is refused while `problems` is not empty. */
export interface BillingPreview extends BillingPeriod {
  billCount: number;
  total: number;
  bills: PreviewBill[];
  problems: PreviewProblem[];
}

export interface BillingCycle extends BillingPeriod {
  id: number;
  societyId: number;
  kind: CycleKind;
  status: CycleStatus;
  issuedAt: string | null;
  issuedById: number;
  issuedByName: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  billCount: number;
  totalBilled: number;
  billsByStatus: Partial<Record<BillStatus, number>>;
  totalPaid: number;
  totalOutstanding: number;
}

export interface BillPayment {
  paymentId: number;
  receiptNumber: string;
  paidOn: string;
  method: PaymentMethod;
  /** The part of the payment that went to this bill. */
  amount: number;
}

export interface Bill extends BillingPeriod {
  id: number;
  billNumber: string;
  societyId: number;
  cycleId: number;
  cycleKind: CycleKind;
  flatId: number;
  wingName: string;
  flatNumber: string;
  total: number;
  amountPaid: number;
  /** Zero once paid, waived or cancelled. */
  outstanding: number;
  status: BillStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedByName: string | null;
  createdAt: string | null;
  /** Only on the single-bill endpoint. */
  lines: BillLine[] | null;
  payments: BillPayment[] | null;
}

export interface RecordPaymentRequest {
  flatId: number;
  amount: number;
  paidOn: string;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  /** Pay this bill first; the rest goes to the oldest bills. */
  billId?: number;
}

export interface PaymentAllocation {
  billId: number;
  billNumber: string;
  amount: number;
}

export interface Payment {
  id: number;
  receiptNumber: string;
  societyId: number;
  flatId: number;
  wingName: string;
  flatNumber: string;
  amount: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  status: PaymentStatus;
  recordedAt: string | null;
  recordedByName: string;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  /** Only on the single-payment endpoint (the receipt). */
  allocations: PaymentAllocation[] | null;
}

export interface OpeningBalanceEntry {
  flatId: number;
  amount: number;
  note?: string;
}

export interface OpeningBalancesRequest {
  asOf: string;
  dueDate: string;
  entries: OpeningBalanceEntry[];
}

export interface FlatDues {
  flatId: number;
  wingName: string;
  flatNumber: string;
  openBills: number;
  outstanding: number;
  /** Past the due date plus the society's grace days. */
  overdue: number;
  oldestDueDate: string;
}

export interface ReminderResult {
  flatCount: number;
  totalOverdue: number;
}
