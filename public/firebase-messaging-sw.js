// FCM push for the web app (see src/app/core/push.ts). Plain push handling, so this file needs no
// Firebase SDK. While a tab is focused the message goes to the app (snackbar + re-fetch);
// otherwise it shows as a system notification.

// Keep in sync with pushRoute in src/app/core/push-routes.ts.
function routeFor(data) {
  switch (data.type) {
    case 'VISITOR_LOGGED':
    case 'VISITOR_RESPONDED':
      return '/visitors';
    case 'NOTICE_POSTED':
      return '/notices';
    case 'COMPLAINT_RAISED':
    case 'COMPLAINT_STATUS_CHANGED':
      return data.complaintId ? `/complaints/${data.complaintId}` : '/complaints';
    case 'INVITATION_RECEIVED':
      return '/dashboard';
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

function appTabs() {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((tabs) => tabs.filter((t) => t.url.startsWith(self.location.origin)));
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: still show something, browsers penalise pushes that show nothing.
  }
  const n = payload.notification || {};
  const data = payload.data || {};
  const title = n.title || data.title || 'Sahvasa';
  const body = n.body || data.body;

  event.waitUntil(
    appTabs().then((tabs) => {
      // Only the tab the user is actually looking at gets the in-app snackbar. A visible but
      // unfocused window (side by side, another profile on top) still gets the system notification.
      const active = tabs.find((t) => t.visibilityState === 'visible' && t.focused);
      if (active) {
        active.postMessage({ source: 'sm-push', kind: 'message', title, body, data });
        return;
      }
      const id = data.visitorId || data.complaintId || data.noticeId || '';
      return self.registration.showNotification(title, {
        body,
        icon: n.icon || new URL('favicon.ico', self.location).href,
        // A repeat push for the same item replaces the old notification instead of stacking.
        tag: data.type ? `${data.type}:${id}` : undefined,
        // The guard's request should buzz again if the resident still hasn't answered.
        renotify: data.type === 'VISITOR_LOGGED',
        data: { url: routeFor(data) },
      });
    }),
  );
});

// Route an open tab (the app navigates itself) and focus it, or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url || '/';
  event.waitUntil(
    appTabs().then((tabs) => {
      const tab = tabs[0];
      if (!tab) return self.clients.openWindow(new URL(path, self.location.origin).href);
      tab.postMessage({ source: 'sm-push', kind: 'open', url: path });
      return tab.focus();
    }),
  );
});
