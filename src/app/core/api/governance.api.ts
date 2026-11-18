import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  AttendanceSheet,
  Meeting,
  MeetingKind,
  MeetingRequest,
  MeetingView,
  Minutes,
  Outcome,
  Resolution,
  RsvpList,
  RsvpResponse,
  VoteChoice,
} from '../models';

/** Meetings, their agendas, notices, attendance, e-voting, resolutions and minutes. */
@Injectable({ providedIn: 'root' })
export class GovernanceApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  // ---- Meetings ----

  list(
    societyId: number,
    view: MeetingView = 'upcoming',
    kind: MeetingKind | null = null,
    options: { silent?: boolean } = {},
  ) {
    const params: Record<string, string> = { view };
    if (kind) params['kind'] = kind;
    return this.http.get<Meeting[]>(`${this.api}/societies/${societyId}/meetings`, {
      params,
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  /** Inline errors: the page shows "not found" itself. */
  get(id: number) {
    return this.http.get<Meeting>(`${this.api}/meetings/${id}`, { context: inlineErrors() });
  }

  /** Errors are shown in the form. */
  create(societyId: number, request: MeetingRequest) {
    return this.http.post<Meeting>(`${this.api}/societies/${societyId}/meetings`, request, {
      context: inlineErrors(),
    });
  }

  /** Replaces a draft whole. Errors are shown in the form. */
  update(id: number, request: MeetingRequest) {
    return this.http.put<Meeting>(`${this.api}/meetings/${id}`, request, {
      context: inlineErrors(),
    });
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.api}/meetings/${id}`);
  }

  /** Errors are shown in the dialog (a short notice needs a reason). */
  sendNotice(id: number, shortNoticeReason: string | null = null) {
    return this.http.post<Meeting>(
      `${this.api}/meetings/${id}/send-notice`,
      { shortNoticeReason },
      { context: inlineErrors() },
    );
  }

  /** Errors are shown in the dialog. */
  cancel(id: number, reason: string) {
    return this.http.post<Meeting>(
      `${this.api}/meetings/${id}/cancel`,
      { reason },
      { context: inlineErrors() },
    );
  }

  /** Answers the new meeting. Errors are shown in the dialog. */
  adjourn(
    id: number,
    request: {
      scheduledAt: string;
      place?: string | null;
      onlineLink?: string | null;
      reason: string;
    },
  ) {
    return this.http.post<Meeting>(`${this.api}/meetings/${id}/adjourn`, request, {
      context: inlineErrors(),
    });
  }

  rsvp(id: number, response: RsvpResponse) {
    return this.http.put<Meeting>(`${this.api}/meetings/${id}/rsvp`, { response });
  }

  rsvps(id: number) {
    return this.http.get<RsvpList>(`${this.api}/meetings/${id}/rsvps`);
  }

  // ---- Running the meeting ----

  attendance(id: number) {
    return this.http.get<AttendanceSheet>(`${this.api}/meetings/${id}/attendance`);
  }

  setAttendance(id: number, userIds: number[]) {
    return this.http.put<AttendanceSheet>(`${this.api}/meetings/${id}/attendance`, { userIds });
  }

  hold(id: number, chairpersonId: number | null = null) {
    return this.http.post<Meeting>(`${this.api}/meetings/${id}/hold`, { chairpersonId });
  }

  /** Errors are shown in the dialog. */
  openVoting(itemId: number, proposedBy: number | null = null, secondedBy: number | null = null) {
    return this.http.post<Meeting>(
      `${this.api}/agenda-items/${itemId}/open-voting`,
      { proposedBy, secondedBy },
      { context: inlineErrors() },
    );
  }

  closeVoting(itemId: number) {
    return this.http.post<Meeting>(`${this.api}/agenda-items/${itemId}/close-voting`, null);
  }

  defer(itemId: number) {
    return this.http.post<Meeting>(`${this.api}/agenda-items/${itemId}/defer`, null);
  }

  /** Final once cast. Errors are shown in the dialog. */
  vote(itemId: number, choice: VoteChoice, flatId: number | null = null) {
    return this.http.post<Meeting>(
      `${this.api}/agenda-items/${itemId}/vote`,
      { choice, flatId },
      { context: inlineErrors() },
    );
  }

  resolutions(societyId: number, q: string | null = null, outcome: Outcome | 'all' = 'PASSED') {
    const params: Record<string, string> = { outcome: outcome.toLowerCase() };
    if (q?.trim()) params['q'] = q.trim();
    return this.http.get<Resolution[]>(`${this.api}/societies/${societyId}/resolutions`, {
      params,
    });
  }

  // ---- Minutes ----

  /** Inline errors: a meeting without minutes (yet) answers 404. */
  minutes(meetingId: number) {
    return this.http.get<Minutes>(`${this.api}/meetings/${meetingId}/minutes`, {
      context: inlineErrors(),
    });
  }

  /** Errors are shown in the editor. */
  saveMinutes(meetingId: number, body: string) {
    return this.http.put<Minutes>(
      `${this.api}/meetings/${meetingId}/minutes`,
      { body },
      { context: inlineErrors() },
    );
  }

  /** Errors are shown in the editor. */
  setMinutesAttachment(meetingId: number, file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.put<Minutes>(`${this.api}/meetings/${meetingId}/minutes/attachment`, form, {
      context: inlineErrors(),
    });
  }

  removeMinutesAttachment(meetingId: number) {
    return this.http.delete<Minutes>(`${this.api}/meetings/${meetingId}/minutes/attachment`);
  }

  minutesAttachment(meetingId: number) {
    return this.http.get(`${this.api}/meetings/${meetingId}/minutes/attachment`, {
      responseType: 'blob',
    });
  }

  submitMinutes(meetingId: number) {
    return this.http.post<Minutes>(`${this.api}/meetings/${meetingId}/minutes/submit`, null);
  }

  /** Errors are shown in the dialog. */
  sendBackMinutes(meetingId: number, reason: string) {
    return this.http.post<Minutes>(
      `${this.api}/meetings/${meetingId}/minutes/send-back`,
      { reason },
      { context: inlineErrors() },
    );
  }

  approveMinutes(meetingId: number) {
    return this.http.post<Minutes>(`${this.api}/meetings/${meetingId}/minutes/approve`, null);
  }

  /** Errors are shown in the dialog. */
  addAddendum(meetingId: number, text: string) {
    return this.http.post<Minutes>(
      `${this.api}/meetings/${meetingId}/minutes/addenda`,
      { text },
      { context: inlineErrors() },
    );
  }

  announceMinutes(meetingId: number) {
    return this.http.post<Minutes>(`${this.api}/meetings/${meetingId}/minutes/announce`, null);
  }
}
