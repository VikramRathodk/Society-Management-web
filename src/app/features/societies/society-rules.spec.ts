import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';

import { SocietySetting, SocietySettings } from '../../core/models';
import { SocietyRules } from './society-rules';

function settings(overrides: Partial<SocietySetting> = {}): SocietySettings {
  return {
    societyId: 4,
    groups: [
      {
        key: 'MAINTENANCE',
        label: 'Maintenance',
        settings: [
          {
            key: 'tenantsSeeMaintenance',
            label: 'Tenants see maintenance bills',
            description: 'Off: only a flat’s owner and family see its bills.',
            type: 'BOOLEAN',
            value: false,
            defaultValue: false,
            customized: false,
            min: null,
            max: null,
            maxLength: null,
            options: [],
            updatedAt: null,
            updatedById: null,
            ...overrides,
          },
        ],
      },
    ],
  };
}

describe('SocietyRules', () => {
  let fixture: ComponentFixture<SocietyRules>;
  let http: HttpTestingController;
  const url = '/api/societies/4/settings';

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
      HTMLButtonElement | undefined;

  async function setup(initial: SocietySettings): Promise<void> {
    TestBed.configureTestingModule({
      imports: [SocietyRules],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SocietyRules);
    fixture.componentRef.setInput('societyId', 4);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith(url) && r.method === 'GET').flush(initial);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('draws one card per group with a toggle per boolean setting', async () => {
    await setup(settings());
    expect(el().querySelector('app-section h2')?.textContent).toContain('Maintenance');
    expect(el().querySelector('mat-slide-toggle')?.textContent).toContain(
      'Tenants see maintenance bills',
    );
    expect(el().textContent).toContain('Default');
    expect(button('Save')?.disabled).toBe(true);
  });

  it('saves only the changed setting', async () => {
    await setup(settings());
    (el().querySelector('mat-slide-toggle button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(button('Save')?.disabled).toBe(false);

    button('Save')!.click();
    const req = http.expectOne((r) => r.url.endsWith(url) && r.method === 'PATCH');
    expect(req.request.body).toEqual({ tenantsSeeMaintenance: true });
    req.flush(settings({ value: true, customized: true, updatedAt: '2026-11-09T10:00:00Z' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().textContent).toContain('default is Off');
    expect(button('Save')?.disabled).toBe(true);
  });

  it('resets a changed setting to its default', async () => {
    await setup(settings({ value: true, customized: true }));
    button('Reset to default')!.click();
    const req = http.expectOne((r) => r.url.endsWith(url) && r.method === 'PATCH');
    expect(req.request.body).toEqual({ tenantsSeeMaintenance: null });
    req.flush(settings());
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button('Reset to default')).toBeUndefined();
  });

  it('shows the backend message when a change is rejected', async () => {
    await setup(settings());
    (el().querySelector('mat-slide-toggle button') as HTMLButtonElement).click();
    fixture.detectChanges();
    button('Save')!.click();
    http
      .expectOne((r) => r.url.endsWith(url) && r.method === 'PATCH')
      .flush(
        { message: 'Setting tenantsSeeMaintenance must be true or false' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('must be true or false');
  });
});
