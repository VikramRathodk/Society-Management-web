import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AuthStore } from '../../core/auth/auth.store';
import { InvitationPreview } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { AcceptInvitation } from './accept-invitation';
import { invitation } from './invitation-test-data';

function preview(overrides: Partial<InvitationPreview> = {}): InvitationPreview {
  return {
    societyName: 'Green Park',
    role: 'RESIDENT',
    roleName: 'Resident',
    flatLabel: 'A-101',
    residentType: 'OWNER',
    name: 'Priya',
    maskedPhone: '98•••••210',
    invitedByName: 'Sneha',
    status: 'PENDING',
    expiresAt: '2026-11-16T10:00:00Z',
    hasAccount: false,
    ...overrides,
  };
}

describe('AcceptInvitation', () => {
  let fixture: ComponentFixture<AcceptInvitation>;
  let http: HttpTestingController;
  let signedIn: boolean;
  const auth = {
    isAuthenticated: () => signedIn,
    user: () => (signedIn ? { name: 'Rahul', phone: '9876543210' } : null),
    login: vi.fn(() => of(undefined)),
    restore: vi.fn(() => of(undefined)),
    logout: vi.fn(() => (signedIn = false)),
  };
  const url = '/api/invitations/token/tok123';

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
      HTMLButtonElement | undefined;
  const type = (label: string, value: string) => {
    const field = [...el().querySelectorAll('mat-form-field')].find((f) =>
      f.querySelector('mat-label')?.textContent?.includes(label),
    )!;
    const input = field.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function setup(first: InvitationPreview | 'missing', isSignedIn = false): Promise<void> {
    signedIn = isSignedIn;
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [AcceptInvitation],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthStore, useValue: auth },
        { provide: SocietyContextStore, useValue: { load: () => of(undefined) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(AcceptInvitation);
    fixture.componentRef.setInput('token', 'tok123');
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url.endsWith(url) && r.method === 'GET');
    if (first === 'missing')
      req.flush({ message: 'not valid' }, { status: 404, statusText: 'Not Found' });
    else req.flush(first);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows the invitation and lets a new person sign up, then signs them in', async () => {
    await setup(preview());
    expect(el().querySelector('h1')?.textContent).toContain('Green Park');
    expect(el().textContent).toContain('A-101 · Owner');
    expect(el().textContent).toContain('98•••••210');

    type('Password', 'welcome123');
    type('Confirm password', 'welcome123');
    fixture.detectChanges();
    button('Create account and join')!.click();

    const req = http.expectOne((r) => r.url.endsWith(`${url}/accept`));
    expect(req.request.body).toEqual({ name: 'Priya', password: 'welcome123' });
    req.flush(invitation({ status: 'ACCEPTED', phone: '9876543210' }));
    await fixture.whenStable();

    expect(auth.login).toHaveBeenCalledWith({ phone: '9876543210', password: 'welcome123' });
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('refuses mismatched passwords before calling the server', async () => {
    await setup(preview());
    type('Password', 'welcome123');
    type('Confirm password', 'welcome124');
    fixture.detectChanges();
    button('Create account and join')!.click();
    fixture.detectChanges();
    expect(el().textContent).toContain("The passwords don't match");
    http.expectNone((r) => r.url.endsWith(`${url}/accept`));
  });

  it('asks an existing account holder to sign in first', async () => {
    await setup(preview({ hasAccount: true }));
    expect(el().querySelector('form')).toBeNull();
    button('Sign in to accept')!.click();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/invite/tok123' },
    });
  });

  it('accepts onto the signed-in account and shows the server message when it fails', async () => {
    await setup(preview({ hasAccount: true }), true);
    expect(el().textContent).toContain('Signed in as Rahul');
    button('Accept invitation')!.click();
    http
      .expectOne((r) => r.url.endsWith(`${url}/accept`))
      .flush(
        { message: 'This invitation is for another phone number' },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('another phone number');
  });

  it('explains a closed invitation', async () => {
    await setup(preview({ status: 'EXPIRED' }));
    expect(el().textContent).toContain('This invitation has expired');
    expect(button('Create account and join')).toBeUndefined();
  });

  it('explains an unknown link', async () => {
    await setup('missing');
    expect(el().querySelector('h1')?.textContent).toContain('Invitation not found');
  });
});
