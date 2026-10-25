import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import { AssignableRole, CreateRoleRequest, Permission, Role } from '../models';

@Injectable({ providedIn: 'root' })
export class RoleApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/roles`;

  /** Roles the caller may hand out — in that society, or platform roles when `societyId` is omitted. */
  assignable(societyId?: number | null) {
    const params: Record<string, number> = societyId != null ? { societyId } : {};
    return this.http.get<AssignableRole[]>(`${this.baseUrl}/assignable`, { params });
  }

  list() {
    return this.http.get<Role[]>(this.baseUrl);
  }

  get(code: string) {
    return this.http.get<Role>(`${this.baseUrl}/${encodeURIComponent(code)}`);
  }

  permissions() {
    return this.http.get<Permission[]>(`${environment.apiBaseUrl}/api/permissions`);
  }

  /** Errors (bad or duplicate code, ...) are shown on the form, not as a snackbar. */
  create(body: CreateRoleRequest) {
    return this.http.post<Role>(this.baseUrl, body, { context: inlineErrors() });
  }

  update(code: string, body: { name?: string; description?: string }) {
    return this.http.patch<Role>(`${this.baseUrl}/${encodeURIComponent(code)}`, body);
  }

  setPermissions(code: string, permissions: string[]) {
    return this.http.put<Role>(`${this.baseUrl}/${encodeURIComponent(code)}/permissions`, {
      permissions,
    });
  }

  setInherits(code: string, inherits: string[]) {
    return this.http.put<Role>(`${this.baseUrl}/${encodeURIComponent(code)}/inherits`, {
      inherits,
    });
  }

  delete(code: string) {
    return this.http.delete<void>(`${this.baseUrl}/${encodeURIComponent(code)}`);
  }
}
