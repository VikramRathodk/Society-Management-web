import { ResidentType } from './common.model';

export type InvitationStatus =
  'PENDING' | 'AWAITING_APPROVAL' | 'ACCEPTED' | 'DECLINED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';

export interface Invitation {
  id: number;
  societyId: number;
  societyName: string;
  role: string;
  roleName: string;
  flatId: number | null;
  /** "A-101" */
  flatLabel: string | null;
  residentType: ResidentType | null;
  phone: string;
  name: string;
  status: InvitationStatus;
  invitedById: number;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
  acceptedUserId: number | null;
}

/** A freshly made link (create or resend). The token is never shown again: resend for a new one. */
export interface IssuedInvitation {
  invitation: Invitation;
  token: string;
  inviteUrl: string;
}

/** What the person holding the link sees. */
export interface InvitationPreview {
  societyName: string;
  role: string;
  roleName: string;
  flatLabel: string | null;
  residentType: ResidentType | null;
  name: string;
  maskedPhone: string;
  invitedByName: string;
  status: InvitationStatus;
  expiresAt: string;
  /** The phone already has an account: log in to accept. */
  hasAccount: boolean;
}

export interface CreateInvitationRequest {
  phone: string;
  name: string;
  role: string;
  flatId?: number;
  residentType?: ResidentType;
}

export interface AcceptInvitationRequest {
  name?: string;
  password?: string;
}
