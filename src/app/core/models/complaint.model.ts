export type ComplaintCategory = 'PLUMBING' | 'ELECTRICAL' | 'SECURITY' | 'OTHER';
export type ComplaintStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Complaint {
  id: number;
  societyId: number;
  flatId: number;
  flatNumber: string;
  category: ComplaintCategory;
  description: string;
  status: ComplaintStatus;
  raisedById: number;
  raisedByName: string;
  createdAt: string | null;
  /** Last edit or status change. */
  updatedAt: string | null;
  updatedById: number | null;
  updatedByName: string | null;
}

/** One step of a complaint's timeline: raised (fromStatus null) or a status change. */
export interface ComplaintActivity {
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus;
  note: string | null;
  actorId: number;
  actorName: string;
  createdAt: string | null;
}

export interface RaiseComplaintRequest {
  flatId: number;
  category: ComplaintCategory;
  description: string;
}

/** Omitted fields stay as they are. */
export interface UpdateComplaintRequest {
  category?: ComplaintCategory;
  description?: string;
}
