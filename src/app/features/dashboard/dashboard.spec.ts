import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let http: HttpTestingController;

  async function setup(permissions: string[]): Promise<void> {
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
            user: () => ({ name: 'Happy Hogan', roles: [] }),
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
    http.expectOne('/api/visitors?societyId=1&status=PENDING&page=0&size=100').flush([{}, {}]);
    http.expectOne('/api/visitors?societyId=1&status=ENTERED&page=0&size=100').flush([]);
    http
      .expectOne('/api/visitors?societyId=1&page=0&size=100')
      .flush([{ loggedAt: now }, { loggedAt: '2020-01-01T00:00:00Z' }]);
    await fixture.whenStable();
    expect(values()).toEqual(['2', '0', '1']);
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
});
