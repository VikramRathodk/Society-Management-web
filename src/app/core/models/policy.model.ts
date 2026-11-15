/** A heading on the rules page. Hidden ones keep their policies but aren't offered for new ones. */
export interface PolicyCategory {
  id: number;
  name: string;
  position: number;
  hidden: boolean;
}

/** DRAFT until first published; ARCHIVED is out of force but keeps its history. */
export type PolicyStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

/** DRAFT → PENDING (submitted) → PUBLISHED; SUPERSEDED once a later version is published. */
export type PolicyVersionStatus = 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'SUPERSEDED';

export type PolicyFilter = 'published' | 'archived' | 'drafts' | 'awaiting-approval';

export interface PersonRef {
  id: number;
  name: string | null;
}

export interface PolicyAttachment {
  name: string | null;
  contentType: string;
  sizeBytes: number;
}

/** One version in a policy's history (no text). */
export interface PolicyVersionSummary {
  id: number;
  number: number;
  status: PolicyVersionStatus;
  changeSummary: string | null;
  effectiveFrom: string | null;
  materialChange: boolean;
  publishedAt: string | null;
  publishedBy: PersonRef | null;
  createdBy: PersonRef;
}

export interface PolicyVersion {
  id: number;
  policyId: number;
  number: number;
  status: PolicyVersionStatus;
  body: string;
  changeSummary: string | null;
  /** Null on a draft: the day it is published. */
  effectiveFrom: string | null;
  /** Asks residents to acknowledge again (when the policy asks for acknowledgement). */
  materialChange: boolean;
  /** The published text in force today. */
  inForce: boolean;
  attachment: PolicyAttachment | null;
  createdBy: PersonRef;
  createdAt: string;
  updatedAt: string | null;
  submittedAt: string | null;
  reviewedBy: PersonRef | null;
  reviewedAt: string | null;
  /** Why it was last sent back. */
  reviewReason: string | null;
  publishedBy: PersonRef | null;
  publishedAt: string | null;
}

/** For a resident: the version whose acknowledgement counts, and when they gave it (null: not yet). */
export interface YourAcknowledgement {
  version: number;
  acknowledgedAt: string | null;
}

export interface PolicySummary {
  id: number;
  societyId: number;
  title: string;
  category: PolicyCategory;
  status: PolicyStatus;
  requiresAcknowledgement: boolean;
  /** The latest published version, and the one in force today (they differ while a change is upcoming). */
  currentVersion: number | null;
  inForceVersion: number | null;
  effectiveFrom: string | null;
  takesEffectOn: string | null;
  publishedAt: string | null;
  /** Only for the committee. */
  openVersion: PolicyVersionSummary | null;
  updatedAt: string | null;
  yourAcknowledgement: YourAcknowledgement | null;
}

export interface PolicyWorkflow {
  approvalRequired: boolean;
  selfApprovalAllowed: boolean;
}

export interface Policy {
  summary: PolicySummary;
  /** The latest published text. */
  current: PolicyVersion | null;
  /** The draft or the version waiting for approval (committee only). */
  open: PolicyVersion | null;
  /** Newest first. */
  versions: PolicyVersionSummary[];
  createdBy: PersonRef;
  createdAt: string;
  archivedAt: string | null;
  workflow: PolicyWorkflow | null;
}

export interface CreatePolicyRequest {
  categoryId: number;
  title: string;
  requiresAcknowledgement?: boolean;
  body?: string;
  changeSummary?: string | null;
  effectiveFrom?: string | null;
}

/** Only the fields sent change. */
export interface UpdatePolicyRequest {
  categoryId?: number;
  title?: string;
  requiresAcknowledgement?: boolean;
}

/** The whole draft; effectiveFrom null means "the day it is published". */
export interface SavePolicyDraftRequest {
  body: string;
  changeSummary: string | null;
  effectiveFrom: string | null;
  materialChange: boolean;
}

export interface PolicyAcknowledgement {
  policyId: number;
  version: number;
  acknowledgedAt: string;
}

export interface MemberAcknowledgement {
  userId: number;
  name: string;
  residentType: 'OWNER' | 'FAMILY' | 'TENANT' | null;
  acknowledgedAt: string | null;
}

export interface FlatAcknowledgement {
  flatId: number;
  wing: string;
  flatNumber: string;
  done: boolean;
  lastRemindedAt: string | null;
  members: MemberAcknowledgement[];
}

export type AcknowledgementState = 'all' | 'pending' | 'done';

/** `flats` follows the state filter; the counts are for every flat. */
export interface AcknowledgementReport {
  policyId: number;
  title: string;
  version: number;
  currentVersion: number;
  totalFlats: number;
  doneFlats: number;
  pendingFlats: number;
  people: number;
  flats: FlatAcknowledgement[];
}

export interface PolicyReminderResult {
  reminded: number;
  skipped: number;
}
