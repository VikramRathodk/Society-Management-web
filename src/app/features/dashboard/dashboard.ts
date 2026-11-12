import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { ComplaintApi } from '../../core/api/complaint.api';
import { MaintenanceApi } from '../../core/api/maintenance.api';
import { FinanceSummaryCard } from '../finance/finance-summary-card';
import { NoticeApi } from '../../core/api/notice.api';
import { StructureApi } from '../../core/api/structure.api';
import { UserApi } from '../../core/api/user.api';
import { VisitorApi } from '../../core/api/visitor.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { Complaint, FlatDues, Notice, Visitor, VisitorStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { Section, Skeleton, StatCard, Tone } from '../../shared/ui';
import { ComplaintRow } from '../complaints/complaint-ui';
import { MaintenanceAccess, inr } from '../maintenance/maintenance-ui';
import { VisitorPhotos, VisitorRow, timeAgo } from '../visitors/visitor-ui';

/** The API caps a page at 100 and returns no totals, so larger counts show as "100+". */
const MAX = 100;
/** Latest notices shown on the board panel. */
const NOTICES = 3;

/** Per item: undefined = not loaded yet (or not permitted), null = failed. */
interface DashboardData {
  pending?: Visitor[] | null;
  inside?: Visitor[] | null;
  recent?: Visitor[] | null;
  users?: number | null;
  wings?: number | null;
  openComplaints?: Complaint[] | null;
  notices?: Notice[] | null;
  dues?: FlatDues[] | null;
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
  ],
  providers: [VisitorPhotos],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly visitorApi = inject(VisitorApi);
  private readonly userApi = inject(UserApi);
  private readonly structureApi = inject(StructureApi);
  private readonly complaintApi = inject(ComplaintApi);
  private readonly noticeApi = inject(NoticeApi);
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

  protected readonly data = signal<DashboardData>({});
  protected readonly loading = signal(true);

  protected readonly cards = computed<Card[]>(() => {
    const d = this.data();
    const loading = this.loading();
    const value = (n: number | null | undefined) => (loading ? null : display(n));
    const cards: Card[] = [];
    if (this.canViewVisitors()) {
      const waiting = d.pending?.length ?? 0;
      cards.push(
        {
          label: 'Waiting for approval',
          icon: 'hourglass_top',
          value: value(d.pending === null ? null : d.pending?.length),
          link: '/visitors',
          queryParams: { status: 'PENDING' },
          tone: waiting > 0 ? 'warning' : 'neutral',
        },
        {
          label: 'Inside now',
          icon: 'login',
          value: value(d.inside === null ? null : d.inside?.length),
          link: '/visitors',
          queryParams: { status: 'ENTERED' },
          tone: 'primary',
        },
        {
          label: 'Logged today',
          icon: 'today',
          value: value(
            d.recent === null ? null : d.recent?.filter((v) => isToday(v.loggedAt)).length,
          ),
          link: '/visitors',
          tone: 'neutral',
        },
      );
    }
    if (this.canViewComplaints()) {
      const open = d.openComplaints?.length ?? 0;
      cards.push({
        label: 'Open complaints',
        icon: 'report_problem',
        value: value(d.openComplaints === null ? null : d.openComplaints?.length),
        link: '/complaints',
        queryParams: { status: 'OPEN' },
        tone: open > 0 ? 'warning' : 'neutral',
      });
    }
    if (this.canViewDues()) {
      // The backend scopes dues to the viewer: every flat for the committee, a resident's own flat.
      const dues = d.dues;
      const overdue = sum(dues, (f) => f.overdue);
      cards.push({
        label: this.maintenance.committee() ? 'Outstanding dues' : 'Your dues',
        icon: 'account_balance_wallet',
        value: loading ? null : dues == null ? '—' : inr(sum(dues, (f) => f.outstanding)),
        link: '/maintenance',
        tone: overdue > 0 ? 'warning' : 'neutral',
      });
    }
    if (this.can('USER.ACCOUNT.VIEW')) {
      cards.push({
        label: 'Users',
        icon: 'group',
        value: value(d.users),
        link: '/users',
        tone: 'neutral',
      });
    }
    if (this.can('FLAT.DIRECTORY.VIEW') && this.ctx.selectedSocietyId() != null) {
      cards.push({
        label: 'Wings',
        icon: 'domain',
        value: value(d.wings),
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
    toObservable(this.ctx.selectedSocietyId)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.data.set({});
        }),
        switchMap((societyId) => this.load(societyId)),
        takeUntilDestroyed(),
      )
      .subscribe((data) => {
        this.data.set(data);
        this.loading.set(false);
      });
  }

  /** Everything the visible cards and panels need; each failure only blanks its own part. */
  private load(societyId: number | null): Observable<DashboardData> {
    const settle = <T>(source: Observable<T>) => source.pipe(catchError(() => of(null)));
    const visitors = (status?: VisitorStatus) =>
      settle(this.visitorApi.list({ societyId, status, page: 0, size: MAX }, { silent: true }));

    const requests: { [K in keyof DashboardData]?: Observable<DashboardData[K]> } = {};
    if (this.can('VISITOR.ENTRY.VIEW')) {
      requests.pending = visitors('PENDING');
      requests.inside = visitors('ENTERED');
      requests.recent = visitors();
    }
    if (this.can('USER.ACCOUNT.VIEW')) {
      requests.users = settle(this.userApi.list(societyId).pipe(map((list) => list.length)));
    }
    if (this.can('FLAT.DIRECTORY.VIEW') && societyId != null) {
      requests.wings = settle(this.structureApi.wings(societyId).pipe(map((list) => list.length)));
    }
    if (this.can('COMPLAINT.TICKET.VIEW') && societyId != null) {
      requests.openComplaints = settle(
        this.complaintApi.list({ societyId, status: 'OPEN', page: 0, size: MAX }, { silent: true }),
      );
    }
    if (this.can('NOTICE.POST.VIEW') && societyId != null) {
      requests.notices = settle(this.noticeApi.list(societyId, 0, NOTICES, { silent: true }));
    }
    if (this.can('MAINTENANCE.BILL.VIEW') && societyId != null) {
      requests.dues = settle(this.maintenanceApi.dues(societyId, false, { silent: true }));
    }
    return Object.keys(requests).length ? forkJoin(requests) : of({});
  }
}

function display(count: number | null | undefined): string {
  if (count == null) return '—';
  return count >= MAX ? `${MAX}+` : String(count);
}

function sum<T>(items: readonly T[] | null | undefined, value: (item: T) => number): number {
  // Rounded to paise so float sums like 0.1 + 0.2 don't show stray digits.
  return Math.round((items ?? []).reduce((total, item) => total + value(item), 0) * 100) / 100;
}

function isToday(iso: string | null): boolean {
  return !!iso && new Date(iso).toDateString() === new Date().toDateString();
}

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
