import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Observable, catchError, combineLatest, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { ComplaintApi } from '../../core/api/complaint.api';
import { ReportingApi } from '../../core/api/reporting.api';
import { MaintenanceApi } from '../../core/api/maintenance.api';
import { FinanceSummaryCard } from '../finance/finance-summary-card';
import { NoticeApi } from '../../core/api/notice.api';
import { PolicyApi } from '../../core/api/policy.api';
import { GovernanceApi } from '../../core/api/governance.api';
import { SubscriptionAccessStore } from '../../core/subscription/subscription-access.store';
import { VisitorApi } from '../../core/api/visitor.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import {
  Complaint,
  DashboardCounts,
  FlatDues,
  Notice,
  Meeting,
  PolicySummary,
  Visitor,
  VisitorStatus,
} from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { Section, Skeleton, StatCard, Tone } from '../../shared/ui';
import { ComplaintRow } from '../complaints/complaint-ui';
import { MaintenanceAccess } from '../maintenance/maintenance-ui';
import { GateBoard } from '../visitors/gate-board';
import { VisitorActions, VisitorPhotos, VisitorRow, timeAgo } from '../visitors/visitor-ui';
import { DuesSpotlight, MoneyGlance, rupees } from './dashboard-ui';
import { DashboardTrends } from './dashboard-trends';
import { canOpenMeetings } from '../governance/governance-ui';

/** Which home screen fits what the user can do (roles are configurable, so this goes by permissions). */
export type Persona = 'committee' | 'gate' | 'resident';

/** Lists are paged at 100; the cards' numbers come from the dashboard endpoint, which counts exactly. */
const MAX = 100;
/** Latest visitors shown on the recent panel. */
const RECENT = 6;
/** Latest notices shown on the board panel. */
const NOTICES = 3;

/** Per item: undefined = not loaded yet (or not permitted), null = failed. */
interface DashboardData {
  /** Exact counts for the cards (GET /societies/{id}/dashboard); a null part is one the user may not see. */
  counts?: DashboardCounts | null;
  pending?: Visitor[] | null;
  recent?: Visitor[] | null;
  openComplaints?: Complaint[] | null;
  notices?: Notice[] | null;
  /** Only for residents (the dues spotlight); the committee's dues card uses counts. */
  dues?: FlatDues[] | null;
  policiesToAccept?: PolicySummary[] | null;
  meetings?: Meeting[] | null;
  heldMeetings?: Meeting[] | null;
}

interface Card {
  label: string;
  icon: string;
  value: string | null;
  link: string;
  queryParams?: Record<string, string>;
  tone: Tone;
}

