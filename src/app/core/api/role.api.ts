import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { AssignableRole } from '../models';

@Injectable({ providedIn: 'root' })
export class RoleApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/roles`;

  /** Roles the caller may hand out — in that society, or platform roles when `societyId` is omitted. */
  assignable(societyId?: number | null) {
    const params: Record<string, number> = societyId != null ? { societyId } : {};
    return this.http.get<AssignableRole[]>(`${this.baseUrl}/assignable`, { params });
  }
}
