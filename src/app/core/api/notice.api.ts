import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import { CreateNoticeRequest, Notice, UpdateNoticeRequest } from '../models';

@Injectable({ providedIn: 'root' })
export class NoticeApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api`;

  /** The society's notice board, newest first; a plain page (max 100) with no total count. */
  list(societyId: number, page = 0, size = 20, options: { silent?: boolean } = {}) {
    return this.http.get<Notice[]>(`${this.baseUrl}/societies/${societyId}/notices`, {
      params: { page, size },
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  get(id: number) {
    return this.http.get<Notice>(`${this.baseUrl}/notices/${id}`);
  }

  /** Errors are shown in the dialog. */
  create(societyId: number, notice: CreateNoticeRequest) {
    return this.http.post<Notice>(`${this.baseUrl}/societies/${societyId}/notices`, notice, {
      context: inlineErrors(),
    });
  }

  /** Errors are shown in the dialog. */
  update(id: number, changes: UpdateNoticeRequest) {
    return this.http.patch<Notice>(`${this.baseUrl}/notices/${id}`, changes, {
      context: inlineErrors(),
    });
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.baseUrl}/notices/${id}`);
  }
}
