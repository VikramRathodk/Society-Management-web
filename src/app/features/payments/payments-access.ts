import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';

/** Kept apart from payments-ui so the routes and the nav don't load the payment pages. */

/** "Online payments" setup: the society's secretary (COMMITTEE sees the status). */
export function canOpenPaymentSetup(auth: AuthStore, societyId: number | null): boolean {
  return auth.can('PAYMENT.ACCOUNT.VIEW', societyId);
}

/** The society's online payments report. */
export function canOpenOnlinePayments(auth: AuthStore, societyId: number | null): boolean {
  return auth.can('PAYMENT.ONLINE.VIEW', societyId);
}

export const paymentSetupGuard: CanMatchFn = () =>
  canOpenPaymentSetup(inject(AuthStore), inject(SocietyContextStore).selectedSocietyId()) ||
  inject(Router).createUrlTree(['/forbidden']);

export const onlinePaymentsGuard: CanMatchFn = () =>
  canOpenOnlinePayments(inject(AuthStore), inject(SocietyContextStore).selectedSocietyId()) ||
  inject(Router).createUrlTree(['/forbidden']);
