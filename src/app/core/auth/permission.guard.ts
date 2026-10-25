import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Data, Router, UrlTree } from '@angular/router';

import { SocietyContextStore } from '../society-context/society-context.store';
import { AuthStore } from './auth.store';

/** Route data: `{ permission: 'USER.ACCOUNT.VIEW', platform?: true }`. Checks the selected society. */
export const permissionGuard: CanMatchFn = (route) =>
  checkPermission(route.data, inject(SocietyContextStore).selectedSocietyId());

/** Same route data, for routes with a society `:id` param — checks that society instead. */
export const societyPermissionGuard: CanActivateFn = (route) =>
  checkPermission(route.data, Number(route.paramMap.get('id')));

function checkPermission(data: Data | undefined, societyId: number | null): true | UrlTree {
  const auth = inject(AuthStore);
  const permission = data?.['permission'] as string | undefined;
  if (!permission) return true;
  const ok =
    data?.['platform'] === true ? auth.canOnPlatform(permission) : auth.can(permission, societyId);
  return ok || inject(Router).createUrlTree(['/forbidden']);
}
