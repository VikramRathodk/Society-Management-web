# Society Management — Angular Web Frontend

Build guide for an Angular web client (admin / committee / gate portal) on top of the existing Spring Boot API.
The Flutter app stays the primary mobile client; this web app talks to exactly the same endpoints and the same
permission model, so nothing here needs backend changes except the CORS note below.

---

## 1. Tech Stack

| Concern | Choice |
|---|---|
| Framework | Angular 20+ — standalone components, signals, new control flow (`@if`, `@for`) |
| Language | TypeScript (strict mode) |
| HTTP | `HttpClient` with functional interceptors (`withInterceptors`) |
| State | Signals in injectable stores (no NgRx needed at MVP size) |
| Routing | Lazy-loaded feature routes, functional guards (`CanMatchFn`) |
| UI | Angular Material (or PrimeNG) + SCSS |
| Forms | Typed reactive forms |
| Tests | Jest or Karma/Jasmine for units, Playwright for e2e |

```bash
npm install -g @angular/cli
ng new society-web --style=scss --routing --ssr=false
cd society-web
ng add @angular/material
```

---

## 2. Backend Connection

| Item | Value |
|---|---|
| Base URL (dev) | `http://localhost:8080` |
| Auth | `Authorization: Bearer <jwt>` on every call except `/api/auth/**` |
| Token lifetime | 24h (`app.jwt.expiration-ms`, default 86400000). No refresh endpoint — on 401, log out. |
| Ids | All ids are numeric (`Long` → `number` in TS) |
| Timestamps | ISO-8601 instants (UTC), e.g. `2026-10-25T09:30:00Z` |

### CORS

The backend has **no CORS configuration**, so browser calls from `localhost:4200` to `localhost:8080` will be
blocked. Use the Angular dev-server proxy in development:

`proxy.conf.json`
```json
{
  "/api": { "target": "http://localhost:8080", "secure": false, "changeOrigin": true }
}
```

`angular.json` → `projects.society-web.architect.serve.options`:
```json
"proxyConfig": "proxy.conf.json"
```

Then call relative URLs (`/api/...`) and keep `apiBaseUrl = ''` in `environment.ts`. For production either serve
the built app behind the same origin (reverse proxy) or add a `CorsConfigurationSource` bean to `SecurityConfig`.

### Dev logins

Seeded by `scripts/dev-seed.sql`; every password is `Pass@123`.

| User | Phone | Role |
|---|---|---|
| Stan Lee | `9000000999` | SUPER_ADMIN (platform) |
| Nick Fury | `9000000616` | SECRETARY — Avengers Tower |
| Steve Rogers | `9000000001` | COMMITTEE |
| Happy Hogan | `9000000002` | GUARD |
| Tony Stark | `9000000003` | RESIDENT (OWNER, Penthouse) |
| Wanda Maximoff | `9000000007` | RESIDENT (OWNER, Stark Wing-1001) |

---

## 3. Folder Structure

```
src/app/
├── core/
│   ├── api/                 # one service per backend controller
│   │   ├── auth.api.ts
│   │   ├── user.api.ts
│   │   ├── role.api.ts
│   │   ├── society.api.ts   # societies, complexes
│   │   ├── structure.api.ts # wings, flats
│   │   ├── visitor.api.ts
│   │   ├── notice.api.ts
│   │   └── complaint.api.ts
│   ├── auth/
│   │   ├── auth.store.ts        # token + user + access (signals)
│   │   ├── auth.interceptor.ts  # attaches Bearer token
│   │   ├── error.interceptor.ts # 401 → logout, maps ErrorResponse
│   │   ├── permission.guard.ts  # route guard on permission codes
│   │   └── has-permission.directive.ts
│   ├── society-context/
│   │   └── society-context.store.ts # currently selected society
│   └── models/              # TS interfaces mirroring the DTOs (section 5)
├── shared/                  # dumb UI: confirm & export dialogs, status chip, empty states
├── features/
│   ├── auth/login/
│   ├── dashboard/
│   ├── societies/           # list/detail/create (super admin), settings (secretary)
│   ├── structure/           # wings → flats tree
│   ├── users/               # directory, create, roles, activate/deactivate
│   ├── roles/               # role & permission editor (super admin)
│   ├── visitors/            # gate log, log-visitor form, approvals, export
│   ├── notices/             # notice board, post/edit dialog
│   ├── complaints/          # list, raise form, detail with timeline and status changes
│   └── profile/
├── layout/                  # shell: top bar, society switcher, side nav
├── app.routes.ts
└── app.config.ts
```

