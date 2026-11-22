import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';

/** Kept apart from staff-ui so the routes and the nav don't load the staff pages. */

/** Holds a flat of their own in the society (where "My staff" makes sense). */
export function hasOwnFlat(auth: AuthStore, societyId: number | null): boolean {
  return (auth.user()?.roles ?? []).some((r) => r.societyId === societyId && r.flatId != null);
}

/** "My staff" for residents with a flat; the committee uses the directory instead. */
export function canOpenMyStaff(auth: AuthStore, societyId: number | null): boolean {
  return auth.can('STAFF.MEMBER.VIEW', societyId) && hasOwnFlat(auth, societyId);
}

/** A person's page: anyone who sees staff in some way (the backend decides what they see). */
export function canOpenStaff(auth: AuthStore, societyId: number | null): boolean {
  return ['STAFF.MEMBER.VIEW', 'STAFF.DIRECTORY.VIEW', 'STAFF.ENTRY.VIEW', 'STAFF.SOCIETY.MANAGE'].some((p) =>
    auth.can(p, societyId),
  );
}

export const staffGuard: CanMatchFn = () =>
  canOpenStaff(inject(AuthStore), inject(SocietyContextStore).selectedSocietyId()) ||
  inject(Router).createUrlTree(['/forbidden']);
