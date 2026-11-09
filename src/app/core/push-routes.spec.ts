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
    expect(pushRoute({ type: 'SOMETHING_NEW' })).toBe('/');
  });
});
