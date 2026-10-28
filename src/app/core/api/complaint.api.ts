import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  Complaint,
  ComplaintActivity,
  ComplaintCategory,
  ComplaintStatus,
  RaiseComplaintRequest,
  UpdateComplaintRequest,
} from '../models';

export interface ComplaintQuery {
  societyId: number;
  status?: ComplaintStatus | null;
  category?: ComplaintCategory | null;
  flatId?: number | null;
  page?: number;
  /** Max 100. */
  size?: number;
}

/** The status-change endpoints, by the status they lead to. */
export type ComplaintMove = 'start' | 'resolve' | 'close' | 'reopen';

@Injectable({ providedIn: 'root' })
export class ComplaintApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/complaints`;

  /** Errors are shown on the form. */
  raise(complaint: RaiseComplaintRequest) {
    return this.http.post<Complaint>(this.baseUrl, complaint, { context: inlineErrors() });
  }

  /** Newest first; a plain page with no total count. Residents only get their own flat(s). */
  list(query: ComplaintQuery, options: { silent?: boolean } = {}) {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value != null) params[key] = value;
    }
    return this.http.get<Complaint[]>(this.baseUrl, {
      params,
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  get(id: number) {
    return this.http.get<Complaint>(`${this.baseUrl}/${id}`);
  }

  /** The timeline, oldest first. */
  activity(id: number) {
    return this.http.get<ComplaintActivity[]>(`${this.baseUrl}/${id}/activity`);
  }

  /** Author only, while OPEN or IN_PROGRESS. Errors are shown in the dialog. */
  update(id: number, changes: UpdateComplaintRequest) {
    return this.http.patch<Complaint>(`${this.baseUrl}/${id}`, changes, {
      context: inlineErrors(),
    });
  }

  /** Author only, while OPEN or IN_PROGRESS. Removes the complaint and its timeline. */
  withdraw(id: number) {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  /** The note is optional and kept in the timeline. Errors (e.g. 409) are shown in the dialog. */
  move(id: number, move: ComplaintMove, note?: string) {
    return this.http.post<Complaint>(`${this.baseUrl}/${id}/${move}`, note ? { note } : null, {
      context: inlineErrors(),
    });
  }

  /** CSV of complaints raised between two ISO dates (inclusive). Errors are shown in the dialog. */
  export(societyId: number, from: string, to: string) {
    return this.http.get(`${this.baseUrl}/export`, {
      params: { societyId, from, to },
      responseType: 'blob',
      observe: 'response',
      context: inlineErrors(),
    });
  }
}