/** Overview built from the user's permissions in the selected society. */
@Component({
  selector: 'app-dashboard',
  imports: [
    DatePipe,
    Skeleton,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    HasPermission,
    Section,
    StatCard,
    VisitorRow,
    ComplaintRow,
    FinanceSummaryCard,
    GateBoard,
    MoneyGlance,
    DuesSpotlight,
    DashboardTrends,
  ],
  providers: [VisitorPhotos],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly visitorApi = inject(VisitorApi);
  private readonly reportingApi = inject(ReportingApi);
  private readonly plan = inject(SubscriptionAccessStore);
  /** A parking permission in a society whose plan includes parking. */
  private readonly parking = (permission: string) =>
    this.plan.allows('PARKING') && this.ctx.selectedSocietyId() != null && this.can(permission);
  private readonly complaintApi = inject(ComplaintApi);
  private readonly noticeApi = inject(NoticeApi);
  private readonly policyApi = inject(PolicyApi);
  private readonly governanceApi = inject(GovernanceApi);
  private readonly maintenanceApi = inject(MaintenanceApi);
  private readonly maintenance = inject(MaintenanceAccess);
  protected readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly today = new Date();
  protected readonly greeting = greetingFor(this.today);
  protected readonly firstName = computed(() => this.auth.user()?.name.split(' ')[0] ?? '');

  private readonly can = (permission: string) =>
    this.auth.can(permission, this.ctx.selectedSocietyId());
  protected readonly canViewVisitors = computed(() => this.can('VISITOR.ENTRY.VIEW'));
  protected readonly canViewComplaints = computed(
    () => this.can('COMPLAINT.TICKET.VIEW') && this.ctx.selectedSocietyId() != null,
  );
  protected readonly canViewNotices = computed(
    () => this.can('NOTICE.POST.VIEW') && this.ctx.selectedSocietyId() != null,
  );
  protected readonly canViewDues = computed(
    () => this.can('MAINTENANCE.BILL.VIEW') && this.ctx.selectedSocietyId() != null,
  );
  /** Residents (no Finance section) see the society's monthly summary when it is shared. */
  protected readonly showFinanceSummary = computed(
    () =>
      this.ctx.selectedSocietyId() != null &&
      this.can('FINANCE.SUMMARY.VIEW') &&
      !this.can('FINANCE.ACCOUNT.VIEW'),
  );
  protected readonly timeAgo = timeAgo;
  protected readonly actions = inject(VisitorActions);

  /**
   * Runs the society: issues bills, records payments, reads the books or manages users. Merely
   * seeing every flat's bills isn't enough (gate staff may have that to answer "has 1001 paid?").
   */
  private readonly committee = computed(
    () =>
      this.maintenance.canIssue() ||
      this.maintenance.canRecord() ||
      this.can('FINANCE.REPORT.VIEW') ||
      this.can('USER.ACCOUNT.VIEW'),
  );
  /** Holds a society role without a flat, i.e. works here (guard, manager) rather than only lives here. */
  private readonly hasStaffRole = computed(() =>
    (this.auth.user()?.roles ?? []).some(
      (r) => r.societyId === this.ctx.selectedSocietyId() && r.flatId == null,
    ),
  );
  /**
   * committee – the full overview with money at a glance.
   * gate      – staff who log and let in visitors and run nothing else: the gate board (a guard
   *             who also lives here still gets it; their own dues are under Maintenance).
   * resident  – everyone else: their dues, their visitors, notices and complaints.
   */
  protected readonly persona = computed<Persona>(() => {
    if (this.committee()) return 'committee';
    if (
      this.hasStaffRole() &&
      this.can('VISITOR.ENTRY.CREATE') &&
      this.can('VISITOR.ENTRY.UPDATE')
    ) {
      return 'gate';
    }
    return 'resident';
  });
  protected readonly canOpenGate = computed(() => this.can('VISITOR.ENTRY.UPDATE'));
  protected readonly showMoney = computed(
    () => this.can('FINANCE.REPORT.VIEW') || this.maintenance.canIssue(),
  );
  /** The visitor lists failed: say so rather than "nobody is waiting". */
  protected readonly visitorsFailed = computed(() => this.data().pending === null);
  /** Dues for the resident's own flat(s); null when they failed to load. */
  protected readonly myDues = computed(() => this.data().dues);
  protected readonly busy = signal<ReadonlySet<number>>(new Set());
  private readonly attempt = signal(0);

  protected readonly data = signal<DashboardData>({});
  protected readonly loading = signal(true);

  protected readonly cards = computed<Card[]>(() => {
    const d = this.data();
    const c = d.counts;
    const loading = this.loading();
    const value = (n: number | null | undefined) => (loading ? null : display(n));
    const cards: Card[] = [];
    if (this.canViewVisitors()) {
      const waiting = c?.visitors?.waiting ?? 0;
      cards.push(
        {
          label: 'Waiting for approval',
          icon: 'hourglass_top',
          value: value(c?.visitors?.waiting),
          link: '/visitors',
          queryParams: { status: 'PENDING' },
          tone: waiting > 0 ? 'warning' : 'neutral',
        },
        {
          label: 'Inside now',
          icon: 'login',
          value: value(c?.visitors?.inside),
          link: '/visitors',
          queryParams: { status: 'ENTERED' },
          tone: 'primary',
        },
        {
          label: 'Logged today',
          icon: 'today',
          value: value(c?.visitors?.loggedToday),
          link: '/visitors',
          tone: 'neutral',
        },
      );
    }
    if (this.canViewComplaints()) {
      const open = c?.complaints?.open ?? 0;
      cards.push({
        label: 'Open complaints',
        icon: 'report_problem',
        value: value(c?.complaints?.open),
        link: '/complaints',
        queryParams: { status: 'OPEN' },
        tone: open > 0 ? 'warning' : 'neutral',
      });
    }
    // Residents get the dues spotlight instead of a card.
    if (this.canViewDues() && this.persona() !== 'resident') {
      // The backend scopes dues to the viewer: every flat for the committee, a resident's own flat.
      const dues = c?.dues;
      const overdue = dues?.overdue ?? 0;
      cards.push({
        label: this.maintenance.committee() ? 'Outstanding dues' : 'Your dues',
        icon: 'account_balance_wallet',
        value: loading ? null : dues == null ? '—' : rupees(dues.outstanding),
        link: '/maintenance',
        tone: overdue > 0 ? 'warning' : 'neutral',
      });
    }
    // Only when there is something to accept: most of the time there isn't.
    const toAccept = d.policiesToAccept?.length ?? 0;
    if (toAccept > 0) {
      cards.push({
        label: toAccept === 1 ? 'Policy to accept' : 'Policies to accept',
        icon: 'fact_check',
        value: value(toAccept),
        link: toAccept === 1 ? `/policies/${d.policiesToAccept![0].id}` : '/policies',
        tone: 'warning',
      });
    }
    // The next meeting, and resolutions waiting for the caller's vote (announced or held meetings).
    const next = d.meetings?.[0];
    if (next) {
      cards.push({
        label: 'Next meeting',
        icon: 'groups',
        value: loading
          ? null
          : new Date(next.scheduledAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            }),
        link: `/meetings/${next.id}`,
        tone: 'primary',
      });
    }
    const ballots = [...(d.meetings ?? []), ...(d.heldMeetings ?? [])].flatMap((m) =>
      m.agenda.filter((i) => i.canVote).map(() => m.id),
    );
    if (ballots.length > 0) {
      cards.push({
        label: ballots.length === 1 ? 'Resolution to vote on' : 'Resolutions to vote on',
        icon: 'how_to_vote',
        value: value(ballots.length),
        link: `/meetings/${ballots[0]}`,
        tone: 'warning',
      });
    }
    if (this.can('POLICY.RULE.APPROVE') && this.ctx.selectedSocietyId() != null) {
      const waiting = c?.policiesToApprove ?? 0;
      cards.push({
        label: 'Policies to approve',
        icon: 'gavel',
        value: value(c?.policiesToApprove),
        link: '/policies',
        queryParams: { view: 'awaiting-approval' },
        tone: waiting > 0 ? 'warning' : 'neutral',
      });
    }
    if (this.can('STAFF.DIRECTORY.VIEW') && this.ctx.selectedSocietyId() != null) {
      const waiting = c?.staffToVerify ?? 0;
      cards.push({
        label: 'Staff to verify',
        icon: 'badge',
        value: value(c?.staffToVerify),
        link: '/staff',
        queryParams: { view: 'pending' },
        tone: waiting > 0 ? 'warning' : 'neutral',
      });
    }
    if (this.can('STAFF.ENTRY.VIEW') && this.ctx.selectedSocietyId() != null) {
      cards.push({
        label: 'Staff inside',
        icon: 'how_to_reg',
        value: value(c?.staffInside),
        link: '/gate/staff',
        tone: 'primary',
      });
    }
    if (this.parking('PARKING.VEHICLE.APPROVE')) {
      cards.push({
        label: 'Vehicles to approve',
        icon: 'directions_car',
        value: value(c?.vehiclesToApprove),
        link: '/parking',
        queryParams: { tab: 'vehicles' },
        tone: (c?.vehiclesToApprove ?? 0) > 0 ? 'warning' : 'neutral',
      });
    }
    if (this.parking('PARKING.VIOLATION.DECIDE')) {
      cards.push({
        label: 'Open parking reports',
        icon: 'report',
        value: value(c?.openParkingReports),
        link: '/parking',
        queryParams: { tab: 'reports' },
        tone: (c?.openParkingReports ?? 0) > 0 ? 'warning' : 'neutral',
      });
    }
    if (this.can('USER.ACCOUNT.VIEW')) {
      cards.push({
        label: 'Users',
        icon: 'group',
        value: value(c?.users),
        link: '/users',
        tone: 'neutral',
      });
    }
    if (this.can('FLAT.DIRECTORY.VIEW') && this.ctx.selectedSocietyId() != null) {
      cards.push({
        label: 'Wings',
        icon: 'domain',
        value: value(c?.wings),
        link: '/structure',
        tone: 'neutral',
      });
    }
    return cards;
  });

  /** Oldest first: the ones that have waited longest. */
  protected readonly waiting = computed(() =>
    [...(this.data().pending ?? [])].reverse().slice(0, 5),
  );
  protected readonly recent = computed(() => (this.data().recent ?? []).slice(0, 6));
  /** Oldest first, like the approvals panel: the ones that have waited longest. */
  protected readonly openComplaints = computed(() =>
    [...(this.data().openComplaints ?? [])].reverse().slice(0, 5),
  );
  protected readonly notices = computed(() => this.data().notices ?? []);

  constructor() {
    combineLatest([toObservable(this.ctx.selectedSocietyId), toObservable(this.attempt)])
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.data.set({});
        }),
        // The gate board loads its own data.
        switchMap(([societyId]) => (this.persona() === 'gate' ? of({}) : this.load(societyId))),
        takeUntilDestroyed(),
      )
      .subscribe((data) => {
        this.data.set(data);
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  /** Approve or reject from the panel; the row leaves "Needs approval" once decided. */
  protected decide(visitor: Visitor, approve: boolean): void {
    this.busy.update((ids) => new Set(ids).add(visitor.id));
    const done = () =>
      this.busy.update((ids) => {
        const next = new Set(ids);
        next.delete(visitor.id);
        return next;
      });
    const action = approve ? this.actions.approve(visitor) : this.actions.reject(visitor);
    action.subscribe({
      next: (updated) => {
        if (!updated) return;
        this.data.update((d) => ({
          ...d,
          pending: d.pending?.filter((v) => v.id !== updated.id),
          recent: d.recent?.map((v) => (v.id === updated.id ? updated : v)),
        }));
      },
      complete: done,
      error: done,
    });
  }

  /** Everything the visible cards and panels need; each failure only blanks its own part. */
  private load(societyId: number | null): Observable<DashboardData> {
    const settle = <T>(source: Observable<T>) => source.pipe(catchError(() => of(null)));
    const visitors = (status?: VisitorStatus) =>
      settle(this.visitorApi.list({ societyId, status, page: 0, size: MAX }, { silent: true }));

    const requests: { [K in keyof DashboardData]?: Observable<DashboardData[K]> } = {};
    if (societyId != null) {
      requests.counts = settle(this.reportingApi.dashboard(societyId));
    }
    if (this.can('VISITOR.ENTRY.VIEW')) {
      // A full page: the panel shows the longest waiting, the oldest of the newest-first page.
      requests.pending = visitors('PENDING');
      requests.recent = settle(
        this.visitorApi.list({ societyId, page: 0, size: RECENT }, { silent: true }),
      );
    }
    if (this.can('COMPLAINT.TICKET.VIEW') && societyId != null) {
      requests.openComplaints = settle(
        this.complaintApi.list({ societyId, status: 'OPEN', page: 0, size: MAX }, { silent: true }),
      );
    }
    if (this.can('NOTICE.POST.VIEW') && societyId != null) {
      requests.notices = settle(this.noticeApi.list(societyId, 0, NOTICES, { silent: true }));
    }
    if (this.can('MAINTENANCE.BILL.VIEW') && societyId != null && this.persona() === 'resident') {
      requests.dues = settle(this.maintenanceApi.dues(societyId, false, { silent: true }));
    }
    if (this.can('POLICY.ACKNOWLEDGEMENT.CREATE') && societyId != null) {
      requests.policiesToAccept = settle(
        this.policyApi.pendingAcknowledgements(societyId, { silent: true }),
      );
    }
    if (canOpenMeetings(this.auth, societyId) && societyId != null) {
      requests.meetings = settle(
        this.governanceApi.list(societyId, 'upcoming', null, { silent: true }),
      );
      requests.heldMeetings = settle(
        this.governanceApi
          .list(societyId, 'past', null, { silent: true })
          .pipe(map((list) => list.filter((m) => m.status === 'HELD'))),
      );
    }
    return Object.keys(requests).length ? forkJoin(requests) : of({});
  }
}

function display(count: number | null | undefined): string {
  return count == null ? '—' : count.toLocaleString('en-IN');
}

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
