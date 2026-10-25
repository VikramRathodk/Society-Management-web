import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { Visitor } from '../../core/models';
import { VisitorList } from './visitor-list';

function visitor(overrides: Partial<Visitor> = {}): Visitor {
  return {
    id: 1,
    societyId: 1,
    flatId: 9,
    flatNumber: '1001',
    visitorName: 'Peter Parker',
    visitorPhone: null,
    purpose: 'Delivery',
    photoUrl: null,
    status: 'PENDING',
    loggedById: 2,
    loggedByName: 'Happy Hogan',
    respondedById: null,
    respondedByName: null,
    overridden: false,
    loggedAt: '2026-10-25T09:30:00Z',
    respondedAt: null,
    enteredAt: null,
    exitedAt: null,
    ...overrides,
  };
}

describe('VisitorList', () => {
  let fixture: ComponentFixture<VisitorList>;
  let http: HttpTestingController;
  let residentFlatIds: number[];
  let deniedPermissions: string[];

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (label: string, root: ParentNode = el()) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

  async function setup(firstPage: Visitor[]): Promise<void> {
    localStorage.clear();
    localStorage.setItem('sm.societyId', '1');
    TestBed.configureTestingModule({
      imports: [VisitorList],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: AuthStore,
          useValue: {
            can: (permission: string) => !deniedPermissions.includes(permission),
            canOnPlatform: () => false,
            user: () => ({ roles: residentFlatIds.map((flatId) => ({ flatId })) }),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(VisitorList);
    await fixture.whenStable();
    http.expectOne('/api/visitors?societyId=1&page=0&size=20').flush(firstPage);
    await fixture.whenStable();
  }

  beforeEach(() => {
    residentFlatIds = [9];
    deniedPermissions = [];
  });

  afterEach(() => http.verify());

  it('hides approve/reject from non-residents without the override permission', async () => {
    residentFlatIds = [];
    deniedPermissions = ['VISITOR.APPROVAL.OVERRIDE']; // e.g. a committee member
    await setup([visitor()]);
    expect(button('Approve')).toBeUndefined();
    expect(button('Reject')).toBeUndefined();
  });

  it('lets a resident of the flat approve directly, then refreshes the row', async () => {
    await setup([visitor()]);
    button('Approve')!.click();
    http.expectOne('/api/visitors/1/approve').flush({});
    http.expectOne('/api/visitors/1').flush(visitor({ status: 'APPROVED' }));
    await fixture.whenStable();

    expect(el().textContent).toContain('APPROVED');
    expect(button('Mark entered')).toBeDefined();
  });

  it('asks for confirmation before an override', async () => {
    residentFlatIds = [];
    await setup([visitor()]);
    button('Approve')!.click();
    await fixture.whenStable();

    const dialog = document.querySelector('mat-dialog-container')!;
    expect(dialog.textContent).toContain('on behalf of flat 1001');
    button('Approve', dialog)!.click();
    await fixture.whenStable();

    http.expectOne('/api/visitors/1/approve').flush({});
    http.expectOne('/api/visitors/1').flush(visitor({ status: 'APPROVED', overridden: true }));
    await fixture.whenStable();
    expect(el().textContent).toContain('override');
  });

  it('re-fetches the row when someone else already answered (409)', async () => {
    await setup([visitor()]);
    button('Reject')!.click();
    http
      .expectOne('/api/visitors/1/reject')
      .flush({ message: 'Already responded' }, { status: 409, statusText: 'Conflict' });
    http.expectOne('/api/visitors/1').flush(visitor({ status: 'APPROVED' }));
    await fixture.whenStable();
    expect(el().textContent).toContain('APPROVED');
  });

  it('loads the next page until a short page comes back', async () => {
    await setup(Array.from({ length: 20 }, (_, i) => visitor({ id: i + 1 })));
    button('Load more')!.click();
    http.expectOne('/api/visitors?societyId=1&page=1&size=20').flush([visitor({ id: 21 })]);
    await fixture.whenStable();

    expect(el().querySelectorAll('mat-card').length).toBe(21);
    expect(button('Load more')).toBeUndefined();
  });

  it('keeps the list when a background refresh fails', async () => {
    // RxJS timers use setInterval; Angular's scheduler needs the real setTimeout.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await setup([visitor()]);
      vi.advanceTimersByTime(15_000);
      http
        .expectOne('/api/visitors?societyId=1&page=0&size=20')
        .flush(null, { status: 503, statusText: 'Unavailable' });
      await fixture.whenStable();
      expect(el().querySelectorAll('mat-card').length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens on the status from the URL', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap({ status: 'ENTERED' }) } },
    });
    localStorage.clear();
    localStorage.setItem('sm.societyId', '1');
    TestBed.configureTestingModule({
      imports: [VisitorList],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { can: () => true, user: () => ({ roles: [] }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(VisitorList);
    await fixture.whenStable();
    http.expectOne('/api/visitors?societyId=1&status=ENTERED&page=0&size=20').flush([]);
  });
});
