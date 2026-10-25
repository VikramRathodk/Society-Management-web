import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { Access, LoginResponse, MeResponse } from '../models';
import { AuthStore } from './auth.store';

const access: Access = {
  platformRoles: [],
  platformPermissions: ['SYSTEM.ROLE.VIEW'],
  societies: [
    { societyId: 1, roles: ['SECRETARY'], permissions: ['USER.ACCOUNT.VIEW'] },
    { societyId: 2, roles: ['RESIDENT'], permissions: ['VISITOR.ENTRY.VIEW'] },
  ],
};

const me: MeResponse = {
  user: { id: 7, name: 'Nick Fury', phone: '9000000616', email: null, isActive: true, roles: [] },
  access,
};

describe('AuthStore', () => {
  let store: AuthStore;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(AuthStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function signIn(): Promise<void> {
    const done = firstValueFrom(store.login({ phone: '9000000616', password: 'Pass@123' }));
    http
      .expectOne('/api/auth/login')
      .flush({ token: 'jwt', userId: 7, name: 'Nick Fury', roles: [], access } as LoginResponse);
    http.expectOne('/api/users/me').flush(me);
    await done;
  }

  it('login stores the token and loads the full profile', async () => {
    await signIn();
    expect(store.isAuthenticated()).toBe(true);
    expect(localStorage.getItem('sm.token')).toBe('jwt');
    expect(store.user()?.phone).toBe('9000000616');
  });

  it('logout clears everything', async () => {
    await signIn();
    store.logout();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(localStorage.getItem('sm.token')).toBeNull();
  });

  it('restore logs out when the stored token is rejected', async () => {
    await signIn();
    const done = firstValueFrom(store.restore());
    http.expectOne('/api/users/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(store.isAuthenticated()).toBe(false);
  });

  describe('can', () => {
    beforeEach(signIn);

    it('checks the given society only', () => {
      expect(store.can('USER.ACCOUNT.VIEW', 1)).toBe(true);
      expect(store.can('USER.ACCOUNT.VIEW', 2)).toBe(false);
    });

    it('checks any society when none is given', () => {
      expect(store.can('VISITOR.ENTRY.VIEW')).toBe(true);
      expect(store.can('FLAT.STRUCTURE.CREATE')).toBe(false);
    });

    it('applies platform permissions in every society', () => {
      expect(store.can('SYSTEM.ROLE.VIEW', 2)).toBe(true);
      expect(store.canOnPlatform('SYSTEM.ROLE.VIEW')).toBe(true);
      expect(store.canOnPlatform('USER.ACCOUNT.VIEW')).toBe(false);
    });
  });
});
