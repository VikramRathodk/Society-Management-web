import { pushRoute } from './push-routes';

describe('pushRoute', () => {
  it('maps each push type to its screen', () => {
    expect(pushRoute({ type: 'VISITOR_LOGGED', visitorId: '4' })).toBe('/visitors');
    expect(pushRoute({ type: 'VISITOR_RESPONDED', visitorId: '4' })).toBe('/visitors');
    expect(pushRoute({ type: 'NOTICE_POSTED', noticeId: '2' })).toBe('/notices');
    expect(pushRoute({ type: 'COMPLAINT_RAISED', complaintId: '9' })).toBe('/complaints/9');
    expect(pushRoute({ type: 'COMPLAINT_STATUS_CHANGED', complaintId: '9' })).toBe('/complaints/9');
    expect(pushRoute({ type: 'INVITATION_RECEIVED', invitationId: '3' })).toBe('/dashboard');
    expect(pushRoute({ type: 'INVITATION_ACCEPTED', invitationId: '3' })).toBe('/invitations');
    expect(pushRoute({ type: 'INVITATION_NEEDS_APPROVAL', invitationId: '3' })).toBe(
      '/invitations?status=AWAITING_APPROVAL',
    );
    expect(pushRoute({ type: 'INVITATION_APPROVED', invitationId: '3' })).toBe('/invitations');
    expect(pushRoute({ type: 'INVITATION_REJECTED', invitationId: '3' })).toBe('/invitations');
    expect(pushRoute({ type: 'POLICY_PUBLISHED', policyId: '7', version: '2' })).toBe(
      '/policies/7',
    );
    expect(pushRoute({ type: 'POLICY_SUBMITTED', policyId: '7' })).toBe('/policies/7');
    expect(pushRoute({ type: 'POLICY_SENT_BACK', policyId: '7' })).toBe('/policies/7');
    expect(pushRoute({ type: 'POLICY_APPROVED', policyId: '7' })).toBe('/policies/7');
    expect(pushRoute({ type: 'POLICY_ACKNOWLEDGEMENT_REMINDER', policyId: '7' })).toBe(
      '/policies/7',
    );
    expect(pushRoute({ type: 'POLICY_PUBLISHED' })).toBe('/policies');
    expect(pushRoute({ type: 'SOMETHING_NEW' })).toBe('/');
  });
});
