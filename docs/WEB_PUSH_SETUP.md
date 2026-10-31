# Web Push (FCM) Setup & Plan

Goal: the Angular app receives the same Firebase Cloud Messaging pushes as the mobile app: a
visitor at the gate, the answer to a visitor request, new notices, and complaint updates.

The backend side is done (`FcmPushNotifier`, see the backend's `docs/FIREBASE_SETUP.md`). This
document covers the browser side.

Firebase project: **`society-managment-8d21f`**.

---

## 1. Starting point (before the section 3 work)

| Piece | File | State |
|---|---|---|
| Firebase web config | `src/environments/firebase.ts` | ✅ filled in (these values are public) |
| VAPID key | `src/environments/firebase.ts` → `vapidKey` | ✅ set |
| Wired into both environments | `environment.ts`, `environment.development.ts` | ✅ |
| `PushService.register()` | `src/app/core/push.ts` | ✅ asks permission → `getToken` → `PATCH /api/users/{id}` `{fcmToken}`; foreground messages → snackbar |
| Called after login / on reload | `src/app/layout/shell.ts` constructor | ✅ |
| `UserApi.update(..., context)` | `src/app/core/api/user.api.ts` | ✅ accepts `inlineErrors()` |
| Background service worker | `public/firebase-messaging-sw.js` | ✅ shows the notification; click focuses or opens a tab |
| `firebase` SDK | `package.json` `^13.1.0` | ✅ lazy-loaded, not in the initial bundle |

---

## 2. Firebase Console (manual, one-time)

1. **Generate the VAPID key:** Project settings → **Cloud Messaging** → *Web configuration* →
   **Web Push certificates** → **Generate key pair**. Copy the public key into
   `src/environments/firebase.ts`:
   ```ts
   export const vapidKey = 'B...';   // public key, safe to commit
   ```
2. **Restrict the web API key (recommended):** Google Cloud Console → APIs & Services →
   Credentials → *Browser key (auto created by Firebase)* → Application restrictions →
   **HTTP referrers**: `http://localhost:4200/*` and your production domain.
3. **Check the FCM API:** "Firebase Cloud Messaging API (V1)" must show *Enabled* (the backend
   needs it too).

---

## 3. Gaps found and how they were fixed (all done, see the checklist)

### 3.1 Logout doesn't unregister the browser ❗
The current problem: user A logs out and user B logs in on the same browser. Until B's token is
saved, A's account still points at this browser, so A's pushes appear on B's screen. A related
bug: the `sm.fcmToken` cache in localStorage still says `A:token`, so when A logs in again the
PATCH is skipped. Meanwhile the backend has moved the token to B, so A gets no pushes.

**Plan:** add `PushService.unregister()`, called from `Shell.logout()` **before**
`auth.logout()` (it still needs the JWT):
1. `PATCH /api/users/{id}` `{ "fcmToken": "" }` (the backend treats blank as "clear").
2. `deleteToken(messaging)` so Firebase stops delivering to this browser.
3. Remove `sm.fcmToken` from localStorage, and reset `started = false`.
4. Ignore every error and never block logout. Use a timeout of about 2 s on the PATCH.

When a 401 logs the user out automatically (`error.interceptor.ts`), the PATCH can't succeed
because the JWT has expired. Only do steps 2 and 3 there. The backend moves the token to whoever
registers it next, which covers this case.

### 3.2 Permission prompt on page load
Calling `Notification.requestPermission()` from the shell constructor causes two problems:
- Chrome treats prompts that appear without a user click as spam and may block them silently.
- Safari only allows the prompt after a user gesture.

**Plan:**
- Shell on load: call `register()` **only when `Notification.permission === 'granted'`**, to
  refresh the token silently.
- Otherwise show an **"Enable notifications"** action: a toolbar/menu item, and a card on
  *Profile*. Clicking it calls `register()`, which shows the prompt.
- If permission is `'denied'`, show a hint ("blocked in browser settings") instead of the
  button.
- Expose state as a signal: `PushService.status: 'unsupported' | 'off' | 'on' | 'blocked'`.

### 3.3 Clicking a notification always opens `/`
The service worker reads `data.link`, but the backend sends `type` + ids, not a link.
**Plan:** map `data.type` to a route **in the service worker**, so the backend stays
client-agnostic:

| `data.type` | Extra data | Open |
|---|---|---|
| `VISITOR_LOGGED` | `visitorId` | `/visitors` (approvals) |
| `VISITOR_RESPONDED` | `visitorId`, `status`, `override` | `/visitors` |
| `NOTICE_POSTED` | `noticeId` | `/notices` |
| `COMPLAINT_RAISED` | `complaintId` | `/complaints/{complaintId}` |
| `COMPLAINT_STATUS_CHANGED` | `complaintId`, `status` | `/complaints/{complaintId}` |
| anything else | — | `/` |

Also in the service worker:
- `tag: data.type + id`, so a repeated push replaces the old notification instead of stacking.
- `renotify: true` for `VISITOR_LOGGED`, so the guard's request buzzes again.

### 3.4 Foreground messages only show a snackbar
**Plan:** `PushService` also exposes `messages$` (a `Subject` of `data`).
- The visitors screens re-fetch when a `VISITOR_*` message arrives. The 10–15 s polling stays as
  a fallback.
- The complaint detail page re-fetches on `COMPLAINT_STATUS_CHANGED` for its own id.
- The snackbar gets a **View** action that navigates using the same type → route map as 3.3.
  Put that map in a shared `core/push-routes.ts` and copy it into the service worker, which can't
  import from the app.

### 3.5 Small hardening
- `register()` currently calls `navigator.serviceWorker.register('/firebase-messaging-sw.js')`.
  Keep the absolute path only while `baseHref` is `/`. If the app is ever served from a
  sub-path, build the path from `document.baseURI`.
- If `@angular/pwa` (`ngsw-worker.js`) is added later, both workers need the same scope. Either
  import the FCM handling into one worker, or give FCM its own scope.
- Re-check the token on `visibilitychange` once a day; Firebase rotates tokens occasionally.
  `getToken()` returns the current token, and the localStorage cache prevents extra PATCH calls.

---

## 4. Known limitation (backend)

The backend stores **one `fcmToken` per user**, so a user signed in on both the web and the
phone gets pushes only on whichever device registered last. Expect this in testing. Fixing it
needs a `user_device` table in the backend, which is deferred until after the M3 demo.

---

## 5. Testing

1. **Local dev:** `localhost` counts as a secure context, so `ng serve` over http works.
   Production needs HTTPS.
2. **Backend:** run with `PUSH_PROVIDER=fcm` and
   `FIREBASE_CREDENTIALS=secrets/<service-account>.json`.
3. **Token:** log in and click *Enable notifications*. Check the Network tab for
   `PATCH /api/users/{id}` with `fcmToken`.
4. **Firebase Console smoke test:** Messaging → *New campaign* → *Send test message*, then paste
   the token (logged by `PushService` in dev). This proves the browser side works without the
   backend.
5. **End to end:** guard logs a visitor in window A while the resident has this tab open or in
   the background in window B.
   - Expect: B gets a notification, and clicking it opens `/visitors`.
   - Then: approve, and the guard's tab gets `VISITOR_RESPONDED`.
6. **Logout:** log out, then check in the DB that `users.fcm_token` is null for that user. The API
   response does not include the token. Log in as another user and check that pushes for the first user stop.
7. **Unit tests:** `push.spec.ts` stubs `PushService.firebase()` and the browser APIs, then checks:
   - no prompt when permission isn't granted;
   - PATCH skipped when the cache matches;
   - `unregister` clears the token and the cache, and never throws.
8. **e2e (Playwright):** grant `notifications` in the browser context and assert that the
   *Enable notifications* button becomes "on". Real FCM delivery isn't testable in CI, so skip
   it there.

---

## 6. Checklist

- [x] VAPID key generated and set in `src/environments/firebase.ts`
- [ ] API key restricted to HTTP referrers
- [x] `PushService.unregister()` + call from `Shell.logout()` and the 401 path (3.1)
- [x] Permission only on user click; `status` signal; Enable/blocked UI in toolbar + Profile (3.2)
- [x] Type → route map in service worker; `tag` / `renotify` (3.3)
- [x] `messages$` + re-fetch on visitors/complaint screens; snackbar **View** action (3.4)
- [x] `push.spec.ts` unit tests (Firebase stubbed via `firebase()`, not `vi.mock`)
- [ ] Playwright check for the enable button
- [ ] Manual end-to-end run (section 5)
- [x] `docs/ANGULAR_FRONTEND.md` updated (push is no longer "off until vapidKey")
