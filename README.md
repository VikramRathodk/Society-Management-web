# Sahvasa — Web

Sahvasa: the Angular web client (admin / committee / gate portal) for the Society Management Spring Boot API.
The design and API contract are in [docs/ANGULAR_FRONTEND.md](docs/ANGULAR_FRONTEND.md).

Built with Angular 21 (standalone components, signals, zoneless) and Angular Material.

## Running locally

1. Start the backend on `http://localhost:8080`, with the dev seed (`scripts/dev-seed.sql`) loaded.
2. Copy `src/environments/firebase.example.ts` to `src/environments/firebase.ts` (git-ignored; the app
   does not build without it). Fill in the Firebase web config and VAPID key to get push
   notifications, or leave the values empty to run without push. See
   [docs/WEB_PUSH_SETUP.md](docs/WEB_PUSH_SETUP.md).
3. Start the web app:

   ```bash
   npm install
   npm start
   ```

4. Open `http://localhost:4200`. Requests to `/api/...` are forwarded to `:8080` by
   `proxy.conf.json` (the backend has no CORS setup). Restart `npm start` after editing that file.

Dev logins (every password is `Pass@123`):

| User           | Phone        | Role                      |
| -------------- | ------------ | ------------------------- |
| Stan Lee       | `9000000999` | Super admin               |
| Nick Fury      | `9000000616` | Secretary, Avengers Tower |
| Steve Rogers   | `9000000001` | Committee                 |
| Happy Hogan    | `9000000002` | Guard                     |
| Tony Stark     | `9000000003` | Resident, Penthouse       |
| Wanda Maximoff | `9000000007` | Resident, Stark Wing-1001 |

## Tests

| Command                     | What it does                                              |
| --------------------------- | --------------------------------------------------------- |
| `npm test`                  | Unit tests (Vitest) in watch mode                         |
| `npx ng test --watch=false` | Unit tests once                                           |
| `npm run e2e`               | End-to-end tests (Playwright) against the running backend |

The e2e tests use the installed Chrome (no browser download), reuse a running `npm start` or start
one, and run on a desktop and a phone-sized viewport. They read the dev seed, and the visitor test
deletes the entry it creates. Full-page screenshots of every screen are saved to
`test-results/screens`; the HTML report is in `playwright-report`.

## Build and deploy

```bash
npm run build
```

This is a production build (the default configuration). The static site is in
`dist/society-management-web/browser`: upload that folder's contents to the web server.

- **Same origin as the API.** The app calls relative `/api/...` paths and the backend has no CORS
  setup, so the web server must serve the site and forward `/api/` to the backend. The backend
  README has an nginx example.
- **Deep links.** Routes like `/complaints/12` are client-side, so unknown paths must fall back to
  `index.html` (`try_files $uri $uri/ /index.html;` in nginx).
- **HTTPS.** Browsers only allow push notifications on HTTPS (or `localhost`). Add the production
  domain to the Firebase web API key's HTTP-referrer restrictions.
- **Service worker.** Serve `firebase-messaging-sw.js` from the site root with no or short caching,
  so browsers pick up changes to it.
- **First login** on a new database uses the super admin the backend creates from its
  `BOOTSTRAP_ADMIN_*` variables (see the backend README).

## Project layout

```
src/app/
├── core/        API services, auth (store, interceptors, guards), society context, models, push
├── shared/      Dialogs, empty state, sorting helpers
├── features/    One folder per screen: auth, dashboard, profile, societies, structure,
│                users, roles, visitors, notices, complaints
└── layout/      Shell: top bar, society switcher, side nav
e2e/             Playwright tests
```