---

## 4. Auth & Permission Model

### Login flow

1. `POST /api/auth/login` with `{ phone, password }`.
2. Store `token` (localStorage) and the `access` block in `AuthStore`.
3. On app start, if a token exists call `GET /api/users/me` to refresh `user` + `access`
   (permissions can change server-side without a new token — the JWT never carries them).
4. Navigate to `/dashboard`.

Errors: **401** "Invalid phone or password", **403** "Account is deactivated".

### Scopes — the important part

A user holds **several role assignments**, each either platform-wide or tied to one society (and, for `RESIDENT`,
one flat). `access` is already resolved by the backend (inheritance + `all_permissions` applied):

```ts
access = {
  platformRoles: ['SUPER_ADMIN'],
  platformPermissions: [...],             // apply in EVERY society
  societies: [{ societyId: 1, roles: ['SECRETARY'], permissions: [...] }]
}
```

So "can this user do X?" always depends on **which society**:

```ts
// auth.store.ts
can(permission: string, societyId?: number | null): boolean {
  const a = this.access();
  if (!a) return false;
  if (a.platformPermissions.includes(permission)) return true;
  if (societyId == null) return a.societies.some(s => s.permissions.includes(permission));
  return a.societies.find(s => s.societyId === societyId)?.permissions.includes(permission) ?? false;
}
canOnPlatform(permission: string): boolean {
  return this.access()?.platformPermissions.includes(permission) ?? false;
}
```

The UI checks are **UX only** — the backend is the security boundary and will still answer 403.

### Society context

Most screens work inside one society. Keep a `SocietyContextStore.selectedSocietyId` signal:

- Super admin: list from `GET /api/societies` (returns all).
- Everyone else: `access.societies[].societyId` (fetch names via `GET /api/societies/{id}` when the user holds
  `SOCIETY.SETTINGS.VIEW`, else show "Society #id" or the flat label).
- Show a switcher in the top bar only when the user has more than one society.
- Persist the selection in localStorage.

### Role hierarchy

`SUPER_ADMIN > ADMIN > SECRETARY > { COMMITTEE > RESIDENT, GUARD }`. Higher roles can only create/assign/manage
roles **below** them. Do not hard-code this — use `GET /api/roles/assignable?societyId=` to fill role pickers.
Custom roles may exist; never switch on role codes for behaviour, always on permission codes.

### Building blocks

```ts
// auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthStore).token();
  return next(token && !req.url.includes('/api/auth/')
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req);
};
```

```ts
// permission.guard.ts — route data: { permission: 'USER.ACCOUNT.VIEW', platform?: true }
export const permissionGuard: CanMatchFn = (route) => {
  const auth = inject(AuthStore);
  const ctx = inject(SocietyContextStore);
  const { permission, platform } = route.data ?? {};
  const ok = platform ? auth.canOnPlatform(permission) : auth.can(permission, ctx.selectedSocietyId());
  return ok || inject(Router).createUrlTree(['/forbidden']);
};
```

```html
<!-- has-permission.directive usage -->
<button *hasPermission="'FLAT.STRUCTURE.CREATE'">Add wing</button>
```

---

## 5. TypeScript Models

