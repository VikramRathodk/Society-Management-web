import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { SocietyContextStore } from '../society-context/society-context.store';
import { AuthStore } from './auth.store';

/** Route data: `{ permission: 'USER.ACCOUNT.VIEW', platform?: true }`. */
export const permissionGuard: CanMatchFn = (route) => {
  const auth = inject(AuthStore);
  const ctx = inject(SocietyContextStore);
  const permission = route.data?.['permission'] as string | undefined;
  const platform = route.data?.['platform'] === true;
  if (!permission) return true;
  const ok = platform
    ? auth.canOnPlatform(permission)
    : auth.can(permission, ctx.selectedSocietyId());
  return ok || inject(Router).createUrlTree(['/forbidden']);
};
