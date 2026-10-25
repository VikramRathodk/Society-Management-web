import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { Flat, Wing } from '../models';

@Injectable({ providedIn: 'root' })
export class StructureApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api`;

  wings(societyId: number) {
    return this.http.get<Wing[]>(`${this.baseUrl}/societies/${societyId}/wings`);
  }

  createWing(societyId: number, name: string) {
    return this.http.post<Wing>(`${this.baseUrl}/societies/${societyId}/wings`, { name });
  }

  getWing(id: number) {
    return this.http.get<Wing>(`${this.baseUrl}/wings/${id}`);
  }

  updateWing(id: number, name: string) {
    return this.http.patch<Wing>(`${this.baseUrl}/wings/${id}`, { name });
  }

  deleteWing(id: number) {
    return this.http.delete<void>(`${this.baseUrl}/wings/${id}`);
  }

  flats(wingId: number) {
    return this.http.get<Flat[]>(`${this.baseUrl}/wings/${wingId}/flats`);
  }

  createFlat(wingId: number, flatNumber: string) {
    return this.http.post<Flat>(`${this.baseUrl}/wings/${wingId}/flats`, { flatNumber });
  }

  getFlat(id: number) {
    return this.http.get<Flat>(`${this.baseUrl}/flats/${id}`);
  }

  updateFlat(id: number, flatNumber: string) {
    return this.http.patch<Flat>(`${this.baseUrl}/flats/${id}`, { flatNumber });
  }

  deleteFlat(id: number) {
    return this.http.delete<void>(`${this.baseUrl}/flats/${id}`);
  }
}
