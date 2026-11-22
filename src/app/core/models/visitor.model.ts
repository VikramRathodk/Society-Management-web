export type VisitorStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ENTERED' | 'EXITED';

export interface Visitor {
  id: number;
  societyId: number;
  flatId: number;
  flatNumber: string;
  visitorName: string;
  visitorPhone: string | null;
  purpose: string | null;
  /** Relative URL that needs the auth header; fetch as a blob instead of using <img src>. */
  photoUrl: string | null;
  status: VisitorStatus;
  /** Capitals and digits, when they came by vehicle. */
  vehicleNumber?: string | null;
  loggedById: number;
  loggedByName: string;
  respondedById: number | null;
  respondedByName: string | null;
  /** Decided by SECRETARY+ on the flat's behalf. */
  overridden: boolean;
  loggedAt: string | null;
  respondedAt: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
}

export interface LogVisitorRequest {
  flatId: number;
  visitorName: string;
  visitorPhone?: string;
  purpose?: string;
  vehicleNumber?: string;
}
