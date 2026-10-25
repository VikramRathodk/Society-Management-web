import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';

import { AuthApi } from '../api/auth.api';
import { UserApi } from '../api/user.api';
import { Access, LoginRequest, MeResponse, User } from '../models';

const TOKEN_KEY = 'sm.token';

/** Holds the JWT, the current user and their resolved access. UI checks only — the backend enforces. */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly authApi = inject(AuthApi);
  private readonly userApi = inject(UserApi);

  private readonly _token = signal<string | null>(readToken());
  private readonly _user = signal<User | null>(null);
  private readonly _access = signal<Access | null>(null);

  readonly token = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly access = this._access.asReadonly();
  readonly isAuthenticated = computed(() => this._token() !== null);

  login(credentials: LoginRequest): Observable<void> {
    return this.authApi.login(credentials).pipe(
      tap((res) => {
        this.setToken(res.token);
        this._access.set(res.access);
      }),
      // The login response has no phone/email, so load the full profile before continuing.
      switchMap(() => this.userApi.me()),
      map((me) => this.applyMe(me)),
    );
  }

  /** Refreshes user + access on app start; permissions can change server-side without a new token. */
  restore(): Observable<void> {
    if (!this._token()) return of(undefined);
    return this.userApi.me().pipe(
      map((me) => this.applyMe(me)),
      catchError(() => {
        this.logout();
        return of(undefined);
      }),
    );
  }

  logout(): void {
    this.setToken(null);
    this._user.set(null);
    this._access.set(null);
  }

  can(permission: string, societyId?: number | null): boolean {
    const a = this._access();
    if (!a) return false;
    if (a.platformPermissions.includes(permission)) return true;
    if (societyId == null) return a.societies.some((s) => s.permissions.includes(permission));
    return (
      a.societies.find((s) => s.societyId === societyId)?.permissions.includes(permission) ?? false
    );
  }

  canOnPlatform(permission: string): boolean {
    return this._access()?.platformPermissions.includes(permission) ?? false;
  }

  private applyMe(me: MeResponse): void {
    this._user.set(me.user);
    this._access.set(me.access);
  }

  private setToken(token: string | null): void {
    this._token.set(token);
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage unavailable (e.g. private mode) — the session just won't survive a reload.
    }
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
