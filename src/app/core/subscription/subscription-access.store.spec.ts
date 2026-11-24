import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { Access, SubscriptionAccess } from '../models';
import { SocietyContextStore } from '../society-context/society-context.store';
import { SubscriptionAccessStore } from './subscription-access.store';

const BASIC: SubscriptionAccess = {
  billing: true,
  status: 'ACTIVE',
  planName: 'Basic',
  modules: ['MAINTENANCE'],
  readOnly: false,
  overdueInvoiceId: null,
  overdueInvoiceNumber: null,
  overdueBalance: null,
  overdueSince: null,
};

describe('SubscriptionAccessStore', () => {
  let http: HttpTestingController;

  async function setup(access: Access): Promise<SubscriptionAccessStore> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const signedIn = firstValueFrom(
      TestBed.inject(AuthStore).login({ phone: '9000000616', password: 'Pass@123' }),
    );
    http.expectOne('/api/auth/login').flush({ token: 'jwt', access });
    http.expectOne('/api/users/me').flush({ user: { id: 7, name: 'Test', roles: [] }, access });
    await signedIn;
    TestBed.inject(SocietyContextStore).select(3);
    const store = TestBed.inject(SubscriptionAccessStore);
    TestBed.tick();
    return store;
  }

  afterEach(() => http.verify());

  it('allows everything until it knows, then only the plan’s paid modules', async () => {
    const store = await setup({
      platformRoles: [],
      platformPermissions: [],
      societies: [{ societyId: 3, roles: ['SECRETARY'], permissions: [] }],
    });
    expect(store.allows('FINANCE')).toBe(true);
    http.expectOne('/api/societies/3/subscription/access').flush(BASIC);
    expect(store.allows('MAINTENANCE')).toBe(true);
    expect(store.allows('FINANCE')).toBe(false);
    expect(store.readOnly()).toBe(false);

    store.refresh();
    http
      .expectOne('/api/societies/3/subscription/access')
      .flush({ ...BASIC, modules: ['ALL'], status: 'SUSPENDED', readOnly: true });
    expect(store.allows('GOVERNANCE')).toBe(true);
    expect(store.readOnly()).toBe(true);
  });

  it('never limits the platform, and allows everything without billing', async () => {
    const store = await setup({
      platformRoles: ['SUPER_ADMIN'],
      platformPermissions: ['PLATFORM.BILLING.VIEW'],
      societies: [{ societyId: 3, roles: [], permissions: [] }],
    });
    http.expectOne('/api/societies/3/subscription/access').flush(BASIC);
    expect(store.allows('FINANCE')).toBe(true);
  });

  it('treats a society without billing as unlimited', async () => {
    const store = await setup({
      platformRoles: [],
      platformPermissions: [],
      societies: [{ societyId: 3, roles: ['RESIDENT'], permissions: [] }],
    });
    http
      .expectOne('/api/societies/3/subscription/access')
      .flush({ ...BASIC, billing: false, modules: [] });
    expect(store.allows('POLICIES')).toBe(true);
  });
});
