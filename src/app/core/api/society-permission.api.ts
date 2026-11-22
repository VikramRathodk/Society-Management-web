import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  MemberPermissions,
  PermissionCatalogEntry,
  PermissionChange,
  PermissionHistoryEntry,
  PermissionHistoryQuery,
  PermissionPreset,
  RolePermissions,
  SavePresetRequest,
} from '../models';

/** What roles and people may do in one society, the society's presets, and the history of changes. */
@Injectable({ providedIn: 'root' })
export class SocietyPermissionApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  catalog(societyId: number) {
    return this.http.get<PermissionCatalogEntry[]>(
      `${this.api}/societies/${societyId}/permissions/catalog`,
    );
  }

  // ---- Roles ----

  roles(societyId: number) {
    return this.http.get<RolePermissions[]>(`${this.api}/societies/${societyId}/roles/permissions`);
  }

  saveRole(societyId: number, role: string, change: PermissionChange) {
    return this.http.put<RolePermissions>(this.rolePath(societyId, role), change);
  }

  resetRole(societyId: number, role: string, reason?: string | null) {
    return this.http.post<RolePermissions>(`${this.rolePath(societyId, role)}/reset`, {
      reason: reason || null,
    });
  }

  // ---- People ----

  member(societyId: number, userId: number) {
    return this.http.get<MemberPermissions>(this.memberPath(societyId, userId));
  }

  saveMember(societyId: number, userId: number, change: PermissionChange) {
    return this.http.put<MemberPermissions>(this.memberPath(societyId, userId), change);
  }

  resetMember(societyId: number, userId: number, reason?: string | null) {
    return this.http.post<MemberPermissions>(`${this.memberPath(societyId, userId)}/reset`, {
      reason: reason || null,
    });
  }

  copyFrom(societyId: number, userId: number, otherUserId: number) {
    return this.http.post<MemberPermissions>(
      `${this.memberPath(societyId, userId)}/copy-from/${otherUserId}`,
      {},
    );
  }

  applyPreset(societyId: number, userId: number, presetId: number) {
    return this.http.post<MemberPermissions>(
      `${this.memberPath(societyId, userId)}/apply-preset/${presetId}`,
      {},
    );
  }

  // ---- Presets ----

  presets(societyId: number) {
    return this.http.get<PermissionPreset[]>(
      `${this.api}/societies/${societyId}/permission-presets`,
    );
  }

  /** Errors (duplicate name, ...) are shown in the dialog. */
  createPreset(societyId: number, body: SavePresetRequest) {
    return this.http.post<PermissionPreset>(
      `${this.api}/societies/${societyId}/permission-presets`,
      body,
      { context: inlineErrors() },
    );
  }

  /** Errors are shown in the dialog. */
  updatePreset(id: number, body: SavePresetRequest) {
    return this.http.put<PermissionPreset>(`${this.api}/permission-presets/${id}`, body, {
      context: inlineErrors(),
    });
  }

  deletePreset(id: number) {
    return this.http.delete<void>(`${this.api}/permission-presets/${id}`);
  }

  // ---- History ----

  history(societyId: number, query: PermissionHistoryQuery = {}) {
    return this.http.get<PermissionHistoryEntry[]>(
      `${this.api}/societies/${societyId}/permissions/history`,
      { params: historyParams(query) },
    );
  }

  /** CSV of the same lines. */
  exportHistory(societyId: number, query: PermissionHistoryQuery = {}) {
    return this.http.get(`${this.api}/societies/${societyId}/permissions/history/export`, {
      params: historyParams(query),
      responseType: 'blob',
      observe: 'response',
    });
  }

  private rolePath(societyId: number, role: string) {
    return `${this.api}/societies/${societyId}/roles/${encodeURIComponent(role)}/permissions`;
  }

  private memberPath(societyId: number, userId: number) {
    return `${this.api}/societies/${societyId}/members/${userId}/permissions`;
  }
}

function historyParams(query: PermissionHistoryQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (query.userId != null) params['userId'] = query.userId;
  if (query.role) params['role'] = query.role;
  if (query.from) params['from'] = query.from;
  if (query.to) params['to'] = query.to;
  return params;
}
