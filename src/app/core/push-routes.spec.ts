import { pushRoute } from './push-routes';

describe('pushRoute', () => {
  it('maps each push type to its screen', () => {
    expect(pushRoute({ type: 'VISITOR_LOGGED', visitorId: '4' })).toBe('/visitors');
    expect(pushRoute({ type: 'VISITOR_RESPONDED', visitorId: '4' })).toBe('/visitors');
    expect(pushRoute({ type: 'PERMISSIONS_CHANGED', societyId: '3' })).toBe('/dashboard');
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
    for (const type of [
      'MEETING_NOTICE',
      'MEETING_CANCELLED',
      'MEETING_ADJOURNED',
      'MEETING_REMINDER',
      'VOTING_OPEN',
      'VOTING_CLOSED',
      'MINUTES_SUBMITTED',
      'MINUTES_SENT_BACK',
      'MINUTES_PUBLISHED',
    ]) {
      expect(pushRoute({ type, meetingId: '4' })).toBe('/meetings/4');
    }
    expect(pushRoute({ type: 'MEETING_NOTICE' })).toBe('/meetings');
    for (const type of ['PLATFORM_INVOICE', 'PLATFORM_PAYMENT', 'PLATFORM_INVOICE_REMINDER']) {
      expect(pushRoute({ type, invoiceId: '12' })).toBe('/subscription/invoices/12');
    }
    expect(pushRoute({ type: 'PLATFORM_INVOICE' })).toBe('/subscription');
    expect(pushRoute({ type: 'SUBSCRIPTION_STATUS', status: 'SUSPENDED' })).toBe('/subscription');
    expect(pushRoute({ type: 'SOMETHING_NEW' })).toBe('/');
  });
});
