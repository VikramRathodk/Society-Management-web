import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import {
  Complex,
  CreateSocietyRequest,
  Society,
  SocietySettingChanges,
  SocietySettings,
  UpdateSocietyRequest,
} from '../models';

@Injectable({ providedIn: 'root' })
export class SocietyApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/societies`;

  list() {
    return this.http.get<Society[]>(this.baseUrl);
  }

  get(id: number) {
    return this.http.get<Society>(`${this.baseUrl}/${id}`);
  }

  create(body: CreateSocietyRequest) {
    return this.http.post<Society>(this.baseUrl, body);
  }

  update(id: number, body: UpdateSocietyRequest) {
    return this.http.patch<Society>(`${this.baseUrl}/${id}`, body);
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  /** The society's configurable rules, grouped in page order. */
  settings(id: number) {
    return this.http.get<SocietySettings>(`${this.baseUrl}/${id}/settings`);
  }

  /** Changes only the given keys and returns every setting again. */
  updateSettings(id: number, changes: SocietySettingChanges) {
    return this.http.patch<SocietySettings>(`${this.baseUrl}/${id}/settings`, changes);
  }

  complexes() {
    return this.http.get<Complex[]>(`${environment.apiBaseUrl}/api/complexes`);
  }
}
