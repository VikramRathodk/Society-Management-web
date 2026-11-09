import { Invitation, IssuedInvitation } from '../../core/models';

// Sample data for the invitation specs.

export function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 7,
    societyId: 4,
    societyName: 'Green Park',
    role: 'RESIDENT',
    roleName: 'Resident',
    flatId: 9,
    flatLabel: 'A-101',
    residentType: 'TENANT',
    phone: '9876543210',
    name: 'Priya',
    status: 'PENDING',
    invitedById: 2,
    invitedByName: 'Sneha',
    createdAt: '2026-11-09T10:00:00Z',
    expiresAt: '2026-11-16T10:00:00Z',
    closedAt: null,
    acceptedUserId: null,
    approvedAt: null,
    approvedByName: null,
    ...overrides,
  };
}

export function issued(overrides: Partial<Invitation> = {}): IssuedInvitation {
  return {
    invitation: invitation(overrides),
    token: 'tok123',
    inviteUrl: 'http://localhost:4200/invite/tok123',
  };
}
