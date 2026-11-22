import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';

/** Kept apart from parking-ui so the routes and the nav don't load the parking pages. */

function hasOwnFlat(auth: AuthStore, societyId: number | null): boolean {
  return (auth.user()?.roles ?? []).some((r) => r.societyId === societyId && r.flatId != null);
}

/** "My parking": residents with a flat here. */
export function canOpenMyParking(auth: AuthStore, societyId: number | null): boolean {
  return auth.can('PARKING.SLOT.VIEW', societyId) && hasOwnFlat(auth, societyId);
}

/** The gate's parking page: vehicle search or visitor slots. */
export function canOpenParkingGate(auth: AuthStore, societyId: number | null): boolean {
  return auth.can('PARKING.GATE.VIEW', societyId);
}

export const myParkingGuard: CanMatchFn = () =>
  canOpenMyParking(inject(AuthStore), inject(SocietyContextStore).selectedSocietyId()) ||
  inject(Router).createUrlTree(['/forbidden']);
