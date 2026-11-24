import { ComplaintCategory } from './complaint.model';
import { PaymentMethod } from './maintenance.model';
import { VehicleType } from './parking.model';

/**
 * The dashboard's headline numbers for the signed-in user in one society. A null part means the user
 * may not see it (or the plan leaves that module out); show only the cards that come back.
 */
export interface DashboardCounts {
  visitors: { waiting: number; inside: number; loggedToday: number } | null;
  complaints: { open: number; inProgress: number } | null;
  dues: { outstanding: number; overdue: number; flatsWithDues: number } | null;
  users: number | null;
  wings: number | null;
  policiesToApprove: number | null;
  staffToVerify: number | null;
  staffInside: number | null;
  vehiclesToApprove: number | null;
  openParkingReports: number | null;
}

/** Months are "yyyy-MM", oldest first, every month present (zeros when nothing happened). */
export interface MaintenanceStats {
  from: string;
  to: string;
  months: {
    month: string;
    billed: number;
    collected: number;
    byMethod: Partial<Record<PaymentMethod, number>>;
  }[];
  /** Open bills by days past due: not-due, 1-30, 31-60, 61-90, 90+. */
  ageing: { bucket: string; amount: number; flats: number }[];
}

export interface FinanceStats {
  from: string;
  to: string;
  months: { month: string; income: number; expenditure: number; surplus: number }[];
  /** Largest first; the rest summed as "Other" (accountId null). */
  expensesByAccount: { accountId: number | null; name: string; amount: number }[];
}

export interface ComplaintStats {
  from: string;
  to: string;
  months: { month: string; opened: number; resolved: number }[];
  unresolvedByCategory: Record<ComplaintCategory, number>;
}

/** Days are ISO dates, oldest first, every day present. */
export interface VisitorStats {
  from: string;
  to: string;
  days: { date: string; logged: number; entered: number; rejected: number }[];
}

export interface StaffStats {
  from: string;
  to: string;
  days: { date: string; present: number }[];
}

export interface ParkingStats {
  resident: { vehicleType: VehicleType; slots: number; allotted: number; free: number; waiting: number }[];
  visitorSlots: number;
  visitorSlotsInUse: number;
}