```ts
export type ResidentType = 'OWNER' | 'FAMILY' | 'TENANT';
export type RoleScope = 'PLATFORM' | 'SOCIETY';
export type VisitorStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ENTERED' | 'EXITED';

export interface ErrorResponse {
  timestamp: string; status: number; error: string; message: string | null; path: string;
}

// Auth / users
export interface LoginRequest { phone: string; password: string; }
export interface LoginResponse {
  token: string; userId: number; name: string;
  roles: RoleAssignment[]; access: Access;
}
export interface Access {
  platformRoles: string[]; platformPermissions: string[]; societies: SocietyAccess[];
}
export interface SocietyAccess { societyId: number; roles: string[]; permissions: string[]; }
export interface RoleAssignment {
  id: number; role: string; roleName: string;
  societyId: number | null; flatId: number | null; residentType: ResidentType | null;
}
export interface User {
  id: number; name: string; phone: string; email: string | null;
  isActive: boolean; roles: RoleAssignment[];
}
export interface MeResponse { user: User; access: Access; }
export interface CreateUserRequest {
  name: string; phone: string; email?: string; password: string;
  role: string; societyId?: number; flatId?: number; residentType?: ResidentType;
}
export interface AssignRoleRequest {
  role: string; societyId?: number; flatId?: number; residentType?: ResidentType;
}
export interface UpdateProfileRequest { name?: string; email?: string; fcmToken?: string; }

// Roles
export interface Role {
  code: string; name: string; description: string | null; scopeLevel: RoleScope;
  requiresFlat: boolean; allPermissions: boolean; isSystem: boolean;
  inherits: string[]; permissions: string[]; effectivePermissions: string[];
}
export interface CreateRoleRequest {
  code: string; name: string; description?: string; scopeLevel: RoleScope;
  requiresFlat?: boolean; inherits?: string[]; includedIn?: string[]; permissions?: string[];
}
export interface AssignableRole { code: string; name: string; scopeLevel: RoleScope; requiresFlat: boolean; }
export interface Permission { code: string; description: string | null; }

// Structure
export interface Complex { id: number; name: string; address: string | null; }
export interface Society { id: number; name: string; address: string | null; complexId: number | null; }
export interface Wing { id: number; societyId: number; name: string; }
export interface Flat { id: number; wingId: number; flatNumber: string; }

// Visitors
export interface Visitor {
  id: number; societyId: number; flatId: number; flatNumber: string;
  visitorName: string; visitorPhone: string | null; purpose: string | null;
  photoUrl: string | null;          // relative, needs the auth header — see 7.4
  status: VisitorStatus;
  loggedById: number; loggedByName: string;
  respondedById: number | null; respondedByName: string | null;
  overridden: boolean;              // decided by SECRETARY+ on the flat's behalf
  loggedAt: string | null; respondedAt: string | null;
  enteredAt: string | null; exitedAt: string | null;
}
```

---

## 6. API Reference (by service)

### `auth.api.ts`
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/login` | `LoginRequest` | `LoginResponse` |

### `user.api.ts`
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/users/me` | — | `MeResponse` |
| GET | `/api/users?societyId=` | `USER.ACCOUNT.VIEW` | `User[]`; omit `societyId` for all visible |
| GET | `/api/users/{id}` | `USER.ACCOUNT.VIEW` | |
| POST | `/api/users` | `USER.ACCOUNT.CREATE` | 201; role must be below caller's |
| PATCH | `/api/users/{id}` | `USER.PROFILE.UPDATE` (self) / `USER.ACCOUNT.UPDATE` (others) | |
| PATCH | `/api/users/{id}/deactivate` | `USER.ACCOUNT.DELETE` | not self |
| PATCH | `/api/users/{id}/activate` | `USER.ACCOUNT.DELETE` | |
| DELETE | `/api/users/{id}` | `USER.ACCOUNT.DELETE` on platform | 204; 409 if user has history → offer deactivate |
| GET | `/api/users/{id}/roles` | `USER.ROLE.VIEW` | `RoleAssignment[]` |
| GET | `/api/users/{id}/permissions` | `USER.ROLE.VIEW` | `Access` |
| POST | `/api/users/{id}/roles` | `USER.ROLE.ASSIGN` | 201 `RoleAssignment` |
| DELETE | `/api/users/{id}/roles/{assignmentId}` | `USER.ROLE.DELETE` | 204 |

### `role.api.ts` (platform only — super admin)
| Method | Path | Permission |
|---|---|---|
| GET | `/api/permissions` | `SYSTEM.PERMISSION.VIEW` |
| GET | `/api/roles` | `SYSTEM.ROLE.VIEW` |
| GET | `/api/roles/{code}` | `SYSTEM.ROLE.VIEW` |
| GET | `/api/roles/assignable?societyId=` | any authenticated user — drives role pickers |
| POST | `/api/roles` | `SYSTEM.ROLE.CREATE` |
| PATCH | `/api/roles/{code}` | `SYSTEM.ROLE.UPDATE` — `{ name?, description? }` |
| PUT | `/api/roles/{code}/permissions` | `SYSTEM.PERMISSION.UPDATE` — `{ permissions: string[] }` |
| PUT | `/api/roles/{code}/inherits` | `SYSTEM.ROLE.UPDATE` — `{ inherits: string[] }` |
| DELETE | `/api/roles/{code}` | `SYSTEM.ROLE.DELETE` — system roles can't be deleted |

