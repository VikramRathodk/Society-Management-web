import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { Access } from '../models';
import { SocietyContextStore } from './society-context.store';

const VIEW = 'SOCIETY.SETTINGS.VIEW';

describe('SocietyContextStore', () => {
  let http: HttpTestingController;
  let access: Access | null;

  /** Signs in through the real AuthStore so `access` drives its permission checks. */
  async function setup(): Promise<SocietyContextStore> {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const signedIn = firstValueFrom(
      TestBed.inject(AuthStore).login({ phone: '9000000616', password: 'Pass@123' }),
    );
    http.expectOne('/api/auth/login').flush({ token: 'jwt', access });
    http.expectOne('/api/users/me').flush({ user: { id: 7, name: 'Test' }, access });
    await signedIn;
    return TestBed.inject(SocietyContextStore);
  }

  beforeEach(() => {
    localStorage.clear();
    access = null;
  });

  afterEach(() => http.verify());

  it('lists every society for platform-wide viewers', async () => {
    access = { platformRoles: ['SUPER_ADMIN'], platformPermissions: [VIEW], societies: [] };
    const ctx = await setup();
    const done = firstValueFrom(ctx.load());
    http.expectOne('/api/societies').flush([
      { id: 2, name: 'Wakanda Heights', address: null, complexId: null },
      { id: 1, name: 'Avengers Tower', address: null, complexId: null },
    ]);
    await done;
    expect(ctx.societies().map((s) => s.name)).toEqual(['Avengers Tower', 'Wakanda Heights']);
    expect(ctx.selectedSocietyId()).toBe(1);
  });

  it('fetches names only where the user may view the society', async () => {
    access = {
      platformRoles: [],
      platformPermissions: [],
      societies: [
        { societyId: 1, roles: ['SECRETARY'], permissions: [VIEW] },
        { societyId: 3, roles: ['RESIDENT'], permissions: [] },
      ],
    };
    const ctx = await setup();
    const done = firstValueFrom(ctx.load());
    http.expectOne('/api/societies/1').flush({ id: 1, name: 'Avengers Tower' });
    await done;
    expect(ctx.societies()).toEqual([
      { id: 1, name: 'Avengers Tower' },
      { id: 3, name: 'Society #3' },
    ]);
  });

  it('keeps a stored selection that is still valid', async () => {
    localStorage.setItem('sm.societyId', '3');
    access = {
      platformRoles: [],
      platformPermissions: [],
      societies: [
        { societyId: 1, roles: [], permissions: [] },
        { societyId: 3, roles: [], permissions: [] },
      ],
    };
    const ctx = await setup();
    await firstValueFrom(ctx.load());
    expect(ctx.selectedSocietyId()).toBe(3);
  });

  it('replaces a stored selection the user no longer has', async () => {
    localStorage.setItem('sm.societyId', '9');
    access = {
      platformRoles: [],
      platformPermissions: [],
      societies: [{ societyId: 1, roles: [], permissions: [] }],
    };
    const ctx = await setup();
    await firstValueFrom(ctx.load());
    expect(ctx.selectedSocietyId()).toBe(1);
    expect(localStorage.getItem('sm.societyId')).toBe('1');
  });

  it('falls back to placeholders when the list request fails', async () => {
    access = {
      platformRoles: [],
      platformPermissions: [VIEW],
      societies: [{ societyId: 4, roles: [], permissions: [] }],
    };
    const ctx = await setup();
    const done = firstValueFrom(ctx.load());
    http.expectOne('/api/societies').flush(null, { status: 500, statusText: 'Server Error' });
    await done;
    expect(ctx.societies()).toEqual([{ id: 4, name: 'Society #4' }]);
  });
});
