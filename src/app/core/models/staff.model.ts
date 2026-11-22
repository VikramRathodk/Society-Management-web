/** Staff management (backend module 11): domestic help linked to flats, and the society's own staff. */

export type StaffKind = 'DOMESTIC' | 'SOCIETY';
export type StaffStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type StaffType =
  | 'MAID'
  | 'COOK'
  | 'DRIVER'
  | 'NANNY'
  | 'CLEANER'
  | 'GUARD'
  | 'HOUSEKEEPING'
  | 'GARDENER'
  | 'PLUMBER'
  | 'ELECTRICIAN'
  | 'MANAGER'
  | 'OTHER';
export type IdType = 'AADHAAR' | 'PAN' | 'DRIVING_LICENCE' | 'VOTER_ID' | 'PASSPORT' | 'OTHER';
export type DayOfWeek =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

/**
 * What the caller may see: FULL (committee; secretary for society staff), FLAT (a resident of a flat
 * the person works or worked for), GATE (guards: no phone, ID, code or salary).
 */
export type StaffView = 'FULL' | 'FLAT' | 'GATE';

export interface StaffPerson {
  id: number;
  name: string;
}

export interface StaffLink {
  id: number;
  flatId: number;
  /** "A-101" */
  flat: string;
  work: string | null;
  days: DayOfWeek[];
  /** "08:00:00" */
  timeFrom: string | null;
  timeTo: string | null;
  active: boolean;
  /** Not given at the gate. */
  notify: boolean | null;
  startedOn: string | null;
  endedOn: string | null;
  addedBy: StaffPerson | null;
}

export interface SocietyStaffDetails {
  designation: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  userId: number | null;
  /** Secretary and above only. */
  monthlySalary: number | null;
}

export interface BlockEvent {
  blocked: boolean;
  reason: string | null;
  by: StaffPerson;
  at: string;
}

export interface Staff {
  id: number;
  societyId: number;
  kind: StaffKind;
  name: string;
  staffType: StaffType;
  status: StaffStatus;
  blocked: boolean;
  blockReason: string | null;
  /** Relative API path; needs the auth header. */
  photoUrl: string | null;
  links: StaffLink[];
  view: StaffView;
  phone: string | null;
  entryCode: string | null;
  rejectionReason: string | null;
  idType: IdType | null;
  idLast4: string | null;
  idProofUrl: string | null;
  society: SocietyStaffDetails | null;
  createdBy: StaffPerson | null;
  createdAt: string | null;
  verifiedBy: StaffPerson | null;
  verifiedAt: string | null;
  blockedBy: StaffPerson | null;
  blockedAt: string | null;
  /** Committee, on a single person. */
  blockHistory: BlockEvent[] | null;
}

export interface StaffLookup {
  id: number;
  name: string;
  staffType: StaffType;
  photoUrl: string | null;
  verified: boolean;
  blocked: boolean;
  linkedToFlat: boolean;
}

export interface StaffCard {
  id: number;
  name: string;
  staffType: StaffType;
  kind: StaffKind;
  designation: string | null;
  societyName: string;
  entryCode: string;
  /** "STAFF:<societyId>:<code>", what the gate scans. */
  qrPayload: string;
  photoUrl: string | null;
  status: StaffStatus;
  blocked: boolean;
  flats: string[];
}

/** How a person works for one flat. Times as "HH:mm". */
export interface LinkRequest {
  work?: string | null;
  days?: DayOfWeek[];
  timeFrom?: string | null;
  timeTo?: string | null;
  notify?: boolean | null;
}

export interface AddHelpRequest extends LinkRequest {
  name: string;
  phone: string;
  staffType: StaffType;
  idType?: IdType | null;
  idNumber?: string | null;
}

export interface SocietyStaffRequest {
  designation?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  monthlySalary?: number | null;
  joinedOn?: string | null;
  leftOn?: string | null;
  userId?: number | null;
}

export interface AddSocietyStaffRequest extends SocietyStaffRequest {
  name: string;
  phone: string;
  staffType: StaffType;
  idType?: IdType | null;
  idNumber?: string | null;
}

/** null/undefined leaves a field unchanged; `society` replaces the employment details. */
export interface UpdateStaffRequest {
  name?: string;
  phone?: string;
  staffType?: StaffType;
  idType?: IdType | null;
  idNumber?: string | null;
  society?: SocietyStaffRequest;
}

export interface StaffDirectoryQuery {
  kind?: StaffKind | null;
  status?: StaffStatus | null;
  type?: StaffType | null;
  blocked?: boolean | null;
  q?: string | null;
}

/** A person as the gate sees them. */
export interface GateResult {
  staff: Staff;
  allowed: boolean;
  refusal: string | null;
  inside: boolean;
  entryId: number | null;
  inAt: string | null;
}

export interface StaffRef {
  id: number;
  name: string;
  staffType: StaffType;
  kind: StaffKind;
}

export interface StaffEntry {
  id: number;
  staff: StaffRef;
  inAt: string;
  inBy: StaffPerson;
  outAt: string | null;
  /** Null for an automatic check-out. */
  outBy: StaffPerson | null;
  autoCheckout: boolean;
  minutes: number | null;
}

export interface StaffAttendance {
  staff: StaffRef;
  daysPresent: number;
  minutes: number;
  visits: number;
  /** ISO dates. */
  days: string[];
}
