import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  Access,
  AssignRoleRequest,
  CreateUserRequest,
  MeResponse,
  RoleAssignment,
  UpdateProfileRequest,
  User,
} from '../models';

@Injectable({ providedIn: 'root' })
export class UserApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/users`;

  me() {
    return this.http.get<MeResponse>(`${this.baseUrl}/me`);
  }

  /** Omit `societyId` for every user the caller can see. */
  list(societyId?: number | null) {
    const params: Record<string, number> = societyId != null ? { societyId } : {};
    return this.http.get<User[]>(this.baseUrl, { params });
  }

  get(id: number) {
    return this.http.get<User>(`${this.baseUrl}/${id}`);
  }

  /** Errors (duplicate phone, rank too low, ...) are shown on the form, not as a snackbar. */
  create(body: CreateUserRequest) {
    return this.http.post<User>(this.baseUrl, body, { context: inlineErrors() });
  }

  update(id: number, body: UpdateProfileRequest) {
    return this.http.patch<unknown>(`${this.baseUrl}/${id}`, body);
  }

  deactivate(id: number) {
    return this.http.patch<unknown>(`${this.baseUrl}/${id}/deactivate`, {});
  }

  activate(id: number) {
    return this.http.patch<unknown>(`${this.baseUrl}/${id}/activate`, {});
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  roles(id: number) {
    return this.http.get<RoleAssignment[]>(`${this.baseUrl}/${id}/roles`);
  }

  permissions(id: number) {
    return this.http.get<Access>(`${this.baseUrl}/${id}/permissions`);
  }

  /** Errors are shown in the assign dialog, not as a snackbar. */
  assignRole(id: number, body: AssignRoleRequest) {
    return this.http.post<RoleAssignment>(`${this.baseUrl}/${id}/roles`, body, {
      context: inlineErrors(),
    });
  }

  removeRole(id: number, assignmentId: number) {
    return this.http.delete<void>(`${this.baseUrl}/${id}/roles/${assignmentId}`);
  }
}
