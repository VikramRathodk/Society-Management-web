import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
  booleanAttribute,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import {
  Observable,
  catchError,
  combineLatest,
  filter,
  forkJoin,
  interval,
  map,
  of,
  switchMap,
  tap,
} from 'rxjs';

import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ParkingApi } from '../../core/api/parking.api';
import { StaffApi } from '../../core/api/staff.api';
import { SubscriptionAccessStore } from '../../core/subscription/subscription-access.store';
import { parkVisitorDialog } from '../parking/parking-ui';
import { VisitorApi } from '../../core/api/visitor.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Visitor, VisitorStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton } from '../../shared/ui';
import { VisitorActions, VisitorPhotos, VisitorRow, timeAgo } from './visitor-ui';

/** Each lane holds at most this many; a gate rarely has more in one state at once. */
const LANE_SIZE = 100;
const REFRESH_MS = 15_000;

interface Lane {
  status: VisitorStatus;
  title: string;
  hint: string;
  icon: string;
  empty: string;
}

/** In the order a guard works: let approved people in, chase the waiting, see off those inside. */
const LANES: Lane[] = [
  {
    status: 'APPROVED',
    title: 'Let in',
    hint: 'Approved by the flat',
    icon: 'how_to_reg',
    empty: 'No one approved and waiting.',
  },
  {
    status: 'PENDING',
    title: 'Waiting on residents',
    hint: 'Longest wait first',
    icon: 'hourglass_top',
    empty: 'Nobody is waiting for approval.',
  },
  {
    status: 'ENTERED',
    title: 'Inside now',
    hint: 'Mark them out as they leave',
    icon: 'door_open',
    empty: 'No visitors inside.',
  },
];

/**
 * Gate mode: the guard's screen. Three live lanes with large actions, a search across all of them,
 * and a big "Log visitor". Used as the /gate page and as the home screen for gate staff
 * (`embedded` drops the page header, which the dashboard draws itself).
 */
