import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { Complex, CreateSocietyRequest, Society, UpdateSocietyRequest } from '../models';

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

  complexes() {
    return this.http.get<Complex[]>(`${environment.apiBaseUrl}/api/complexes`);
  }
}