### `society.api.ts`
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/societies` | `SOCIETY.SETTINGS.VIEW` | filtered to caller's societies |
| GET | `/api/societies/{id}` | `SOCIETY.SETTINGS.VIEW` | |
| POST | `/api/societies` | `SOCIETY.SETTINGS.CREATE` (platform) | `{ name, address?, complexId? }` |
| PATCH | `/api/societies/{id}` | `SOCIETY.SETTINGS.UPDATE` | `{ name?, address? }` |
| DELETE | `/api/societies/{id}` | `SOCIETY.SETTINGS.DELETE` (platform) | 409 while it has history |
| GET/POST/PATCH/DELETE | `/api/complexes[/{id}]` | `COMPLEX.SETTINGS.*` (platform) | only super admin today |

### `structure.api.ts`
| Method | Path | Permission |
|---|---|---|
| GET | `/api/societies/{societyId}/wings` | `FLAT.DIRECTORY.VIEW` |
| POST | `/api/societies/{societyId}/wings` | `FLAT.STRUCTURE.CREATE` — `{ name }` |
| GET / PATCH / DELETE | `/api/wings/{id}` | VIEW / `FLAT.STRUCTURE.UPDATE` `{ name }` / `.DELETE` |
| GET | `/api/wings/{wingId}/flats` | `FLAT.DIRECTORY.VIEW` |
| POST | `/api/wings/{wingId}/flats` | `FLAT.STRUCTURE.CREATE` — `{ flatNumber }` |
| GET / PATCH / DELETE | `/api/flats/{id}` | VIEW / `FLAT.STRUCTURE.UPDATE` `{ flatNumber }` / `.DELETE` |

### `visitor.api.ts`
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/visitors` | `VISITOR.ENTRY.CREATE` | **multipart**: `flatId`, `visitorName`, `visitorPhone?`, `purpose?`, `photo?` |
| GET | `/api/visitors?societyId=&status=&flatId=&page=0&size=20` | `VISITOR.ENTRY.VIEW` | newest first; residents get only their flat(s); `size` max 100 |
| GET | `/api/visitors/{id}` | `VISITOR.ENTRY.VIEW` | |
| GET | `/api/visitors/{id}/photo` | `VISITOR.ENTRY.VIEW` | image bytes |
| POST | `/api/visitors/{id}/approve` | `VISITOR.APPROVAL.APPROVE` | flat resident, or override by SECRETARY+ |
| POST | `/api/visitors/{id}/reject` | `VISITOR.APPROVAL.REJECT` | same |
| POST | `/api/visitors/{id}/enter` | `VISITOR.ENTRY.UPDATE` | only from APPROVED |
| POST | `/api/visitors/{id}/exit` | `VISITOR.ENTRY.UPDATE` | only from ENTERED |
| DELETE | `/api/visitors/{id}` | `VISITOR.ENTRY.DELETE` | 204 |
| GET | `/api/visitors/export?societyId=&from=&to=` | `VISITOR.ENTRY.EXPORT` | CSV download; ISO dates, inclusive, ≤ 366 days, ≤ 10,000 rows (400 above) |

Visitor list is a plain array (no total count) — implement "Load more" / next-page by requesting `page + 1`
until fewer than `size` rows come back. Guards see entries they logged plus every still-active one
(PENDING/APPROVED/ENTERED); finished entries of other guards need `VISITOR.HISTORY.VIEW` (COMMITTEE+).

