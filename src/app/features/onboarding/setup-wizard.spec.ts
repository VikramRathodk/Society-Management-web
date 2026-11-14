import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { OnboardingChecklist, Society } from '../../core/models';
import { SetupWizard } from './setup-wizard';

const society: Society = {
  id: 7,
  name: 'Lake View',
  address: null,
  complexId: null,
  status: 'SETUP',
  source: 'SELF_SIGNUP',
  createdAt: '2026-11-14T10:00:00Z',
  wentLiveAt: null,
  registrationNumber: null,
  city: 'Pune',
  state: null,
  pincode: null,
  contactPhone: '9876543210',
  contactEmail: null,
  hasLogo: false,
  notes: null,
};

function checklist(over: Partial<OnboardingChecklist> = {}): OnboardingChecklist {
  return {
    societyId: 7,
    name: 'Lake View',
    status: 'SETUP',
    source: 'SELF_SIGNUP',
    createdAt: null,
    wentLiveAt: null,
    profile: { done: false, missing: ['address', 'state', 'pincode'] },
    structure: { done: true, wings: 2, flats: 48 },
    residents: { done: true, members: 0, openInvitations: 0, staged: 3 },
    committee: { done: false, members: 1, openInvitations: 0, staged: 0 },
    settings: { done: false, customized: 0 },
    stepsDone: 2,
    stepsTotal: 5,
    canGoLive: false,
    ...over,
  };
}

describe('SetupWizard', () => {
  let fixture: ComponentFixture<SetupWizard>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const steps = () => [...el().querySelectorAll('.step .label')].map((e) => e.textContent?.trim());

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: AuthStore,
          useValue: {
            can: () => true,
            canOnPlatform: () => false,
            access: () => null,
            user: () => null,
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SetupWizard);
    fixture.componentRef.setInput('id', 7);
    await fixture.whenStable();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
  });

  async function load(c = checklist()): Promise<void> {
    http.expectOne('/api/societies/7').flush(society);
    http.expectOne('/api/societies/7/onboarding').flush(c);
    await fixture.whenStable();
  }

  it('lists the steps with what is done and opens on the profile', async () => {
    await load();
    expect(steps()).toEqual([
      'Society profile Required',
      'Wings & flats',
      'Residents',
      'Committee & rules',
      'Go live',
    ]);
    expect(el().querySelector('.step.active .label')?.textContent).toContain('Society profile');
    expect(el().querySelectorAll('.step.done').length).toBe(2);
    expect(el().textContent).toContain('Missing address, state, PIN code');
    expect(el().textContent).toContain('3 in the sheet');
    expect(el().querySelector('app-society-profile-form')).not.toBeNull();
  });

  it('keeps go live disabled until the profile is complete', async () => {
    await load();
    el().querySelectorAll<HTMLButtonElement>('.step')[4].click();
    await fixture.whenStable();
    const button = [...el().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes('Go live') && !b.classList.contains('step'),
    );
    expect(button?.disabled).toBe(true);
    expect(el().textContent).toContain('(required)');
  });

  it('goes live after confirming and hands out the sheet links', async () => {
    await load(checklist({ canGoLive: true, profile: { done: true, missing: [] } }));
    el().querySelectorAll<HTMLButtonElement>('.step')[4].click();
    await fixture.whenStable();
    expect(el().textContent).toContain('The 3 residents in your sheet are invited straight away');
    [...el().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Go live') && !b.classList.contains('step'))!
      .click();
    await fixture.whenStable();

    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button'),
    ].find((b) => b.textContent?.includes('Go live'));
    expect(document.body.textContent).toContain(
      'The 3 residents in your sheet get their invitations now',
    );
    confirm!.click();
    await fixture.whenStable();

    http.expectOne('/api/societies/7/go-live').flush({
      onboarding: checklist({
        status: 'LIVE',
        canGoLive: false,
        profile: { done: true, missing: [] },
      }),
      residentInvitations: {
        sent: [
          {
            row: 2,
            flatLabel: 'A-101',
            name: 'Meera',
            phone: '9811100001',
            invitationId: 1,
            token: 'tok',
            inviteUrl: 'http://app/invite/tok',
          },
        ],
        skipped: [],
      },
    });
    await fixture.whenStable();
    // The society switcher reloads (no societies in this test).
    http.match(() => true).forEach((r) => r.flush([]));
    await fixture.whenStable();

    expect(el().textContent).toContain('Lake View is live');
    expect(el().textContent).toContain('1 invitations sent');
    expect(el().textContent).toContain('Links CSV');
  });
});
