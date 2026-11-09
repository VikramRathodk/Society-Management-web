import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { Visitor } from '../../core/models';
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

  afterEach(() => http.verify());

  it('shows only visitor cards to a guard, with counts', async () => {
    await setup(['VISITOR.ENTRY.VIEW', 'VISITOR.ENTRY.CREATE']);
    expect(labels()).toEqual(['Waiting for approval', 'Inside now', 'Logged today']);

    const now = new Date().toISOString();
    // Newest first, as the API returns them.
    const pending = [visitor(2, 'Newer Guest', now), visitor(1, 'Older Guest', now)];
    http.expectOne('/api/visitors?societyId=1&status=PENDING&page=0&size=100').flush(pending);
    http.expectOne('/api/visitors?societyId=1&status=ENTERED&page=0&size=100').flush([]);
    http
      .expectOne('/api/visitors?societyId=1&page=0&size=100')
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

  it('adds user and wing cards for a secretary; a failed count shows a dash', async () => {
    await setup(['VISITOR.ENTRY.VIEW', 'USER.ACCOUNT.VIEW', 'FLAT.DIRECTORY.VIEW']);
    expect(labels()).toEqual([
      'Waiting for approval',
      'Inside now',
      'Logged today',
      'Users',
      'Wings',
    ]);
    http.match((r) => r.url === '/api/visitors').forEach((r) => r.flush([]));
    http.expectOne('/api/users?societyId=1').flush(new Array(120).fill({}));
    http.expectOne('/api/societies/1/wings').flush(null, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect(values()).toEqual(['0', '0', '0', '100+', '—']);
  });

  const dues = (flatId: number, outstanding: number, overdue: number) => ({
    flatId,
    wingName: 'A',
    flatNumber: String(100 + flatId),
    openBills: 1,
    outstanding,
    overdue,
    oldestDueDate: '2026-10-10',
  });

  it('totals every flat’s dues for the committee and flags overdue ones', async () => {
    await setup(['MAINTENANCE.BILL.VIEW'], [{ societyId: 1, flatId: null }]);
    expect(labels()).toEqual(['Outstanding dues']);
    http
      .expectOne('/api/societies/1/maintenance/dues?overdueOnly=false')
      .flush([dues(1, 2500.1, 0), dues(2, 1000.2, 1000.2)]);
    await fixture.whenStable();
    expect(values()).toEqual(['₹3,500.30']);
    const card = (fixture.nativeElement as HTMLElement).querySelector('app-stat-card')!;
    expect(card.outerHTML).toContain('warning');
  });

  it('shows a resident their own dues', async () => {
    await setup(['MAINTENANCE.BILL.VIEW'], [{ societyId: 1, flatId: 9 }]);
    expect(labels()).toEqual(['Your dues']);
    http.expectOne('/api/societies/1/maintenance/dues?overdueOnly=false').flush([]);
    await fixture.whenStable();
    expect(values()).toEqual(['₹0.00']);
  });
});
