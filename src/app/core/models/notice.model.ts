export interface Notice {
  id: number;
  societyId: number;
  title: string;
  description: string | null;
  postedById: number;
  postedByName: string;
  createdAt: string | null;
  /** Set once edited; updatedById differs from postedById when a moderator changed it. */
  updatedAt: string | null;
  updatedById: number | null;
  updatedByName: string | null;
}

export interface CreateNoticeRequest {
  title: string;
  description?: string;
}

/** Omitted fields stay as they are; an empty description clears it. */
export interface UpdateNoticeRequest {
  title?: string;
  description?: string;
}
