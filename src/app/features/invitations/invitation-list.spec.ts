import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { InvitationList } from './invitation-list';
import { invitation } from './invitation-test-data';

describe('InvitationList', () => {
  let fixture: ComponentFixture<InvitationList>;
  let http: HttpTestingController;
  let permissions: string[];

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim().endsWith(label)) as
      HTMLButtonElement | undefined;

  async function setup(perms: string[], status: string | null, flatOptions: unknown[]) {
    permissions = perms;
    TestBed.configureTestingModule({
      imports: [InvitationList],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(status ? { status } : {}) } },
        },
        {
          provide: AuthStore,
          useValue: {
            can: (p: string) => permissions.includes(p),
            user: () => ({ id: 2, roles: [] }),
          },
        },
        {
          provide: SocietyContextStore,
          useValue: {
            selectedSocietyId: signal(4),
            selectedSociety: signal({ id: 4, name: 'Green Park' }),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InvitationList);
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectOne((r) => r.url.endsWith('/invitations/flat-options')).flush(flatOptions);
    return http.expectOne((r) => r.url.endsWith('/api/societies/4/invitations'));
  }

  afterEach(() => http.verify());

  it('lets the committee approve a resident invitation, starting from ?status=', async () => {
    const list = await setup(
      ['USER.INVITE.CREATE', 'USER.INVITE.VIEW', 'USER.INVITE.APPROVE'],
      'AWAITING_APPROVAL',
      [],
    );
    expect(list.request.params.get('status')).toBe('AWAITING_APPROVAL');
    list.flush([
      invitation({ status: 'AWAITING_APPROVAL', invitedById: 30, invitedByName: 'Tony' }),
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().textContent).toContain('Awaiting approval');
    expect(button('Invite someone')).toBeDefined();
    button('Approve')!.click();
    http
      .expectOne((r) => r.url.endsWith('/api/invitations/7/approve'))
      .flush(invitation({ status: 'PENDING', approvedByName: 'Sneha', invitedByName: 'Tony' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().textContent).toContain('approved by Sneha');
    expect(button('Approve')).toBeUndefined();
  });

  it('shows a resident their own invitations and "Invite to my flat"', async () => {
    const list = await setup([], null, [
      {
        flatId: 9,
        flatLabel: 'A-101',
        role: 'RESIDENT',
        roleName: 'Resident',
        residentTypes: ['FAMILY', 'TENANT'],
        needsApproval: true,
      },
    ]);
    list.flush([invitation({ status: 'AWAITING_APPROVAL', invitedById: 2 })]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().textContent).toContain('Invitations you sent');
    expect(button('Invite to my flat')).toBeDefined();
    expect(button('Approve')).toBeUndefined();
    expect(button('Show QR')).toBeDefined(); // their own invitation
  });

  it('explains when a resident may not invite', async () => {
    const list = await setup([], null, []);
    list.flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().textContent).toContain("isn't open to you here");
    expect(button('Invite to my flat')).toBeUndefined();
  });
});
