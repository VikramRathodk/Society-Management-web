/** Online payments (module 16): linked accounts, residents paying online, the society's report, refunds. */

export type PaymentAccountStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_CLARIFICATION'
  | 'ACTIVATED'
  | 'FAILED'
  | 'SUSPENDED';

/** The society's Razorpay linked account (status null: never set up). Only masked details. */
export interface PaymentAccount {
  societyId: number;
  societyName: string | null;
  status: PaymentAccountStatus | null;
  reason: string | null;
  requirements: string[];
  legalName: string | null;
  businessType: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  street1: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  panMasked: string | null;
  bankLast4: string | null;
  ifsc: string | null;
  beneficiaryName: string | null;
  /** The platform only. */
  razorpayAccountId: string | null;
  submittedAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  /** The society's "Residents can pay online" setting. */
  enabled: boolean;
  /** Activated and enabled: residents see "Pay online". */
  accepting: boolean;
}

/** The secretary's form. The PAN and the bank account number go to Razorpay only. */
export interface PaymentAccountRequest {
  legalName: string;
  businessType: string;
  pan: string;
  contactName: string;
  email: string;
  phone: string;
  signatoryPan: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string;
  postalCode: string;
  accountNumber: string;
  ifsc: string;
  beneficiaryName: string;
}

export type FeeMode = 'SOCIETY_ABSORBS' | 'CONVENIENCE_PERCENT' | 'CONVENIENCE_FIXED';

/** What a resident would pay: the dues part (on the bills) plus the convenience fee. */
export interface OnlineQuote {
  owed: number;
  minimum: number;
  amount: number;
  convenienceFee: number;
  total: number;
  feeMode: FeeMode;
  billId: number | null;
}

export interface OnlineOptions {
  accepting: boolean;
  quote: OnlineQuote | null;
}

export interface MaintenanceCheckout {
  keyId: string;
  orderId: string;
  /** Paise. */
  amount: number;
  currency: string;
  merchantName: string;
  description: string;
  quote: OnlineQuote;
}

export interface OnlineCapture {
  maintenancePaymentId: number | null;
  receiptNumber: string | null;
  alreadyRecorded: boolean;
  problem: string | null;
}

export type OnlineOrderStatus = 'CREATED' | 'PAID' | 'FAILED' | 'PROBLEM';
export type TransferStatus = 'PENDING' | 'CREATED' | 'PROCESSED' | 'FAILED';
export type GatewayRefundStatus = 'PENDING_APPROVAL' | 'REQUESTED' | 'PROCESSED' | 'FAILED' | 'REJECTED';
export type GatewayRefundKind = 'PAYMENT' | 'ORDER';

/** One online payment with its fees, transfer and refund (rupees). */
export interface OnlinePaymentRow {
  orderId: number;
  societyId: number;
  paidAt: string;
  flatId: number;
  flatLabel: string;
  payerName: string | null;
  status: OnlineOrderStatus;
  problem: string | null;
  gatewayPaymentId: string | null;
  maintenancePaymentId: number | null;
  receiptNumber: string | null;
  dues: number;
  convenienceFee: number;
  feeMode: FeeMode;
  gatewayFee: number | null;
  commission: number | null;
  transferAmount: number | null;
  transferId: number | null;
  transferStatus: TransferStatus | null;
  transferError: string | null;
  refundId: number | null;
  refundStatus: GatewayRefundStatus | null;
}

export interface GatewayRefund {
  id: number;
  societyId: number;
  onlineOrderId: number;
  maintenancePaymentId: number | null;
  kind: GatewayRefundKind;
  amount: number;
  reason: string;
  status: GatewayRefundStatus;
  error: string | null;
  requestedBy: number;
  requestedAt: string;
  decidedBy: number | null;
  decidedAt: string | null;
  decisionReason: string | null;
}
