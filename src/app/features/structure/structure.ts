import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, catchError, filter, finalize, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { ComplaintApi } from '../../core/api/complaint.api';
import { StructureApi } from '../../core/api/structure.api';
import { UserApi } from '../../core/api/user.api';
import { VisitorApi } from '../../core/api/visitor.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { Complaint, Flat, User, Visitor, Wing } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { nameDialog } from '../../shared/name-dialog';
import { sortBy } from '../../shared/sort';
import { EmptyState, PageHeader, Skeleton } from '../../shared/ui';
import {
  BuildingGrid,
  EMPTY_INFO,
  FlatInfo,
  FlatPanel,
  OVERLAYS,
  Overlay,
  groupByFloor,
} from './structure-ui';

/** The list endpoints cap a page at this many items. */
const PAGE = 100;

interface Activity {
  users: User[];
  complaints: Complaint[];
  visitors: Visitor[];
  /** Some list hit the page cap, so counts may be incomplete. */
  capped: boolean;
}

const NO_ACTIVITY: Activity = { users: [], complaints: [], visitors: [], capped: false };

/**
 * Building view of the selected society: one wing at a time, drawn floor by floor, with flats
 * coloured by residents, open complaints or visitors waiting. Picking a flat opens its details.
 */
@Component({
  selector: 'app-structure',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatMenuModule,
    Skeleton,
    MatTooltipModule,
    HasPermission,
    EmptyState,
    PageHeader,
    BuildingGrid,
    FlatPanel,
  ],
  templateUrl: './structure.html',
  styleUrl: './structure.scss',
})
export class Structure {
  private readonly api = inject(StructureApi);
  private readonly users = inject(UserApi);
  private readonly complaints = inject(ComplaintApi);
  private readonly visitors = inject(VisitorApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly overlays = OVERLAYS;

  protected readonly wings = signal<Wing[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  private readonly attempt = signal(0);
  /** Flats per wing id; a wing has no entry until it is first shown. */
  protected readonly flats = signal<ReadonlyMap<number, Flat[]>>(new Map());
  protected readonly loadingFlats = signal<ReadonlySet<number>>(new Set());
  /** Wings whose last flats request failed. */
  protected readonly failedFlats = signal<ReadonlySet<number>>(new Set());

  protected readonly selectedWingId = signal<number | null>(null);
  protected readonly selectedFlatId = signal<number | null>(null);
  protected readonly activity = signal<Activity>(NO_ACTIVITY);

  private readonly can = (permission: string) =>
    this.auth.can(permission, this.ctx.selectedSocietyId());

  /** Overlays the viewer may see, in toggle order. */
  protected readonly available = computed<Overlay[]>(() => {
    const list: Overlay[] = [];
    if (this.can('USER.ACCOUNT.VIEW')) list.push('residents');
    if (this.can('COMPLAINT.TICKET.VIEW')) list.push('complaints');
    if (this.can('VISITOR.ENTRY.VIEW')) list.push('visitors');
    return list;
  });
  private readonly chosenOverlay = signal<Overlay | null>(null);
  protected readonly overlay = computed(() => {
    const chosen = this.chosenOverlay();
    const available = this.available();
    return chosen && available.includes(chosen) ? chosen : (available[0] ?? null);
  });

  protected readonly selectedWing = computed(
    () => this.wings().find((w) => w.id === this.selectedWingId()) ?? null,
  );
  protected readonly wingFlats = computed(() => {
    const wing = this.selectedWing();
    return wing ? (this.flats().get(wing.id) ?? null) : null;
  });
  protected readonly selectedFlat = computed(
    () => this.wingFlats()?.find((f) => f.id === this.selectedFlatId()) ?? null,
  );

  protected readonly wingSummary = computed(() => {
    const flats = this.wingFlats();
    if (!flats) return null;
    const floors = groupByFloor(flats).filter((r) => r.floor !== null).length;
    const parts = [`${flats.length} ${flats.length === 1 ? 'flat' : 'flats'}`];
    if (floors) parts.push(`${floors} ${floors === 1 ? 'floor' : 'floors'}`);
    return parts.join(' · ');
  });

  /** Residents, complaints and waiting visitors keyed by flat id. */
  protected readonly info = computed<ReadonlyMap<number, FlatInfo>>(() => {
    const societyId = this.ctx.selectedSocietyId();
    const { users, complaints, visitors } = this.activity();
    const map = new Map<number, FlatInfo>();
    const entry = (flatId: number) => {
      let info = map.get(flatId);
      if (!info) map.set(flatId, (info = { residents: [], complaints: [], visitors: [] }));
      return info;
    };
    for (const user of users) {
      const seen = new Set<number>();
      for (const role of user.roles) {
        if (role.flatId == null || role.societyId !== societyId || seen.has(role.flatId)) continue;
        seen.add(role.flatId);
        entry(role.flatId).residents.push({
          userId: user.id,
          name: user.name,
          isActive: user.isActive,
          residentType: role.residentType,
        });
      }
    }
    for (const c of complaints) entry(c.flatId).complaints.push(c);
    for (const v of visitors) entry(v.flatId).visitors.push(v);
    return map;
  });

  protected readonly selectedInfo = computed(() => {
    const flat = this.selectedFlat();
    return (flat && this.info().get(flat.id)) || EMPTY_INFO;
  });

  protected readonly subtitle = computed(() => {
    const society = this.ctx.selectedSociety()?.name;
    const n = this.wings().length;
    const count = this.loading() ? null : `${n} ${n === 1 ? 'wing' : 'wings'}`;
    return [count, society].filter(Boolean).join(' · ') || null;
  });

  constructor() {
    const reload = computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const);

    toObservable(reload)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.flats.set(new Map());
          this.failedFlats.set(new Set());
          this.selectedFlatId.set(null);
        }),
        switchMap(([societyId]) =>
          societyId == null ? of([]) : this.api.wings(societyId).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((wings) => {
        this.loadError.set(wings === null);
        const sorted = sortBy(wings ?? [], (w) => w.name);
        this.wings.set(sorted);
        if (!sorted.some((w) => w.id === this.selectedWingId())) {
          this.selectedWingId.set(sorted[0]?.id ?? null);
        }
        this.loading.set(false);
      });

    toObservable(reload)
      .pipe(
        tap(() => this.activity.set(NO_ACTIVITY)),
        switchMap(([societyId]) =>
          societyId == null ? of(NO_ACTIVITY) : this.loadActivity(societyId),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((activity) => this.activity.set(activity));

    // Show the selected wing's flats as soon as it's picked.
    effect(() => {
      const wing = this.selectedWing();
      if (wing) untracked(() => this.loadFlats(wing));
    });

    // Deep link from the command palette: /structure?wing=10&flat=3. Applied once the wing list is
    // in, then dropped from the URL so later wing changes don't snap back to it.
    effect(() => {
      const request = this.linked();
      const wings = this.wings();
      if (!request || this.loading()) return;
      untracked(() => {
        if (wings.some((w) => w.id === request.wing)) {
          this.selectedWingId.set(request.wing);
          this.selectedFlatId.set(request.flat);
        }
        this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      });
    });
  }

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly linked = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => {
        const wing = Number(params.get('wing'));
        const flat = Number(params.get('flat'));
        return wing ? { wing, flat: flat || null } : null;
      }),
    ),
  );

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected selectWing(wing: Wing): void {
    if (wing.id === this.selectedWingId()) return;
    this.selectedWingId.set(wing.id);
    this.selectedFlatId.set(null);
  }

  protected setOverlay(overlay: Overlay): void {
    this.chosenOverlay.set(overlay);
  }

  protected pickFlat(flat: Flat): void {
    this.selectedFlatId.update((id) => (id === flat.id ? null : flat.id));
  }

  /** Each source is optional: a failure or a missing permission just leaves that overlay empty. */
  private loadActivity(societyId: number): Observable<Activity> {
    const available = this.available();
    const empty = <T>() => of<T[]>([]);
    const users = available.includes('residents')
      ? this.users.list(societyId).pipe(catchError(() => empty<User>()))
      : empty<User>();
    const complaints = available.includes('complaints')
      ? forkJoin(
          (['OPEN', 'IN_PROGRESS'] as const).map((status) =>
            this.complaints
              .list({ societyId, status, size: PAGE }, { silent: true })
              .pipe(catchError(() => empty<Complaint>())),
          ),
        )
      : of([[], []] as Complaint[][]);
    const visitors = available.includes('visitors')
      ? this.visitors
          .list({ societyId, status: 'PENDING', size: PAGE }, { silent: true })
          .pipe(catchError(() => empty<Visitor>()))
      : empty<Visitor>();
    return forkJoin([users, complaints, visitors]).pipe(
      map(([u, [open, inProgress], v]) => ({
        users: u,
        complaints: [...open, ...inProgress],
        visitors: v,
        capped: [open, inProgress, v].some((list) => list.length >= PAGE),
      })),
    );
  }

  protected loadFlats(wing: Wing): void {
    if (this.flats().has(wing.id) || this.loadingFlats().has(wing.id)) return;
    this.loadingFlats.update((ids) => new Set(ids).add(wing.id));
    this.failedFlats.update((ids) => {
      const next = new Set(ids);
      next.delete(wing.id);
      return next;
    });
    this.api
      .flats(wing.id)
      .pipe(
        finalize(() =>
          this.loadingFlats.update((ids) => {
            const next = new Set(ids);
            next.delete(wing.id);
            return next;
          }),
        ),
      )
      .subscribe({
        next: (flats) => this.setFlats(wing.id, flats),
        // Reported by the error interceptor; the page offers a retry.
        error: () => this.failedFlats.update((ids) => new Set(ids).add(wing.id)),
      });
  }

  protected addWing(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    nameDialog(this.dialog, {
      title: 'Add wing',
      label: 'Wing name',
      confirmText: 'Add',
      save: (name) => this.api.createWing(societyId, name),
    }).subscribe((wing) => {
      this.wings.update((list) => sortBy([...list, wing], (w) => w.name));
      this.setFlats(wing.id, []);
      this.selectWing(wing);
    });
  }

  protected renameWing(wing: Wing): void {
    nameDialog(this.dialog, {
      title: 'Rename wing',
      label: 'Wing name',
      value: wing.name,
      save: (name) => this.api.updateWing(wing.id, name),
    }).subscribe((updated) =>
      this.wings.update((list) =>
        sortBy(
          list.map((w) => (w.id === updated.id ? updated : w)),
          (w) => w.name,
        ),
      ),
    );
  }

  protected deleteWing(wing: Wing): void {
    confirmDialog(this.dialog, {
      title: 'Delete wing',
      message: `Delete wing "${wing.name}"?`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.deleteWing(wing.id)),
      )
      .subscribe({
        next: () => {
          const rest = this.wings().filter((w) => w.id !== wing.id);
          this.wings.set(rest);
          if (this.selectedWingId() === wing.id) {
            this.selectedWingId.set(rest[0]?.id ?? null);
            this.selectedFlatId.set(null);
          }
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  protected addFlat(wing: Wing): void {
    nameDialog(this.dialog, {
      title: `Add flat to ${wing.name}`,
      label: 'Flat number',
      confirmText: 'Add',
      save: (flatNumber) => this.api.createFlat(wing.id, flatNumber),
    }).subscribe((flat) => {
      this.setFlats(wing.id, [...(this.flats().get(wing.id) ?? []), flat]);
      this.selectedFlatId.set(flat.id);
    });
  }

  protected renameFlat(wing: Wing, flat: Flat): void {
    nameDialog(this.dialog, {
      title: 'Rename flat',
      label: 'Flat number',
      value: flat.flatNumber,
      save: (flatNumber) => this.api.updateFlat(flat.id, flatNumber),
    }).subscribe((updated) =>
      this.setFlats(
        wing.id,
        (this.flats().get(wing.id) ?? []).map((f) => (f.id === updated.id ? updated : f)),
      ),
    );
  }

  protected deleteFlat(wing: Wing, flat: Flat): void {
    confirmDialog(this.dialog, {
      title: 'Delete flat',
      message: `Delete flat ${flat.flatNumber} from ${wing.name}?`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.deleteFlat(flat.id)),
      )
      .subscribe({
        next: () => {
          this.setFlats(
            wing.id,
            (this.flats().get(wing.id) ?? []).filter((f) => f.id !== flat.id),
          );
          if (this.selectedFlatId() === flat.id) this.selectedFlatId.set(null);
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  private setFlats(wingId: number, flats: Flat[]): void {
    this.flats.update((map) =>
      new Map(map).set(
        wingId,
        sortBy(flats, (f) => f.flatNumber),
      ),
    );
  }
}
