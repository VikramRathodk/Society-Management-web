import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  AddHelpRequest,
  AddSocietyStaffRequest,
  GateResult,
  LinkRequest,
  Staff,
  StaffAttendance,
  StaffCard,
  StaffDirectoryQuery,
  StaffEntry,
  StaffLookup,
  UpdateStaffRequest,
} from '../models';

/** Drops null/undefined/empty values so they don't reach the query string. */
function params(source: object): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value != null && value !== '') out[key] = value as string | number | boolean;
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class StaffApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api`;

  // ---- Registry ----

  directory(societyId: number, query: StaffDirectoryQuery = {}, options: { silent?: boolean } = {}) {
    return this.http.get<Staff[]>(`${this.base}/societies/${societyId}/staff`, {
      params: params(query),
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  ofFlat(flatId: number, includeEnded = false) {
    return this.http.get<Staff[]>(`${this.base}/flats/${flatId}/staff`, {
      params: includeEnded ? { includeEnded: true } : {},
    });
  }

  /** 404 when nobody has this phone; shown inline by the caller. */
  lookup(societyId: number, phone: string, flatId?: number | null) {
    return this.http.get<StaffLookup>(`${this.base}/societies/${societyId}/staff/lookup`, {
      params: params({ phone, flatId }),
      context: inlineErrors(),
    });
  }

  get(id: number) {
    return this.http.get<Staff>(`${this.base}/staff/${id}`);
  }

  card(id: number) {
    return this.http.get<StaffCard>(`${this.base}/staff/${id}/card`);
  }

  /** Image bytes; needs the auth header, so it can't be a plain <img src>. */
  photo(id: number) {
    return this.http.get(`${this.base}/staff/${id}/photo`, { responseType: 'blob', context: inlineErrors() });
  }

  idProof(id: number) {
    return this.http.get(`${this.base}/staff/${id}/id-proof`, { responseType: 'blob' });
  }

  // ---- Domestic help ----

  /** Multipart; errors are shown on the form. */
  addHelp(flatId: number, request: AddHelpRequest, photo?: File | null, idProof?: File | null) {
    const fd = new FormData();
    const append = (key: string, value: unknown) => {
      if (value != null && value !== '') fd.append(key, String(value));
    };
    append('name', request.name);
    append('phone', request.phone);
    append('staffType', request.staffType);
    append('idType', request.idType);
    append('idNumber', request.idNumber);
    append('work', request.work);
    if (request.days?.length) fd.append('days', request.days.join(','));
    append('timeFrom', request.timeFrom);
    append('timeTo', request.timeTo);
    append('notify', request.notify);
    if (photo) fd.append('photo', photo);
    if (idProof) fd.append('idProof', idProof);
    return this.http.post<Staff>(`${this.base}/flats/${flatId}/staff`, fd, { context: inlineErrors() });
  }

  link(flatId: number, staffId: number, request: LinkRequest = {}) {
    return this.http.post<Staff>(`${this.base}/flats/${flatId}/staff/${staffId}/link`, request, {
      context: inlineErrors(),
    });
  }

  updateLink(flatId: number, staffId: number, request: LinkRequest) {
    return this.http.put<Staff>(`${this.base}/flats/${flatId}/staff/${staffId}/link`, request, {
      context: inlineErrors(),
    });
  }

  endLink(flatId: number, staffId: number) {
    return this.http.post<Staff>(`${this.base}/flats/${flatId}/staff/${staffId}/link/end`, {});
  }

  // ---- Society staff and changes ----

  addSocietyStaff(societyId: number, request: AddSocietyStaffRequest) {
    return this.http.post<Staff>(`${this.base}/societies/${societyId}/staff/society`, request, {
      context: inlineErrors(),
    });
  }

  update(id: number, request: UpdateStaffRequest) {
    return this.http.put<Staff>(`${this.base}/staff/${id}`, request, { context: inlineErrors() });
  }

  setPhoto(id: number, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.put<Staff>(`${this.base}/staff/${id}/photo`, fd);
  }

  setIdProof(id: number, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.put<Staff>(`${this.base}/staff/${id}/id-proof`, fd);
  }

  // ---- Committee ----

  verify(id: number) {
    return this.http.post<Staff>(`${this.base}/staff/${id}/verify`, {});
  }

  /** 400 (blank reason) is shown in the dialog. */
  reject(id: number, reason: string) {
    return this.http.post<Staff>(`${this.base}/staff/${id}/reject`, { reason }, { context: inlineErrors() });
  }

  block(id: number, reason: string) {
    return this.http.post<Staff>(`${this.base}/staff/${id}/block`, { reason }, { context: inlineErrors() });
  }

  unblock(id: number, reason?: string | null) {
    return this.http.post<Staff>(`${this.base}/staff/${id}/unblock`, { reason: reason || null });
  }

  regenerateCode(id: number) {
    return this.http.post<Staff>(`${this.base}/staff/${id}/regenerate-code`, {});
  }

  // ---- Gate ----

  /** By the 6-digit code or QR text, or by name/phone. 400s are shown at the gate. */
  gate(societyId: number, search: { code?: string; q?: string }) {
    return this.http.get<GateResult[]>(`${this.base}/societies/${societyId}/staff/gate`, {
      params: params(search),
      context: inlineErrors(),
    });
  }

  inside(societyId: number, options: { silent?: boolean } = {}) {
    return this.http.get<GateResult[]>(`${this.base}/societies/${societyId}/staff/inside`, {
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  /** 409 carries the refusal; shown at the gate. */
  checkIn(id: number) {
    return this.http.post<GateResult>(`${this.base}/staff/${id}/check-in`, {}, { context: inlineErrors() });
  }

  checkOut(id: number) {
    return this.http.post<GateResult>(`${this.base}/staff/${id}/check-out`, {}, { context: inlineErrors() });
  }

  // ---- Log ----

  entries(societyId: number, query: { from: string; to: string; staffId?: number | null; flatId?: number | null }) {
    return this.http.get<StaffEntry[]>(`${this.base}/societies/${societyId}/staff/entries`, { params: params(query) });
  }

  /** month: "2026-11". */
  attendance(societyId: number, month: string, flatId?: number | null) {
    return this.http.get<StaffAttendance[]>(`${this.base}/societies/${societyId}/staff/attendance`, {
      params: params({ month, flatId }),
    });
  }

  exportAttendance(societyId: number, month: string, flatId?: number | null) {
    return this.http.get(`${this.base}/societies/${societyId}/staff/attendance/export`, {
      params: params({ month, flatId }),
      responseType: 'blob',
      observe: 'response',
    });
  }
}
