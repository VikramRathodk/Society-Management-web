import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  ApplicationStatus,
  ApplicationStatusView,
  GoLiveResponse,
  NewSocietyRequest,
  NewSocietyResponse,
  OnboardingChecklist,
  PlannedWing,
  ResidentImport,
  SendResult,
  SheetColumns,
  Society,
  SocietyApplication,
  SocietyApplicationRequest,
  UploadedSheet,
  WingPattern,
} from '../models';

/** Getting a society onto the platform and through its setup (backend module 7). */
@Injectable({ providedIn: 'root' })
export class OnboardingApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  private society(id: number) {
    return `${this.api}/societies/${id}`;
  }

  // ---- Platform-led ----

  /** A new society (in Setup unless startLive) with its secretary's invitation link. */
  createWithSecretary(body: NewSocietyRequest) {
    return this.http.post<NewSocietyResponse>(`${this.api}/onboarding/societies`, body, {
      context: inlineErrors(),
    });
  }

  // ---- Self-signup (public) ----

  selfSignupEnabled() {
    return this.http
      .get<{ enabled: boolean }>(`${this.api}/society-applications/public/enabled`)
      .pipe(map((r) => r.enabled));
  }

  /** Signed in, the caller's own account is used and applicant fields are ignored. */
  apply(body: SocietyApplicationRequest) {
    return this.http.post<ApplicationStatusView>(`${this.api}/society-applications/public`, body, {
      context: inlineErrors(),
    });
  }

  applicationStatus(applicationNumber: number, phone: string) {
    const params = new HttpParams().set('number', applicationNumber).set('phone', phone);
    return this.http.get<ApplicationStatusView>(`${this.api}/society-applications/public/status`, {
      params,
      context: inlineErrors(),
    });
  }

  // ---- Registrations (platform) ----

  applications(status?: ApplicationStatus | null) {
    const params = status ? new HttpParams().set('status', status) : undefined;
    return this.http.get<SocietyApplication[]>(`${this.api}/society-applications`, { params });
  }

  approve(id: number) {
    return this.http.post<SocietyApplication>(`${this.api}/society-applications/${id}/approve`, {});
  }

  reject(id: number, reason: string) {
    return this.http.post<SocietyApplication>(`${this.api}/society-applications/${id}/reject`, {
      reason,
    });
  }

  // ---- Setup checklist and profile ----

  checklist(societyId: number) {
    return this.http.get<OnboardingChecklist>(`${this.society(societyId)}/onboarding`);
  }

  /** Sends the staged residents sheet too; its links are only in this response. */
  goLive(societyId: number) {
    return this.http.post<GoLiveResponse>(`${this.society(societyId)}/go-live`, {});
  }

  /** JPEG, PNG or WebP up to 1 MB. */
  uploadLogo(societyId: number, file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.put<Society>(`${this.society(societyId)}/logo`, form);
  }

  removeLogo(societyId: number) {
    return this.http.delete<Society>(`${this.society(societyId)}/logo`);
  }

  /** The logo as a blob (it needs the auth header, so an <img src> can't load it directly). */
  logo(societyId: number) {
    return this.http.get(`${this.society(societyId)}/logo`, { responseType: 'blob' });
  }

  // ---- Wings & flats from a pattern ----

  previewStructure(societyId: number, wings: WingPattern[]) {
    return this.http.post<PlannedWing[]>(
      `${this.society(societyId)}/structure/preview`,
      { wings },
      {
        context: inlineErrors(),
      },
    );
  }

  /** Answers with the plan as it was before creating: `exists: false` is what was just made. */
  generateStructure(societyId: number, wings: WingPattern[]) {
    return this.http.post<PlannedWing[]>(
      `${this.society(societyId)}/structure/generate`,
      { wings },
      {
        context: inlineErrors(),
      },
    );
  }

  // ---- Residents from a sheet ----

  /** Replaces any unsent sheet. Without columns they are guessed from the header. */
  uploadResidents(societyId: number, file: File, columns?: SheetColumns | null) {
    const form = new FormData();
    form.append('file', file);
    let params = new HttpParams();
    if (columns) {
      params = params
        .set('flatColumn', columns.flat)
        .set('nameColumn', columns.name)
        .set('phoneColumn', columns.phone);
      if (columns.wing != null) params = params.set('wingColumn', columns.wing);
      if (columns.type != null) params = params.set('typeColumn', columns.type);
    }
    return this.http.post<UploadedSheet>(`${this.society(societyId)}/resident-imports`, form, {
      params,
      context: inlineErrors(),
    });
  }

  /** The unsent sheet, checked again; null when there is none (204). */
  currentResidents(societyId: number) {
    return this.http.get<ResidentImport | null>(
      `${this.society(societyId)}/resident-imports/current`,
    );
  }

  removeResidentRow(societyId: number, rowId: number) {
    return this.http.delete<ResidentImport>(
      `${this.society(societyId)}/resident-imports/current/rows/${rowId}`,
    );
  }

  discardResidents(societyId: number) {
    return this.http.delete<void>(`${this.society(societyId)}/resident-imports/current`);
  }

  /** Live societies only; in Setup the sheet goes out at go-live. */
  sendResidents(societyId: number) {
    return this.http.post<SendResult>(
      `${this.society(societyId)}/resident-imports/current/send`,
      {},
    );
  }
}
