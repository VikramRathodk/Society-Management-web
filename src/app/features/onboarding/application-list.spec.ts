import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyApplication } from '../../core/models';
import { ApplicationList } from './application-list';

const pending: SocietyApplication = {
  id: 9,
  societyName: 'Lake View',
  city: 'Pune',
  address: 'Baner Road',
  approxFlats: 120,
  applicantName: 'Anita',
  applicantPhone: '9876543210',
  applicantEmail: null,
  existingAccount: false,
  message: 'Call after 6',
  status: 'PENDING',
  createdAt: '2026-11-14T10:00:00Z',
  reviewedAt: null,
  reviewedByName: null,
  reason: null,
  societyId: null,
};

describe('ApplicationList', () => {
  let fixture: ComponentFixture<ApplicationList>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string, root: ParentNode = el()) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === text,
    )!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ApplicationList],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: AuthStore,
          useValue: {
            can: () => true,
            canOnPlatform: () => true,
            access: () => null,
            user: () => null,
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ApplicationList);
    await fixture.whenStable();
    const req = http.expectOne((r) => r.url === '/api/society-applications');
    expect(req.request.params.get('status')).toBe('PENDING');
    req.flush([pending]);
    await fixture.whenStable();
  });

  afterEach(() => TestBed.inject(MatDialog).closeAll());

  it('shows each waiting registration with the applicant to call', () => {
    expect(el().textContent).toContain('Lake View');
    expect(el().textContent).toContain('about 120 flats');
    expect(el().querySelector('a[href="tel:9876543210"]')).not.toBeNull();
    expect(el().textContent).toContain('Call after 6');
  });

  it('approves after confirming and drops it from the waiting list', async () => {
    button('Approve').click();
    await fixture.whenStable();
    expect(document.body.textContent).toContain('with the password they chose');
    button('Approve', document.querySelector('mat-dialog-container')!).click();
    await fixture.whenStable();
    http
      .expectOne('/api/society-applications/9/approve')
      .flush({ ...pending, status: 'APPROVED', societyId: 31 });
    await fixture.whenStable();
    http.match(() => true).forEach((r) => r.flush([])); // the society switcher reloads
    await fixture.whenStable();
    expect(el().textContent).toContain('No registrations waiting');
  });

  it('rejects with a reason', async () => {
    button('Reject').click();
    await fixture.whenStable();
    const input = document.querySelector<HTMLInputElement>('mat-dialog-container input')!;
    input.value = 'Not reachable';
    input.dispatchEvent(new Event('input'));
    document.querySelector<HTMLFormElement>('mat-dialog-container form')!.requestSubmit();
    await fixture.whenStable();
    const req = http.expectOne('/api/society-applications/9/reject');
    expect(req.request.body).toEqual({ reason: 'Not reachable' });
    req.flush({ ...pending, status: 'REJECTED', reason: 'Not reachable' });
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    expect(el().textContent).toContain('No registrations waiting');
  });
});
