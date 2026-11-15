/** AGM and SGM are general body meetings; COMMITTEE is the managing committee. */
export type MeetingKind = 'AGM' | 'SGM' | 'COMMITTEE';

export type MeetingStatus =
  'DRAFT' | 'NOTICE_SENT' | 'CANCELLED' | 'ADJOURNED' | 'HELD' | 'MINUTES_PUBLISHED';

export type MeetingView = 'upcoming' | 'past' | 'drafts';

export type RsvpResponse = 'YES' | 'NO' | 'MAYBE';

export type VotingStatus = 'NOT_OPEN' | 'OPEN' | 'CLOSED';

export type Outcome = 'PASSED' | 'REJECTED' | 'DEFERRED';

export type VoteChoice = 'FOR' | 'AGAINST' | 'ABSTAIN';

export interface MeetingPerson {
  id: number;
  name: string | null;
}

export interface VoteResults {
  votesFor: number;
  votesAgainst: number;
  abstained: number;
}

export interface AgendaItem {
  id: number;
  position: number;
  title: string;
  description: string | null;
  resolutionText: string | null;
  proposedBy: MeetingPerson | null;
  secondedBy: MeetingPerson | null;
  votingStatus: VotingStatus;
  outcome: Outcome | null;
  resolutionNumber: string | null;
  /** Ballots cast so far, out of the meeting's electorate. */
  turnout: number;
  /** Only once voting has closed (secret ballot: no running totals). */
  results: VoteResults | null;
  youVoted: boolean;
  canVote: boolean;
  /** How many flats the caller votes for (more than one: they pick the flat). */
  yourVotes: number;
  /** The flats the caller votes for at a general meeting, and whether each has voted. */
  yourFlats: { id: number; label: string; voted: boolean }[];
}

export interface Meeting {
  id: number;
  societyId: number;
  kind: MeetingKind;
  general: boolean;
  title: string;
  description: string | null;
  scheduledAt: string;
  place: string | null;
  onlineLink: string | null;
  status: MeetingStatus;
  agenda: AgendaItem[];
  noticeDays: number;
  noticeSentAt: string | null;
  noticeSentBy: MeetingPerson | null;
  shortNoticeReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  adjournedFromId: number | null;
  adjournedToId: number | null;
  adjournReason: string | null;
  yourRsvp: RsvpResponse | null;
  canRsvp: boolean;
  /** Organisers only. */
  rsvpCounts: { yes: number; no: number; maybe: number } | null;
  createdBy: MeetingPerson;
  createdAt: string;
  heldAt: string | null;
  chairperson: MeetingPerson | null;
  /** Member flats (general) or committee members who may vote. */
  electorate: number;
  quorumRequired: number | null;
  quorumPresent: number | null;
}

export interface AgendaItemRequest {
  title: string;
  description?: string | null;
  resolutionText?: string | null;
}

export interface MeetingRequest {
  kind: MeetingKind;
  title: string;
  description?: string | null;
  scheduledAt: string;
  place?: string | null;
  onlineLink?: string | null;
  agenda: AgendaItemRequest[];
}

export interface Quorum {
  members: number;
  required: number;
  present: number;
  met: boolean;
}

export interface AttendanceRow {
  user: MeetingPerson;
  flatIds: number[];
  committee: boolean;
  present: boolean;
  rsvp: RsvpResponse | null;
}

export interface AttendanceSheet {
  meetingId: number;
  status: MeetingStatus;
  quorum: Quorum;
  people: AttendanceRow[];
}

export interface RsvpEntry {
  user: MeetingPerson;
  response: RsvpResponse;
  updatedAt: string;
}

export interface RsvpList {
  yes: number;
  no: number;
  maybe: number;
  responses: RsvpEntry[];
}

export interface Resolution {
  itemId: number;
  resolutionNumber: string | null;
  title: string;
  resolutionText: string | null;
  outcome: Outcome;
  results: VoteResults | null;
  decidedAt: string | null;
  meetingId: number;
  meetingKind: MeetingKind;
  meetingTitle: string;
  meetingAt: string;
}

export type MinutesStatus = 'DRAFT' | 'PENDING' | 'PUBLISHED';

export interface MinutesAddendum {
  id: number;
  text: string;
  createdBy: MeetingPerson;
  createdAt: string;
}

export interface Minutes {
  meetingId: number;
  status: MinutesStatus;
  body: string;
  attachment: { name: string | null; contentType: string; sizeBytes: number } | null;
  draftedBy: MeetingPerson;
  draftedAt: string;
  updatedAt: string | null;
  submittedAt: string | null;
  reviewedBy: MeetingPerson | null;
  reviewReason: string | null;
  approvedBy: MeetingPerson | null;
  publishedAt: string | null;
  announcedNoticeId: number | null;
  addenda: MinutesAddendum[];
}
