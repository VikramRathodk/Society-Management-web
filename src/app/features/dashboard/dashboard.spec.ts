import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SubscriptionAccessStore } from '../../core/subscription/subscription-access.store';
import { DashboardCounts, Visitor } from '../../core/models';
import { Dashboard } from './dashboard';

function visitor(
  id: number,
  name: string,
  loggedAt: string,
  status: Visitor['status'] = 'PENDING',
): Visitor {
  return {
    id,
    societyId: 1,
    flatId: 9,
    flatNumber: '1001',
    visitorName: name,
    visitorPhone: null,
    purpose: null,
    photoUrl: null,
    status,
    loggedById: 2,
    loggedByName: 'Happy Hogan',
    respondedById: null,
    respondedByName: null,
    overridden: false,
    loggedAt,
    respondedAt: null,
    enteredAt: null,
    exitedAt: null,
  };
}

/** The dashboard endpoint's answer: every part hidden unless given. */
function counts(parts: Partial<DashboardCounts> = {}): DashboardCounts {
  return {
    visitors: null,
    complaints: null,
    dues: null,
    users: null,
    wings: null,
    policiesToApprove: null,
    staffToVerify: null,
    staffInside: null,
    vehiclesToApprove: null,
    openParkingReports: null,
    ...parts,
  };
}

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let http: HttpTestingController;

  async function setup(
    permissions: string[],
    roles: { societyId: number; flatId: number | null }[] = [],
  ): Promise<void> {
    localStorage.clear();
    localStorage.setItem('sm.societyId', '1');
    TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: {
            can: (p: string) => permissions.includes(p),
            canOnPlatform: () => false,
            user: () => ({ name: 'Happy Hogan', roles }),
          },
        },
        // Every paid module on, without fetching the subscription.
        { provide: SubscriptionAccessStore, useValue: { allows: () => true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
  }

  const labels = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('.stat-label')].map((e) =>
      e.textContent?.trim(),
    );
  const values = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('.stat-value')].map((e) =>
      e.textContent?.trim(),
    );

  const flushCounts = (parts: Partial<DashboardCounts> = {}) =>
    http.expectOne('/api/societies/1/dashboard').flush(counts(parts));

  afterEach(() => http.verify());

  it('shows only visitor cards to a guard, with counts', async () => {
    await setup(['VISITOR.ENTRY.VIEW', 'VISITOR.ENTRY.CREATE']);
    expect(labels()).toEqual(['Waiting for approval', 'Inside now', 'Logged today']);

    const now = new Date().toISOString();
    // Newest first, as the API returns them.
    const pending = [visitor(2, 'Newer Guest', now), visitor(1, 'Older Guest', now)];
    flushCounts({ visitors: { waiting: 2, inside: 0, loggedToday: 2 } });
    http.expectOne('/api/visitors?societyId=1&status=PENDING&page=0&size=100').flush(pending);
    http
      .expectOne('/api/visitors?societyId=1&page=0&size=6')
      .flush([...pending, visitor(3, 'Old Guest', '2020-01-01T00:00:00Z', 'EXITED')]);
    await fixture.whenStable();
    expect(values()).toEqual(['2', '0', '2']);

    // "Needs approval" lists the longest-waiting visitor first.
    const panel = (fixture.nativeElement as HTMLElement).querySelector('app-section')!;
    const names = [...panel.querySelectorAll('app-visitor-row .name')].map((n) =>
      n.textContent?.trim(),
    );
    expect(names).toEqual(['Older Guest', 'Newer Guest']);
  });

  it('adds user and wing cards for a secretary with exact counts; a hidden part shows a dash', async () => {
    await setup(['VISITOR.ENTRY.VIEW', 'USER.ACCOUNT.VIEW', 'FLAT.DIRECTORY.VIEW']);
    expect(labels()).toEqual([
      'Waiting for approval',
      'Inside now',
      'Logged today',
      'Users',
      'Wings',
    ]);
    flushCounts({ visitors: { waiting: 0, inside: 0, loggedToday: 0 }, users: 1200 });
    http.match((r) => r.url === '/api/visitors').forEach((r) => r.flush([]));
    await fixture.whenStable();
    // No more "100+": the endpoint counts exactly.
    expect(values()).toEqual(['0', '0', '0', '1,200', '—']);
  });

  const dues = (flatId: number, outstanding: number, overdue: number) => ({
    flatId,
    wingName: 'A',
    flatNumber: String(100 + flatId),
    openBills: 1,
    outstanding,
    overdue,
    oldestDueDate: '2026-10-10',
    credit: 0,
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('totals every flat’s dues for the committee and flags overdue ones', async () => {
    await setup(
      ['MAINTENANCE.BILL.VIEW', 'MAINTENANCE.BILL.CREATE'],
      [{ societyId: 1, flatId: null }],
    );
    expect(labels()).toEqual(['Outstanding dues']);
    flushCounts({ dues: { outstanding: 3500.3, overdue: 1000.2, flatsWithDues: 2 } });
    // The trend charts ask for six months; nothing billed yet, so they stay hidden.
    http
      .expectOne('/api/societies/1/stats/maintenance?months=6')
      .flush({ from: '2026-06', to: '2026-11', months: [], ageing: [] });
    // The money strip asks for the latest bill cycle.
    http.expectOne('/api/societies/1/maintenance/cycles').flush([]);
    await fixture.whenStable();
    expect(values()).toEqual(['₹3,500']);
    const card = (fixture.nativeElement as HTMLElement).querySelector('app-stat-card')!;
    expect(card.outerHTML).toContain('warning');
  });

  it('gives the committee money at a glance and the latest cycle’s collection', async () => {
    await setup(
      ['MAINTENANCE.BILL.VIEW', 'MAINTENANCE.BILL.CREATE', 'FINANCE.REPORT.VIEW'],
      [{ societyId: 1, flatId: null }],
    );
    flushCounts({ dues: { outstanding: 0, overdue: 0, flatsWithDues: 0 } });
    // The trend charts ask for six months; nothing billed yet, so they stay hidden.
    http
      .expectOne('/api/societies/1/stats/maintenance?months=6')
      .flush({ from: '2026-06', to: '2026-11', months: [], ageing: [] });
    http
      .expectOne((r) => r.url === '/api/societies/1/finance/summary')
      .flush({
        from: '2026-04-01',
        to: '2027-03-31',
        months: [
          {
            month: '2026-09',
            income: [],
            expenditure: [],
            totalIncome: 100000,
            totalExpenditure: 80000,
            closingCashAndBank: 500000,
          },
          {
            month: '2026-10',
            income: [],
            expenditure: [],
            totalIncome: 120000,
            totalExpenditure: 140000,
            closingCashAndBank: 480000,
          },
        ],
      });
    http.expectOne('/api/societies/1/maintenance/cycles').flush([
      {
        id: 7,
        kind: 'REGULAR',
        status: 'ISSUED',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        billCount: 36,
        billsByStatus: { PAID: 31, UNPAID: 5 },
        totalBilled: 216000,
        totalPaid: 186000,
        totalOutstanding: 30000,
      },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const glance = (fixture.nativeElement as HTMLElement).querySelector('app-money-glance')!;
    expect(glance.textContent).toContain('₹1,20,000');
    expect(glance.textContent).toContain('+20% vs');
    // Spending more than came in reads as a deficit.
    expect(glance.textContent).toContain('Deficit');
    expect(glance.textContent).toContain('₹20,000');
    expect(glance.textContent).toContain('31 of 36');
    expect(glance.textContent).toContain('₹30,000 outstanding');
  });

  it('shows a resident their own dues in the spotlight, not as a card', async () => {
    await setup(['MAINTENANCE.BILL.VIEW'], [{ societyId: 1, flatId: 9 }]);
    expect(labels()).toEqual([]);
    flushCounts({ dues: { outstanding: 6000, overdue: 6000, flatsWithDues: 1 } });
    http
      .expectOne('/api/societies/1/maintenance/dues?overdueOnly=false')
      .flush([dues(9, 6000, 6000)]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('₹6,000');
    expect(text()).toContain('overdue');
    expect(text()).toContain('View & pay');
  });

  it('tells a resident with nothing due that they are paid up', async () => {
    await setup(['MAINTENANCE.BILL.VIEW'], [{ societyId: 1, flatId: 9 }]);
    flushCounts({ dues: { outstanding: 0, overdue: 0, flatsWithDues: 0 } });
    http.expectOne('/api/societies/1/maintenance/dues?overdueOnly=false').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('All paid up');
  });

  it('says the visitors failed to load instead of "nobody is waiting"', async () => {
    await setup(['VISITOR.ENTRY.VIEW']);
    flushCounts({ visitors: { waiting: 0, inside: 0, loggedToday: 0 } });
    http
      .match((r) => r.url === '/api/visitors')
      .forEach((r) => r.flush(null, { status: 500, statusText: 'Error' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain("Couldn't load visitors.");
    expect(text()).not.toContain('Nobody is waiting');
  });

  it('shows gate staff the gate board instead of the overview', async () => {
    // A guard who also lives here: seeing every flat's bills doesn't make them committee, and
    // their flat doesn't make them a resident first.
    await setup(
      [
        'VISITOR.ENTRY.VIEW',
        'VISITOR.ENTRY.CREATE',
        'VISITOR.ENTRY.UPDATE',
        'MAINTENANCE.BILL.VIEW',
      ],
      [
        { societyId: 1, flatId: null },
        { societyId: 1, flatId: 9 },
      ],
    );
    expect(labels()).toEqual([]);
    // Only the board's three lanes are fetched; the overview loads nothing.
    for (const status of ['APPROVED', 'PENDING', 'ENTERED']) {
      http
        .expectOne(`/api/visitors?societyId=1&status=${status}&page=0&size=100`)
        .flush(
          status === 'APPROVED'
            ? [visitor(5, 'Pepper Potts', new Date().toISOString(), 'APPROVED')]
            : [],
        );
    }
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Let in');
    expect(text()).toContain('Pepper Potts');
    expect(text()).toContain('Waiting on residents');
  });
});
