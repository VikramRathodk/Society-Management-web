/** The `data` of a backend push: `type` plus string ids (see the backend's *Notifications classes). */
export type PushData = Record<string, string | undefined>;

/**
 * Where a push should take the user. Keep in sync with `routeFor` in
 * public/firebase-messaging-sw.js, which can't import app code.
 */
export function pushRoute(data: PushData): string {
  switch (data['type']) {
    case 'VISITOR_LOGGED':
    case 'VISITOR_RESPONDED':
      return '/visitors';
    case 'NOTICE_POSTED':
      return '/notices';
    case 'COMPLAINT_RAISED':
    case 'COMPLAINT_STATUS_CHANGED':
      return data['complaintId'] ? `/complaints/${data['complaintId']}` : '/complaints';
    case 'POLICY_SUBMITTED':
    case 'POLICY_SENT_BACK':
    case 'POLICY_APPROVED':
    case 'POLICY_PUBLISHED':
    case 'POLICY_ACKNOWLEDGEMENT_REMINDER':
      return data['policyId'] ? `/policies/${data['policyId']}` : '/policies';
    case 'INVITATION_RECEIVED':
      return '/dashboard'; // the pending-invitations banner is on every page
    case 'INVITATION_NEEDS_APPROVAL':
      return '/invitations?status=AWAITING_APPROVAL';
    case 'INVITATION_APPROVED':
    case 'INVITATION_REJECTED':
    case 'INVITATION_ACCEPTED':
      return '/invitations';
    default:
      return '/';
  }
}
