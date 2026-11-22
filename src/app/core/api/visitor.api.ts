import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import { LogVisitorRequest, Visitor, VisitorStatus } from '../models';

export interface VisitorQuery {
  societyId?: number | null;
  status?: VisitorStatus | null;
  flatId?: number | null;
  page?: number;
  /** Max 100. */
  size?: number;
}

@Injectable({ providedIn: 'root' })
export class VisitorApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/visitors`;

  /** Multipart; errors (validation, 413 too large) are shown on the form. */
  log(visitor: LogVisitorRequest, photo?: File | null) {
    const fd = new FormData();
    fd.append('flatId', String(visitor.flatId));
    fd.append('visitorName', visitor.visitorName);
    if (visitor.visitorPhone) fd.append('visitorPhone', visitor.visitorPhone);
    if (visitor.purpose) fd.append('purpose', visitor.purpose);
    if (visitor.vehicleNumber) fd.append('vehicleNumber', visitor.vehicleNumber);
    if (photo) fd.append('photo', photo);
    // No Content-Type header: the browser adds the multipart boundary.
    return this.http.post<Visitor>(this.baseUrl, fd, { context: inlineErrors() });
  }

  /**
   * Newest first; a plain page with no total count. `silent` skips the error snackbar,
   * for background polling.
   */
  list(query: VisitorQuery, options: { silent?: boolean } = {}) {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value != null) params[key] = value;
    }
    return this.http.get<Visitor[]>(this.baseUrl, {
      params,
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  get(id: number) {
    return this.http.get<Visitor>(`${this.baseUrl}/${id}`);
  }

  /** Image bytes; needs the auth header, so it can't be a plain <img src>. */
  photo(id: number) {
    return this.http.get(`${this.baseUrl}/${id}/photo`, {
      responseType: 'blob',
      context: inlineErrors(),
    });
  }

  approve(id: number) {
    return this.http.post<unknown>(`${this.baseUrl}/${id}/approve`, {});
  }

  reject(id: number) {
    return this.http.post<unknown>(`${this.baseUrl}/${id}/reject`, {});
  }

  enter(id: number) {
    return this.http.post<unknown>(`${this.baseUrl}/${id}/enter`, {});
  }

  exit(id: number) {
    return this.http.post<unknown>(`${this.baseUrl}/${id}/exit`, {});
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  /** CSV of the gate log between two ISO dates (inclusive). Errors are shown in the dialog. */
  export(societyId: number, from: string, to: string) {
    return this.http.get(`${this.baseUrl}/export`, {
      params: { societyId, from, to },
      responseType: 'blob',
      observe: 'response',
      context: inlineErrors(),
    });
  }
}
