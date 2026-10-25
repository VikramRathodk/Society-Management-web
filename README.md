# Society Management — Web

Angular web client (admin / committee / gate portal) for the Society Management Spring Boot API.
The design and API contract are in [docs/ANGULAR_FRONTEND.md](docs/ANGULAR_FRONTEND.md).

Built with Angular 21 (standalone components, signals, zoneless) and Angular Material.

## Running locally

1. Start the backend on `http://localhost:8080`, with the dev seed (`scripts/dev-seed.sql`) loaded.
2. Start the web app:

   ```bash
   npm install
   npm start
   ```

3. Open `http://localhost:4200`. Requests to `/api/...` are forwarded to `:8080` by
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

## Build

```bash
npm run build
```

Output goes to `dist/society-management-web`. In production, serve it from the same origin as the
API (for example behind a reverse proxy), or add CORS to the backend.

## Project layout

```
src/app/
├── core/        API services, auth (store, interceptors, guards), society context, models
├── shared/      Dialogs, empty state, sorting helpers
├── features/    One folder per screen: auth, dashboard, profile, societies, structure,
│                users, visitors, roles
└── layout/      Shell: top bar, society switcher, side nav
e2e/             Playwright tests
```
