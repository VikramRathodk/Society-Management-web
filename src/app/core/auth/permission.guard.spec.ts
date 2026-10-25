import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { SocietyContextStore } from '../society-context/society-context.store';
import { AuthStore } from './auth.store';
import { permissionGuard, societyPermissionGuard } from './permission.guard';

@Component({ template: '' })
class Page {}

describe('permissionGuard', () => {
  let ctx: SocietyContextStore;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'users',
            component: Page,
            canMatch: [permissionGuard],
            data: { permission: 'USER.ACCOUNT.VIEW' },
          },
          {
            path: 'societies/:id/settings',
            component: Page,
            canActivate: [societyPermissionGuard],
            data: { permission: 'USER.ACCOUNT.VIEW' },
          },
          { path: 'forbidden', component: Page },
        ]),
        {
          provide: AuthStore,
          useValue: {
            can: (permission: string, societyId?: number | null) =>
              permission === 'USER.ACCOUNT.VIEW' && societyId === 1,
            canOnPlatform: () => false,
          },
        },
      ],
    });
    ctx = TestBed.inject(SocietyContextStore);
    router = TestBed.inject(Router);
  });

  it('allows the route in a society that grants the permission', async () => {
    ctx.select(1);
    await RouterTestingHarness.create('/users');
    expect(router.url).toBe('/users');
  });

  it('redirects to /forbidden otherwise', async () => {
    ctx.select(2);
    await RouterTestingHarness.create('/users');
    expect(router.url).toBe('/forbidden');
  });

  it('re-checks when the society changes and the page is reloaded', async () => {
    ctx.select(1);
    const harness = await RouterTestingHarness.create('/users');
    ctx.select(2);
    await router.navigateByUrl(router.url, { onSameUrlNavigation: 'reload' });
    harness.detectChanges();
    expect(router.url).toBe('/forbidden');
  });

  describe('societyPermissionGuard', () => {
    it('checks the society in the URL, not the selected one', async () => {
      ctx.select(2);
      await RouterTestingHarness.create('/societies/1/settings');
      expect(router.url).toBe('/societies/1/settings');
    });

    it('redirects to /forbidden for a society without the permission', async () => {
      ctx.select(1);
      await RouterTestingHarness.create('/societies/2/settings');
      expect(router.url).toBe('/forbidden');
    });
  });
});
