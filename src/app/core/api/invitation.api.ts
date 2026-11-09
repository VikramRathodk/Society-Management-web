import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  AcceptInvitationRequest,
  AssignableRole,
  CreateInvitationRequest,
  Invitation,
  InvitationPreview,
  InvitationStatus,
  IssuedInvitation,
} from '../models';

@Injectable({ providedIn: 'root' })
export class InvitationApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api`;

  /** Roles the caller may invite people to in this society. */
  roles(societyId: number) {
    return this.http.get<AssignableRole[]>(`${this.base}/societies/${societyId}/invitations/roles`);
  }

  create(societyId: number, body: CreateInvitationRequest) {
    // The invite dialog shows every error inline.
    return this.http.post<IssuedInvitation>(
      `${this.base}/societies/${societyId}/invitations`,
      body,
      {
        context: inlineErrors(),
      },
    );
  }

  list(
    societyId: number,
    filter: { status?: InvitationStatus; page?: number; size?: number } = {},
  ) {
    let params = new HttpParams();
    if (filter.status) params = params.set('status', filter.status);
    if (filter.page != null) params = params.set('page', filter.page);
    if (filter.size != null) params = params.set('size', filter.size);
    return this.http.get<Invitation[]>(`${this.base}/societies/${societyId}/invitations`, {
      params,
    });
  }

  /** A new link and QR code; the old link stops working. */
  resend(id: number) {
    return this.http.post<IssuedInvitation>(`${this.base}/invitations/${id}/resend`, null);
  }

  revoke(id: number) {
    return this.http.post<Invitation>(`${this.base}/invitations/${id}/revoke`, null);
  }

  /** Open invitations sent to the signed-in user's phone number. */
  mine() {
    return this.http.get<Invitation[]>(`${this.base}/invitations/mine`, {
      context: inlineErrors(),
    });
  }

  acceptMine(id: number) {
    return this.http.post<Invitation>(`${this.base}/invitations/${id}/accept`, null);
  }

  declineMine(id: number) {
    return this.http.post<Invitation>(`${this.base}/invitations/${id}/decline`, null);
  }

  // The link endpoints are public; their pages show every error inline.

  preview(token: string) {
    return this.http.get<InvitationPreview>(
      `${this.base}/invitations/token/${encodeURIComponent(token)}`,
      {
        context: inlineErrors(),
      },
    );
  }

  accept(token: string, body: AcceptInvitationRequest = {}) {
    return this.http.post<Invitation>(
      `${this.base}/invitations/token/${encodeURIComponent(token)}/accept`,
      body,
      { context: inlineErrors() },
    );
  }

  decline(token: string) {
    return this.http.post<Invitation>(
      `${this.base}/invitations/token/${encodeURIComponent(token)}/decline`,
      null,
      { context: inlineErrors() },
    );
  }
}
