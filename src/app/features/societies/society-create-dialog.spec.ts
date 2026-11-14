import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { AuthStore } from '../../core/auth/auth.store';
import { Society } from '../../core/models';
import { SocietyCreateDialog } from './society-create-dialog';

describe('SocietyCreateDialog', () => {
  let http: HttpTestingController;
  let ref: MatDialogRef<SocietyCreateDialog, Society>;
  let closedWith: Society | undefined | 'open';
  const root = () => document.querySelector('mat-dialog-container') as HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthStore, useValue: { canOnPlatform: () => false } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    closedWith = 'open';
    ref = TestBed.inject(MatDialog).open(SocietyCreateDialog);
    ref.afterClosed().subscribe((s) => (closedWith = s));
    await new Promise((r) => setTimeout(r));
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    http.verify();
  });

  function type(name: string, value: string): void {
    const input = root().querySelector<HTMLInputElement>(`[formcontrolname="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('creates the society with its secretary and shows the invitation link', async () => {
    type('name', 'Sunrise Towers');
    type('secretaryName', 'Ravi Kumar');
    type('secretaryPhone', '9876543210');
    root().querySelector<HTMLFormElement>('form')!.requestSubmit();
    const req = http.expectOne('/api/onboarding/societies');
    expect(req.request.body).toEqual({
      name: 'Sunrise Towers',
      address: undefined,
      complexId: undefined,
      startLive: false,
      secretary: { name: 'Ravi Kumar', phone: '9876543210' },
    });
    const society = { id: 3, name: 'Sunrise Towers', status: 'SETUP' } as Society;
    req.flush({
      society,
      secretaryInvitation: {
        token: 'tok',
        inviteUrl: 'http://app/invite/tok',
        invitation: {
          id: 1,
          societyId: 3,
          societyName: 'Sunrise Towers',
          role: 'SECRETARY',
          roleName: 'Secretary',
          flatId: null,
          flatLabel: null,
          residentType: null,
          phone: '9876543210',
          name: 'Ravi Kumar',
          status: 'PENDING',
          invitedById: 1,
          invitedByName: 'Admin',
          createdAt: '2026-11-14T10:00:00Z',
          expiresAt: '2026-11-21T10:00:00Z',
          closedAt: null,
          acceptedUserId: null,
          approvedAt: null,
          approvedByName: null,
        },
      },
    });
    await new Promise((r) => setTimeout(r));
    expect(root().textContent).toContain('Sunrise Towers is ready');
    expect(root().querySelector('[data-testid="invite-link"]')?.textContent).toBe(
      'http://app/invite/tok',
    );
    // Only "Done" closes it now, with the new society.
    expect(ref.disableClose).toBe(true);
    [...root().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Done'))!
      .click();
    await new Promise((r) => setTimeout(r));
    expect(closedWith).toEqual(society);
  });

  it('does not send without a valid secretary phone', () => {
    type('name', 'Sunrise Towers');
    type('secretaryName', 'Ravi');
    type('secretaryPhone', '123');
    root().querySelector<HTMLFormElement>('form')!.requestSubmit();
    http.expectNone('/api/onboarding/societies');
  });
});
