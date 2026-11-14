import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { RegisterSociety } from './register-society';

describe('RegisterSociety', () => {
  let fixture: ComponentFixture<RegisterSociety>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  async function setup(user: { name: string; phone: string } | null): Promise<void> {
    TestBed.configureTestingModule({
      imports: [RegisterSociety],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: AuthStore,
          useValue: { isAuthenticated: signal(user !== null), user: signal(user) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RegisterSociety);
    await fixture.whenStable();
    http.expectOne('/api/society-applications/public/enabled').flush({ enabled: true });
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  function type(name: string, value: string): void {
    const input = el().querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[formcontrolname="${name}"]`,
    )!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function submit(): void {
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  }

  it('registers a new applicant with their own details and shows the number', async () => {
    await setup(null);
    type('societyName', 'Lake View');
    type('city', 'Pune');
    type('applicantName', 'Anita');
    type('applicantPhone', '9876543210');
    type('password', 'chosen-pass');
    submit();
    const req = http.expectOne('/api/society-applications/public');
    expect(req.request.body).toEqual({
      societyName: 'Lake View',
      city: 'Pune',
      address: undefined,
      approxFlats: undefined,
      message: undefined,
      applicantName: 'Anita',
      applicantPhone: '9876543210',
      applicantEmail: undefined,
      password: 'chosen-pass',
    });
    req.flush({
      number: 42,
      societyName: 'Lake View',
      status: 'PENDING',
      createdAt: '2026-11-14T10:00:00Z',
      reviewedAt: null,
      reason: null,
    });
    await fixture.whenStable();
    expect(el().querySelector('[data-testid="application-number"]')?.textContent).toBe('#42');
    expect(el().textContent).toContain('9876543210');

    // "Check status" looks it up straight away.
    [...el().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Check status'))!
      .click();
    const status = http.expectOne((r) => r.url === '/api/society-applications/public/status');
    expect(status.request.params.get('number')).toBe('42');
    expect(status.request.params.get('phone')).toBe('9876543210');
    status.flush({
      number: 42,
      societyName: 'Lake View',
      status: 'PENDING',
      createdAt: '2026-11-14T10:00:00Z',
      reviewedAt: null,
      reason: null,
    });
    await fixture.whenStable();
    expect(el().textContent).toContain("We haven't called yet");
  });

  it('needs a password from someone new', async () => {
    await setup(null);
    type('societyName', 'Lake View');
    type('city', 'Pune');
    type('applicantName', 'Anita');
    type('applicantPhone', '9876543210');
    submit();
    http.expectNone('/api/society-applications/public');
  });

  it('a signed-in user registers with their account, without applicant fields', async () => {
    await setup({ name: 'Ravi', phone: '9000000001' });
    expect(el().querySelector('[formcontrolname="password"]')).toBeNull();
    expect(el().textContent).toContain('Registering as Ravi (9000000001)');
    type('societyName', 'Second Home');
    type('city', 'Nashik');
    submit();
    const req = http.expectOne('/api/society-applications/public');
    expect(req.request.body.applicantPhone).toBeUndefined();
    expect(req.request.body.password).toBeUndefined();
    req.flush({
      number: 5,
      societyName: 'Second Home',
      status: 'PENDING',
      createdAt: '2026-11-14T10:00:00Z',
      reviewedAt: null,
      reason: null,
    });
  });

  it('shows a rejected registration with its reason', async () => {
    await setup(null);
    el().querySelectorAll<HTMLButtonElement>('mat-button-toggle button')[1].click();
    await fixture.whenStable();
    type('number', '42');
    type('phone', '9876543210');
    submit();
    http
      .expectOne((r) => r.url === '/api/society-applications/public/status')
      .flush({
        number: 42,
        societyName: 'Lake View',
        status: 'REJECTED',
        createdAt: '2026-11-14T10:00:00Z',
        reviewedAt: null,
        reason: 'Could not reach you',
      });
    await fixture.whenStable();
    expect(el().textContent).toContain('Rejected');
    expect(el().textContent).toContain('Could not reach you');
  });
});