### `notice.api.ts`
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/societies/{societyId}/notices` | `NOTICE.POST.CREATE` | `{ title, description? }` |
| GET | `/api/societies/{societyId}/notices?page=0&size=20` | `NOTICE.POST.VIEW` | newest first; `size` max 100 |
| GET | `/api/notices/{id}` | `NOTICE.POST.VIEW` | |
| PATCH | `/api/notices/{id}` | `NOTICE.POST.UPDATE` | own notices; anyone's with `NOTICE.POST.MODERATE` (SECRETARY+). `""` clears the description |
| DELETE | `/api/notices/{id}` | `NOTICE.POST.DELETE` | same own/moderate rule; 204 |

### `complaint.api.ts`
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/complaints` | `COMPLAINT.TICKET.CREATE` | `{ flatId, category, description }`; residents only for their own flat |
| GET | `/api/complaints?societyId=&status=&category=&flatId=&page=0&size=20` | `COMPLAINT.TICKET.VIEW` | newest first; residents get only their flat(s) |
| GET | `/api/complaints/{id}` | `COMPLAINT.TICKET.VIEW` | |
| GET | `/api/complaints/{id}/activity` | `COMPLAINT.TICKET.VIEW` | timeline, oldest first: raised (`fromStatus: null`) then each status change with its `note` |
| PATCH | `/api/complaints/{id}` | `COMPLAINT.TICKET.UPDATE` | **author only**, while OPEN or IN_PROGRESS (409 after) |
| DELETE | `/api/complaints/{id}` | `COMPLAINT.TICKET.DELETE` | withdraw: author only, while OPEN or IN_PROGRESS |
| POST | `/api/complaints/{id}/start` | `COMPLAINT.RESOLUTION.APPROVE` | OPEN → IN_PROGRESS; optional body `{ note }` |
| POST | `/api/complaints/{id}/resolve` | `COMPLAINT.RESOLUTION.APPROVE` | OPEN/IN_PROGRESS → RESOLVED |
| POST | `/api/complaints/{id}/close` | `COMPLAINT.RESOLUTION.APPROVE` | RESOLVED → CLOSED (final) |
| POST | `/api/complaints/{id}/reopen` | `COMPLAINT.RESOLUTION.REJECT` | RESOLVED → OPEN |
| GET | `/api/complaints/export?societyId=&from=&to=` | `COMPLAINT.TICKET.EXPORT` | CSV download, same limits as the visitor export |

Categories: `PLUMBING`, `ELECTRICAL`, `SECURITY`, `OTHER`. An invalid or concurrent status change is a 409.

---

## 7. Feature Screens

| Route | Screen | Gate (route `data`) |
|---|---|---|
| `/login` | Login | public |
| `/dashboard` | Cards built from permissions: pending visitors, today's log, open complaints, user count; notice board and open-complaints panels | authenticated |
| `/societies` | List / create / delete | `SOCIETY.SETTINGS.VIEW` |
| `/societies/:id/settings` | Edit name & address | `SOCIETY.SETTINGS.UPDATE` |
| `/structure` | Wing → flat tree for selected society | `FLAT.DIRECTORY.VIEW` |
| `/users` | Directory with role chips, active toggle | `USER.ACCOUNT.VIEW` |
| `/users/new` | Create user + first role | `USER.ACCOUNT.CREATE` |
| `/users/:id` | Profile, role assignments, effective permissions | `USER.ACCOUNT.VIEW` |
| `/roles` | Role list, permission matrix editor, inheritance | `SYSTEM.ROLE.VIEW` + platform |
| `/visitors` | Gate log with status filter, CSV export | `VISITOR.ENTRY.VIEW` |
| `/visitors/new` | Log visitor (guard desk) | `VISITOR.ENTRY.CREATE` |
| `/notices` | Notice board; post, and edit/delete own (or any, with MODERATE) | `NOTICE.POST.VIEW` |
| `/complaints` | Complaints with status/category filters, CSV export | `COMPLAINT.TICKET.VIEW` |
| `/complaints/new` | Raise a complaint (own flat preselected; wing → flat picker without one) | `COMPLAINT.TICKET.CREATE` |
| `/complaints/:id` | Details, author edit/withdraw, committee status changes with a note, timeline | `COMPLAINT.TICKET.VIEW` |
| `/profile` | Edit own name/email | `USER.PROFILE.UPDATE` |

### 7.1 Create user form
1. Pick society (from context) → load `GET /api/roles/assignable?societyId=` (omit for platform roles).
2. If the chosen role has `requiresFlat`, show wing → flat cascading selects and the `residentType` select.
3. Submit `CreateUserRequest`. Phone must be unique (400/409 message shown inline).

### 7.2 Structure tree
Load wings, lazily load flats per expanded wing. Inline add/rename/delete, each button behind
`*hasPermission` for `FLAT.STRUCTURE.CREATE|UPDATE|DELETE`. Duplicate flat number in a wing → 400.

### 7.3 Visitor lifecycle

```
PENDING ──approve──▶ APPROVED ──enter──▶ ENTERED ──exit──▶ EXITED
   └─────reject────▶ REJECTED
```

Actions per row:
- **Approve / Reject** when `status === 'PENDING'` and the user can approve in this society. If the user is not a
  resident of that flat it becomes an override — show a confirm dialog ("Decide on behalf of flat X?").
