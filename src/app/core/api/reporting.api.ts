import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  ComplaintStats,
  DashboardCounts,
  FinanceStats,
  MaintenanceStats,
  ParkingStats,
  StaffStats,
  VisitorStats,
} from '../models';

/**
 * The dashboard's counts and the Stats page's series. Every call is silent: a section the user may not
 * see (403) or the plan leaves out (402) just hides, it doesn't raise an error banner.
 */
@Injectable({ providedIn: 'root' })
export class ReportingApi {
  private readonly http = inject(HttpClient);
  private readonly base = (societyId: number) => `${environment.apiBaseUrl}/api/societies/${societyId}`;

  dashboard(societyId: number) {
    return this.http.get<DashboardCounts>(`${this.base(societyId)}/dashboard`, { context: inlineErrors() });
  }

  /** 1–24 months ending this month. */
  maintenance(societyId: number, months = 12) {
    return this.stats<MaintenanceStats>(societyId, 'maintenance', { months });
  }

  finance(societyId: number, months = 12) {
    return this.stats<FinanceStats>(societyId, 'finance', { months });
  }

  complaints(societyId: number, months = 12) {
    return this.stats<ComplaintStats>(societyId, 'complaints', { months });
  }

  /** 7–90 days ending today. */
  visitors(societyId: number, days = 30) {
    return this.stats<VisitorStats>(societyId, 'visitors', { days });
  }

  staff(societyId: number, days = 30) {
    return this.stats<StaffStats>(societyId, 'staff', { days });
  }

  parking(societyId: number) {
    return this.stats<ParkingStats>(societyId, 'parking', {});
  }

  private stats<T>(societyId: number, path: string, params: Record<string, number>) {
    return this.http.get<T>(`${this.base(societyId)}/stats/${path}`, { params, context: inlineErrors() });
  }
}
