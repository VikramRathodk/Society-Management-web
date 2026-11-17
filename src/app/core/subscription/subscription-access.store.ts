import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CanMatchFn, Route } from '@angular/router';

import { SubscriptionApi } from '../api/subscription.api';
import { AuthStore } from '../auth/auth.store';
import { PlanModule, SubscriptionAccess } from '../models';
import { SocietyContextStore } from '../society-context/society-context.store';

/** The platform is never limited by a society's plan (the backend lets it through too). */
const PLATFORM_BILLING = 'PLATFORM.BILLING.VIEW';

/**
 * The selected society's subscription as every member sees it: which paid modules its plan includes
 * (the others are hidden) and whether paid work is paused (the suspension banner). Loaded again
 * when the society changes, and after a payment or a 402.
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionAccessStore {
  private readonly api = inject(SubscriptionApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);

  private readonly _state = signal<SubscriptionAccess | null>(null);
  readonly state = this._state.asReadonly();

  /** Paid work is read-only (suspended or cancelled). */
  readonly readOnly = computed(() => !!this._state()?.readOnly);

  constructor() {
    effect(() => {
      const societyId = this.ctx.selectedSocietyId();
      untracked(() => this.load(societyId));
    });
  }

  /** Whether the module's pages should show: unknown or no billing means yes. */
  allows(module: PlanModule): boolean {
    if (this.auth.canOnPlatform(PLATFORM_BILLING)) return true;
    const state = this._state();
    if (!state || !state.billing) return true;
    return state.modules.includes('ALL') || state.modules.includes(module);
  }

  refresh(): void {
    this.load(this.ctx.selectedSocietyId());
  }

  private load(societyId: number | null): void {
    if (societyId == null || !this.auth.isAuthenticated()) {
      this._state.set(null);
      return;
    }
    this.api.access(societyId).subscribe({
      next: (state) => {
        // A late answer for a society no longer selected is dropped.
        if (this.ctx.selectedSocietyId() === societyId) this._state.set(state);
      },
      error: () => this._state.set(null),
    });
  }
}

/** Route guard: the module's pages only when the society's plan includes it. */
export function planModuleGuard(module: PlanModule): CanMatchFn {
  return (_route: Route) => inject(SubscriptionAccessStore).allows(module);
}