- **Mark entered** when `APPROVED`; **Mark exited** when `ENTERED` (guards).
- Show an "override" badge when `overridden` is true.
- **409** means someone else already answered or the status moved on — show the message and re-fetch the row.
- Poll the PENDING list every 10–15 s (`interval` + `switchMap`) on the gate and approvals screens. Web push
  (`core/push.ts`) also triggers a re-fetch on `VISITOR_*` messages, but stays best-effort: the bell in the top
  bar (or the card on *Profile*) asks for permission on click, then the FCM token is PATCHed as `fcmToken`.
  Logout clears it again.

Log-visitor form (multipart):
```ts
logVisitor(v: { flatId: number; visitorName: string; visitorPhone?: string; purpose?: string }, photo?: File) {
  const fd = new FormData();
  fd.append('flatId', String(v.flatId));
  fd.append('visitorName', v.visitorName);
  if (v.visitorPhone) fd.append('visitorPhone', v.visitorPhone);
  if (v.purpose) fd.append('purpose', v.purpose);
  if (photo) fd.append('photo', photo);
  return this.http.post<Visitor>('/api/visitors', fd); // don't set Content-Type; the browser adds the boundary
}
```
Limits: name ≤ 255, phone ≤ 15, purpose ≤ 100, photo JPEG/PNG/WebP ≤ 5 MB (413 above that). Validate client-side
too; offer camera capture with `<input type="file" accept="image/*" capture="environment">`.

### 7.4 Visitor photos
`photoUrl` needs the bearer token, so a plain `<img src>` will 401. Fetch as a blob and use an object URL:

```ts
photo(id: number) {
  return this.http.get(`/api/visitors/${id}/photo`, { responseType: 'blob' })
    .pipe(map(b => this.sanitizer.bypassSecurityTrustUrl(URL.createObjectURL(b))));
}
```
Revoke object URLs in `ngOnDestroy`. Responses are `no-store`, so cache in memory if needed.

---

## 8. Error Handling

Every error body is an `ErrorResponse`; show `message` to the user.

| Status | Meaning | UI behaviour |
|---|---|---|
| 400 | Validation / bad input (`"field: message; ..."`) | inline form errors / snackbar |
| 401 | Missing, invalid or expired token | clear store, redirect to `/login?returnUrl=` |
| 403 | Missing permission, wrong society, rank too low, deactivated | snackbar; don't log out |
| 404 | Not found | "not found" state |
| 409 | Conflict — already responded, delete blocked by history, duplicate | show message, refresh data |
| 413 | Upload too large | photo field error |

```ts
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore), router = inject(Router), snack = inject(MatSnackBar);
  return next(req).pipe(catchError((err: HttpErrorResponse) => {
    const msg = (err.error as ErrorResponse)?.message ?? 'Something went wrong';
    if (err.status === 401 && !req.url.includes('/api/auth/')) {
      auth.logout();
      router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
    } else if (err.status !== 400) {
      snack.open(msg, 'Close', { duration: 4000 });
    }
    return throwError(() => err);
  }));
};
```

---

## 9. `app.config.ts`

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    provideAnimationsAsync(),
    provideAppInitializer(() => inject(AuthStore).restore()), // GET /api/users/me if a token exists
  ],
};
```

---

## 10. Build Order

1. **Skeleton** — project, Material, proxy, environments, layout shell, models.
2. **Auth** — login, `AuthStore`, interceptors, `/me` restore, guards, `*hasPermission`, logout.
3. **Society context** — switcher + persisted selection.
4. **Structure** — societies list/settings, wings & flats tree.
5. **Users** — directory, create (assignable roles + flat picker), role assign/remove, activate/deactivate, delete.
6. **Visitors** — gate log, log-visitor form with photo, approve/reject/override, enter/exit, polling.
7. **Roles (super admin)** — role list, permission matrix, inheritance editor, custom role create/delete.
8. **Polish** — empty/loading/error states, responsive layout, e2e tests against the dev seed.

9. **Notices & complaints** — notice board, complaint list/raise/detail with timeline and status notes,
   CSV exports (visitors and complaints), dashboard cards and panels.

---

## 11. Testing Tips

- The Postman collection (`postman/SocietyManagement.postman_collection.json`) is the reference for request shapes
  and expected 403/409 cases — mirror its scenarios in e2e tests.
- Log in as each seeded role and check that nav items and buttons match that role's permissions.
- Flat scoping: Tony Stark (Penthouse) must not see or answer Stark Wing-1001 visitors; Wanda must not see Penthouse.
- Override: as Nick Fury (SECRETARY) approve a pending visitor → `overridden: true`; as Steve Rogers (COMMITTEE) the
  same action → 403.
