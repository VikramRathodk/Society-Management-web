import { ResidentType } from './common.model';
import { IssuedInvitation } from './invitation.model';
import { CreateSocietyRequest, Society, SocietySource, SocietyStatus } from './structure.model';

// ---- Setup checklist ----

export interface OnboardingChecklist {
  societyId: number;
  name: string;
  status: SocietyStatus;
  source: SocietySource;
  createdAt: string | null;
  wentLiveAt: string | null;
  /** Required: `missing` lists the profile fields still empty. */
  profile: { done: boolean; missing: string[] };
  structure: { done: boolean; wings: number; flats: number };
  /** `staged`: rows of the residents sheet ready to be invited (sent at go-live). */
  residents: { done: boolean; members: number; openInvitations: number; staged: number };
  committee: { done: boolean; members: number; openInvitations: number; staged: number };
  settings: { done: boolean; customized: number };
  stepsDone: number;
  stepsTotal: number;
  canGoLive: boolean;
}

// ---- Platform-led: society + secretary invitation ----

export interface NewSocietyRequest extends CreateSocietyRequest {
  secretary: { name: string; phone: string };
}

export interface NewSocietyResponse {
  society: Society;
  secretaryInvitation: IssuedInvitation;
}

// ---- Self-signup ----

export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** The public form. Applicant name, phone and password only when not signed in. */
export interface SocietyApplicationRequest {
  societyName: string;
  city: string;
  address?: string;
  approxFlats?: number;
  applicantName?: string;
  applicantPhone?: string;
  applicantEmail?: string;
  password?: string;
  message?: string;
}

/** What the applicant sees about their own registration. */
export interface ApplicationStatusView {
  number: number;
  societyName: string;
  status: ApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  reason: string | null;
}

/** The super admin's view of a registration. */
export interface SocietyApplication {
  id: number;
  societyName: string;
  city: string;
  address: string | null;
  approxFlats: number | null;
  applicantName: string;
  applicantPhone: string;
  applicantEmail: string | null;
  /** Applied while signed in: approving adds the role to that account. */
  existingAccount: boolean;
  message: string | null;
  status: ApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reason: string | null;
  societyId: number | null;
}

// ---- Wings & flats from a pattern ----

export interface WingPattern {
  wing: string;
  floorsFrom: number;
  floorsTo: number;
  flatsPerFloor: number;
  /** Tokens {floor}, {nn}, {n}, {wing}; default "{floor}{nn}". */
  numbering?: string;
  skip?: string[];
  extraUnits?: string[];
}

export interface PlannedWing {
  name: string;
  exists: boolean;
  newFlats: number;
  existingFlats: number;
  flats: { number: string; exists: boolean }[];
}

// ---- Residents from a sheet ----

export interface ImportRow {
  id: number;
  /** The line in the file. */
  row: number;
  wingText: string | null;
  flatText: string | null;
  name: string | null;
  phoneText: string | null;
  typeText: string | null;
  flatId: number | null;
  flatLabel: string | null;
  phone: string | null;
  residentType: ResidentType | null;
  /** Why it can't be sent; null when it's ready. */
  error: string | null;
  invitationId: number | null;
}

export interface ResidentImport {
  id: number;
  fileName: string | null;
  status: 'OPEN' | 'SENT';
  uploadedAt: string;
  uploadedByName: string;
  sentAt: string | null;
  total: number;
  ready: number;
  withErrors: number;
  sent: number;
  rows: ImportRow[];
}

/** 1-based columns. */
export interface SheetColumns {
  flat: number;
  name: number;
  phone: number;
  wing: number | null;
  type: number | null;
}

export interface UploadedSheet {
  sheet: ResidentImport;
  header: string[];
  columns: SheetColumns;
}

/** A sent row: its link exists only in this response. */
export interface SentInvitation {
  row: number;
  flatLabel: string;
  name: string;
  phone: string;
  invitationId: number;
  token: string;
  inviteUrl: string;
}

export interface SendResult {
  sent: SentInvitation[];
  skipped: ImportRow[];
}

export interface GoLiveResponse {
  onboarding: OnboardingChecklist;
  /** Null when no residents sheet was staged. */
  residentInvitations: SendResult | null;
}