@Component({
  selector: 'app-gate-board',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    Skeleton,
    VisitorRow,
  ],
  providers: [VisitorPhotos],
  template: `
    @if (!embedded()) {
      <app-page-header title="Gate" [subtitle]="society()" />
    }

    <div class="bar">
      @if (canLog()) {
        <a mat-flat-button class="big log" routerLink="/visitors/new">
          <mat-icon>person_add</mat-icon>
          Log visitor
        </a>
      }
      @if (canStaff()) {
        <a mat-stroked-button class="big" routerLink="/gate/staff">
          <mat-icon>how_to_reg</mat-icon>
          Staff{{ staffInside() != null ? ' · ' + staffInside() + ' inside' : '' }}
        </a>
      }
      <mat-form-field appearance="outline" class="search" subscriptSizing="dynamic">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Find by name, flat or phone</mat-label>
        <input matInput type="search" [value]="search()" (input)="onSearch($event)" />
      </mat-form-field>
      <span class="live" aria-live="polite">
        <span class="dot" [class.stale]="stale()"></span>
        {{ stale() ? "Couldn't refresh" : 'Live' }} · {{ updatedLabel() }}
      </span>
    </div>

    @if (loading()) {
      <app-skeleton variant="list" [count]="4" />
    } @else if (loadError()) {
      <app-empty-state icon="cloud_off" message="Couldn't load the gate.">
        <button mat-stroked-button (click)="retry()">Try again</button>
      </app-empty-state>
    } @else {
      <div class="lanes">
        @for (lane of lanes; track lane.status) {
          <section class="lane" [attr.data-status]="lane.status" [attr.aria-label]="lane.title">
            <header>
              <span class="lane-icon"
                ><mat-icon aria-hidden="true">{{ lane.icon }}</mat-icon></span
              >
              <div>
                <h2>
                  {{ lane.title }} <span class="count">{{ shown(lane.status).length }}</span>
                </h2>
                <p>{{ lane.hint }}</p>
              </div>
            </header>
            @for (v of shown(lane.status); track v.id) {
              <app-visitor-row [visitor]="v" compact>
                @if (canParkVisitors()) {
                  @if (parkedIn().get(v.id); as slot) {
                    <span class="parked" title="Parked"><mat-icon aria-hidden="true">local_parking</mat-icon>{{ slot }}</span>
                  } @else {
                    <button mat-stroked-button class="big" (click)="park(v)" [disabled]="busy().has(v.id)">
                      <mat-icon>local_parking</mat-icon>
                      Park
                    </button>
                  }
                }
                @switch (v.status) {
                  @case ('APPROVED') {
                    @if (actions.can('VISITOR.ENTRY.UPDATE', v)) {
                      <button
                        mat-flat-button
                        class="big"
                        (click)="run(v, actions.enter(v))"
                        [disabled]="busy().has(v.id)"
                      >
                        <mat-icon>login</mat-icon>
                        Let in
                      </button>
                    }
                  }
                  @case ('PENDING') {
                    @if (waited(v); as wait) {
                      <span class="waited">{{ wait }}</span>
                    }
                    @if (actions.canDecide('VISITOR.APPROVAL.REJECT', v)) {
                      <button
                        mat-stroked-button
                        class="big"
                        (click)="run(v, actions.reject(v))"
                        [disabled]="busy().has(v.id)"
                      >
                        Reject
                      </button>
                    }
                    @if (actions.canDecide('VISITOR.APPROVAL.APPROVE', v)) {
                      <button
                        mat-flat-button
                        class="big"
                        (click)="run(v, actions.approve(v))"
                        [disabled]="busy().has(v.id)"
                      >
                        Approve
                      </button>
                    }
                  }
                  @case ('ENTERED') {
                    @if (actions.can('VISITOR.ENTRY.UPDATE', v)) {
                      <button
                        mat-stroked-button
                        class="big"
                        (click)="run(v, actions.exit(v))"
                        [disabled]="busy().has(v.id)"
                      >
                        <mat-icon>logout</mat-icon>
                        Mark exit
                      </button>
                    }
                  }
                }
              </app-visitor-row>
            } @empty {
              <p class="quiet">{{ search() ? 'No matches.' : lane.empty }}</p>
            }
          </section>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 16px;
      margin-bottom: 20px;
    }
    .big {
      --mat-button-filled-container-height: 48px;
      --mat-button-outlined-container-height: 48px;
      min-width: 112px;
      padding-inline: 20px;
      font-size: 1rem;
    }
    .log {
      --mat-button-filled-container-height: 56px;
      padding-inline: 28px;
      font-size: 1.05rem;
    }
    .search {
      flex: 1 1 260px;
      max-width: 420px;
    }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--app-success);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-success) 25%, transparent);
    }
    .dot.stale {
      background: var(--app-warning);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-warning) 25%, transparent);
    }
    .lanes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
      gap: 16px;
      align-items: start;
    }
    .lane {
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      overflow: hidden;
    }
    .lane header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px 12px;
    }
    .lane-icon {
      display: grid;
      flex: none;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    [data-status='APPROVED'] .lane-icon {
      background: var(--app-success-container);
      color: var(--app-success);
    }
    [data-status='PENDING'] .lane-icon {
      background: var(--app-warning-container);
      color: var(--app-warning);
    }
    [data-status='ENTERED'] .lane-icon {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-family: var(--app-font-display);
      font-size: 1.15rem;
      font-weight: 500;
    }
    .count {
      min-width: 24px;
      padding: 0 8px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-large);
      text-align: center;
    }
    header p {
      margin: 2px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    app-visitor-row {
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .parked {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 12px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      font: var(--mat-sys-label-large);
      white-space: nowrap;
    }
    .parked mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }
    .waited {
      color: var(--app-warning);
      font: var(--mat-sys-label-large);
      white-space: nowrap;
    }
    .quiet {
      margin: 0;
      padding: 20px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    @media (max-width: 599.98px) {
      .log {
        flex: 1 1 100%;
      }
      .search {
        max-width: none;
      }
      .live {
        margin-left: 0;
      }
    }
  `,
})
export class GateBoard {
  private readonly api = inject(VisitorApi);
  private readonly staffApi = inject(StaffApi);
  private readonly parkingApi = inject(ParkingApi);
  private readonly plan = inject(SubscriptionAccessStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  protected readonly actions = inject(VisitorActions);

  /** Inside the dashboard: no page header of its own. */
  readonly embedded = input(false, { transform: booleanAttribute });

  protected readonly lanes = LANES;
  protected readonly society = computed(() => this.ctx.selectedSociety()?.name ?? null);
  protected readonly canLog = computed(() =>
    this.auth.can('VISITOR.ENTRY.CREATE', this.ctx.selectedSocietyId()),
  );
  protected readonly canStaff = computed(() =>
    this.auth.can('STAFF.ENTRY.VIEW', this.ctx.selectedSocietyId()),
  );
  /** How many staff are inside, for the link to the staff gate; null until known. */
  protected readonly staffInside = signal<number | null>(null);
  /** Parking in the plan and the permission to put visitors in visitor slots. */
  protected readonly canParkVisitors = computed(
    () => this.plan.allows('PARKING') && this.auth.can('PARKING.VISITOR.UPDATE', this.ctx.selectedSocietyId()),
  );
  /** Visitor id → the visitor slot they are parked in. */
  protected readonly parkedIn = signal<ReadonlyMap<number, string>>(new Map());

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  /** A background refresh failed; what's shown may be out of date. */
  protected readonly stale = signal(false);
  protected readonly search = signal('');
  protected readonly busy = signal<ReadonlySet<number>>(new Set());
  private readonly visitors = signal<Visitor[]>([]);
  private readonly updatedAt = signal<number | null>(null);
  private readonly now = signal(Date.now());
  private readonly attempt = signal(0);

  protected readonly updatedLabel = computed(() => {
    const at = this.updatedAt();
    if (at == null) return 'not yet updated';
    const seconds = Math.round((this.now() - at) / 1000);
    return seconds < 10 ? 'just now' : `updated ${timeAgo(new Date(at).toISOString(), this.now())}`;
  });

  private readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) return this.visitors();
    return this.visitors().filter((v) =>
      [v.visitorName, v.flatNumber, v.visitorPhone, v.purpose].some((field) =>
        field?.toLowerCase().includes(query),
      ),
    );
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    combineLatest([toObservable(this.ctx.selectedSocietyId), toObservable(this.attempt)])
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadError.set(false);
        }),
        switchMap(([societyId]) => this.fetch(societyId, false)),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loading.set(false);
        if (list) this.apply(list);
        else this.loadError.set(true);
      });

    // Quiet refresh while the tab is visible; a failure keeps what's shown and flags it as stale.
    interval(REFRESH_MS)
      .pipe(
        tap(() => this.now.set(Date.now())),
        filter(
          () => !this.loading() && !this.loadError() && document.visibilityState === 'visible',
        ),
        switchMap(() => this.fetch(this.ctx.selectedSocietyId(), true)),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((list) => {
        if (list) this.apply(list);
        else this.stale.set(true);
      });
  }

  /** Lane contents: pending oldest first (longest wait on top), the others newest first. */
  protected shown(status: VisitorStatus): Visitor[] {
    const list = this.filtered().filter((v) => v.status === status);
    return status === 'PENDING' ? [...list].reverse() : list;
  }

  /** "waiting 12 min" for the last hour; older entries already show their time, so nothing. */
  protected waited(v: Visitor): string {
    if (!v.loggedAt) return '';
    const minutes = Math.floor(Math.max(0, this.now() - new Date(v.loggedAt).getTime()) / 60_000);
    if (minutes >= 60) return '';
    return minutes < 1 ? 'just arrived' : `waiting ${minutes} min`;
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  /** Runs an action; the updated row moves to its new lane (or drops off once exited/rejected). */
  protected run(visitor: Visitor, action: Observable<Visitor | null>): void {
    this.setBusy(visitor.id, true);
    action.subscribe({
      next: (updated) => {
        if (updated) {
          this.visitors.update((list) => list.map((v) => (v.id === updated.id ? updated : v)));
        }
      },
      complete: () => this.setBusy(visitor.id, false),
      error: () => this.setBusy(visitor.id, false),
    });
  }

  private refreshStaff(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (!this.canStaff() || societyId == null) return;
    this.staffApi
      .inside(societyId, { silent: true })
      .pipe(catchError(() => of(null)))
      .subscribe((list) => {
        if (list) this.staffInside.set(list.length);
      });
  }

  private refreshParking(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (!this.canParkVisitors() || societyId == null) return;
    this.parkingApi
      .visitorSlots(societyId, { silent: true })
      .pipe(catchError(() => of(null)))
      .subscribe((slots) => {
        if (!slots) return;
        this.parkedIn.set(new Map(slots.filter((s) => s.parking).map((s) => [s.parking!.visitorId, s.slotNumber])));
      });
  }

  /** Puts the visitor in a free visitor slot (picked in a dialog). */
  protected park(v: Visitor): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    parkVisitorDialog(this.dialog, {
      societyId,
      visitorId: v.id,
      visitorName: v.visitorName,
      flatNumber: v.flatNumber,
      vehicleNumber: v.vehicleNumber ?? null,
    }).subscribe((p) => {
      this.parkedIn.update((m) => new Map(m).set(v.id, p.slotNumber));
      this.snack.open(`${v.visitorName} parked in ${p.slotNumber}`, undefined, { duration: 2500 });
    });
  }

  private apply(list: Visitor[]): void {
    this.refreshStaff();
    this.refreshParking();
    this.visitors.set(list);
    this.updatedAt.set(Date.now());
    this.now.set(Date.now());
    this.stale.set(false);
  }

  /** All three lanes at once; null if any part failed, so a lane never looks wrongly empty. */
  private fetch(societyId: number | null, silent: boolean): Observable<Visitor[] | null> {
    const lane = (status: VisitorStatus) =>
      this.api.list({ societyId, status, page: 0, size: LANE_SIZE }, { silent });
    return forkJoin(LANES.map((l) => lane(l.status))).pipe(
      map((lists) => lists.flat()),
      catchError(() => of(null)),
    );
  }

  private setBusy(id: number, busy: boolean): void {
    this.busy.update((ids) => {
      const next = new Set(ids);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
