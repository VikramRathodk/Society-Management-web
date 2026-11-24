import { Injectable, computed, inject } from '@angular/core';

import { AuthStore } from '../../core/auth/auth.store';
import { PlanModule } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { SubscriptionAccessStore } from '../../core/subscription/subscription-access.store';

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** "2026-11" → "Nov 26". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return MONTH.format(new Date(y, m - 1, 1));
}

/** "2026-11-24" → "24 Nov". */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return DAY.format(new Date(y, m - 1, d));
}

/**
 * Which Stats sections the signed-in user may see in the selected society: the permission each
 * module uses, held for the whole society (a role without a flat, or platform-wide), and the module
 * in the society's plan. The backend has the final say; this only avoids asking for what would be refused.
 */
@Injectable({ providedIn: 'root' })
export class StatsAccess {
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly plan = inject(SubscriptionAccessStore);

  private societyWide(permission: string, module?: PlanModule): boolean {
    if (module && !this.plan.allows(module)) return false;
    if (this.auth.canOnPlatform(permission)) return true;
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || !this.auth.can(permission, societyId)) return false;
    return (this.auth.user()?.roles ?? []).some((r) => r.societyId === societyId && r.flatId == null);
  }

  readonly maintenance = computed(() => this.societyWide('MAINTENANCE.BILL.VIEW', 'MAINTENANCE'));
  readonly finance = computed(() => this.societyWide('FINANCE.REPORT.VIEW', 'FINANCE'));
  readonly complaints = computed(() => this.societyWide('COMPLAINT.TICKET.VIEW'));
  readonly visitors = computed(() => this.societyWide('VISITOR.HISTORY.VIEW'));
  readonly staff = computed(() => this.societyWide('STAFF.DIRECTORY.VIEW'));
  readonly parking = computed(() => this.societyWide('PARKING.ADMIN.VIEW', 'PARKING'));
  readonly money = computed(() => this.maintenance() || this.finance());
  readonly operations = computed(
    () => this.complaints() || this.visitors() || this.staff() || this.parking(),
  );
  /** Shown in the sidebar when at least one section is open to the user. */
  readonly any = computed(() => this.money() || this.operations());
}

/** For the sidebar, which builds its items before any component exists. */
export function canOpenStats(auth: AuthStore, societyId: number | null): boolean {
  if (societyId == null) return false;
  const codes = [
    'MAINTENANCE.BILL.VIEW',
    'FINANCE.REPORT.VIEW',
    'COMPLAINT.TICKET.VIEW',
    'VISITOR.HISTORY.VIEW',
    'STAFF.DIRECTORY.VIEW',
    'PARKING.ADMIN.VIEW',
  ];
  const held = codes.some((c) => auth.canOnPlatform(c) || auth.can(c, societyId));
  const societyRole = (auth.user()?.roles ?? []).some((r) => r.societyId === societyId && r.flatId == null);
  return held && (societyRole || codes.some((c) => auth.canOnPlatform(c)));
}
