import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { invitation } from './invitation-test-data';
import { PendingInvitations } from './pending-invitations';

describe('PendingInvitations', () => {
  let fixture: ComponentFixture<PendingInvitations>;
  let http: HttpTestingController;
  const auth = { restore: vi.fn(() => of(undefined)) };
  const ctx = { load: vi.fn(() => of(undefined)) };

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [PendingInvitations],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthStore, useValue: auth },
        { provide: SocietyContextStore, useValue: ctx },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PendingInvitations);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/api/invitations/mine'))
      .flush([
        invitation({
          role: 'COMMITTEE',
          roleName: 'Committee Member',
          flatLabel: null,
          residentType: null,
        }),
      ]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('shows each waiting invitation', () => {
    expect(el().textContent).toContain('Sneha invited you to Green Park');
    expect(el().textContent).toContain('as Committee Member');
  });

  it('accepts, reloads access and societies, and drops the banner', async () => {
    button('Accept').click();
    http
      .expectOne((r) => r.url.endsWith('/api/invitations/7/accept'))
      .flush(invitation({ status: 'ACCEPTED' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(auth.restore).toHaveBeenCalled();
    expect(ctx.load).toHaveBeenCalled();
    expect(el().querySelector('.banner')).toBeNull();
  });

  it('keeps the banner and shows why when accepting fails', async () => {
    button('Accept').click();
    http
      .expectOne((r) => r.url.endsWith('/accept'))
      .flush({ message: 'This invitation is expired' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('expired');
  });
});
