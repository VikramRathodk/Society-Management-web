import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute } from '@angular/router';
import { Observable, catchError, combineLatest, forkJoin, of, switchMap, tap } from 'rxjs';

import { ParkingApi } from '../../core/api/parking.api';
import { AuthStore } from '../../core/auth/auth.store';
import { ParkingRequest, ParkingSlot, Vehicle, VehicleStatus, Violation, ViolationStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import {
  allotDialog,
  decideDialog,
  inr,
  kindLabel,
  requestState,
  slotDialog,
  slotLabel,
  textDialog,
  vehicleState,
  vehicleTypeIcon,
  vehicleTypeLabel,
  violationState,
} from './parking-ui';

type Tab = 'slots' | 'waitlist' | 'vehicles' | 'reports';
const TABS: Tab[] = ['slots', 'waitlist', 'vehicles', 'reports'];

/**
 * The committee's parking: slots by area (free, allotted, out of use) with allotment and history, the
 * waitlist per vehicle type, vehicles to approve, and wrong-parking reports to decide.
 */
@Component({
  selector: 'app-parking-admin',
  imports: [
    DatePipe,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatTabsModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
  ],
  template: `
    <app-page-header title="Parking" [subtitle]="ctx.selectedSociety()?.name ?? null">
      @if (canExport()) {
        <button mat-stroked-button [matMenuTriggerFor]="exportMenu">
          <mat-icon>download</mat-icon>
          Export
        </button>
        <mat-menu #exportMenu="matMenu">
          <button mat-menu-item (click)="export('allotments')">Allotments</button>
          <button mat-menu-item (click)="export('vehicles')">Vehicles</button>
          <button mat-menu-item (click)="export('violations')">Reports</button>
        </mat-menu>
      }
      @if (canManage()) {
        <button mat-flat-button (click)="addSlots()">
          <mat-icon>add</mat-icon>
          Add slots
        </button>
      }
    </app-page-header>

    <mat-tab-group [selectedIndex]="tabIndex()" (selectedIndexChange)="tabIndex.set($event)" animationDuration="0ms">
      <mat-tab [label]="'Slots (' + slots().length + ')'">
        <div class="toolbar">
          <mat-chip-listbox aria-label="Show" [hideSingleSelectionIndicator]="true" (change)="slotFilter.set($event.value ?? 'all')">
            @for (f of slotFilters; track f.value) {
              <mat-chip-option [value]="f.value" [selected]="slotFilter() === f.value">{{ f.label }}</mat-chip-option>
            }
          </mat-chip-listbox>
          <span class="summary">{{ freeCount() }} free · {{ allottedCount() }} allotted</span>
        </div>
        @if (loading()) {
          <app-skeleton variant="tiles" />
        } @else if (slots().length === 0) {
          <app-empty-state icon="local_parking" message="No parking slots yet.">
            @if (canManage()) {
              <button mat-stroked-button (click)="addSlots()">Add slots, one by one or B1-001 to B1-060</button>
            }
          </app-empty-state>
        } @else {
          @for (group of areas(); track group.area) {
            <section class="area">
              <h2>{{ group.area }}</h2>
              <div class="tiles">
                @for (s of group.slots; track s.id) {
                  <button class="tile" [attr.data-state]="stateOf(s)" [matMenuTriggerFor]="slotMenu" [matMenuTriggerData]="{ s }">
                    <mat-icon aria-hidden="true">{{ s.purpose === 'VISITOR' ? 'emoji_people' : vehicleTypeIcon(s.vehicleType) }}</mat-icon>
                    <strong>{{ s.slotNumber }}</strong>
                    <span>{{ s.current?.flat ?? (s.active ? (s.purpose === 'VISITOR' ? 'Visitors' : 'Free') : 'Out of use') }}</span>
                  </button>
                }
              </div>
            </section>
          }
        }
        <mat-menu #slotMenu="matMenu">
          <ng-template matMenuContent let-s="s">
            <p class="menu-title">{{ s.slotNumber }} · {{ slotLabel(s) }}{{ s.monthlyCharge != null ? ' · ' + inr(s.monthlyCharge) + '/month' : '' }}</p>
            @if (canManage() && s.active && !s.current && s.purpose === 'RESIDENT') {
              <button mat-menu-item (click)="allot(s)"><mat-icon>assignment_ind</mat-icon>Allot</button>
            }
            @if (canManage() && s.current) {
              <button mat-menu-item (click)="release(s)"><mat-icon>assignment_return</mat-icon>Release from {{ s.current.flat }}</button>
            }
            <button mat-menu-item (click)="history(s)"><mat-icon>history</mat-icon>History</button>
            @if (canManage()) {
              <button mat-menu-item (click)="edit(s)"><mat-icon>edit</mat-icon>Edit</button>
              @if (!s.current) {
                <button mat-menu-item (click)="toggleActive(s)">
                  <mat-icon>{{ s.active ? 'block' : 'check_circle' }}</mat-icon>{{ s.active ? 'Take out of use' : 'Put back in use' }}
                </button>
                <button mat-menu-item (click)="remove(s)"><mat-icon>delete</mat-icon>Delete</button>
              }
            }
          </ng-template>
        </mat-menu>
      </mat-tab>

      <mat-tab [label]="'Waitlist (' + waitlist().length + ')'">
        @if (waitlist().length === 0) {
          <app-empty-state icon="hourglass_empty" message="Nobody is waiting for a slot." />
        } @else {
          <div class="list">
            @for (r of waitlist(); track r.id) {
              <div class="row">
                <span class="pos">#{{ r.position }}</span>
                <mat-icon aria-hidden="true">{{ vehicleTypeIcon(r.vehicleType) }}</mat-icon>
                <div class="main">
                  <strong>{{ r.flat }} · {{ vehicleTypeLabel(r.vehicleType) }}{{ r.coveredPreferred ? ', covered if possible' : '' }}</strong>
                  <span class="meta">Asked {{ r.requestedAt | date: 'd MMM y' }} by {{ r.requestedBy.name }}{{ r.note ? ' · ' + r.note : '' }}</span>
                </div>
                @if (canManage()) {
                  <button mat-stroked-button [matMenuTriggerFor]="freeMenu" [matMenuTriggerData]="{ r }" [disabled]="freeFor(r).length === 0">
                    {{ freeFor(r).length ? 'Allot' : 'No free slot' }}
                  </button>
                  <button mat-button (click)="reject(r)">Reject</button>
                }
              </div>
            }
          </div>
        }
        <mat-menu #freeMenu="matMenu">
          <ng-template matMenuContent let-r="r">
            @for (s of freeFor(r); track s.id) {
              <button mat-menu-item (click)="allot(s, r)">{{ s.slotNumber }} · {{ slotLabel(s) }}</button>
            }
          </ng-template>
        </mat-menu>
      </mat-tab>

      <mat-tab [label]="'Vehicles' + (pendingVehicles() ? ' (' + pendingVehicles() + ' to approve)' : '')">
        <div class="toolbar">
          <mat-chip-listbox aria-label="Show" [hideSingleSelectionIndicator]="true" (change)="vehicleStatus.set($event.value ?? null)">
            @for (f of vehicleFilters; track f.label) {
              <mat-chip-option [value]="f.value" [selected]="vehicleStatus() === f.value">{{ f.label }}</mat-chip-option>
            }
          </mat-chip-listbox>
          <mat-form-field appearance="outline" class="search" subscriptSizing="dynamic">
            <mat-icon matPrefix>search</mat-icon>
            <mat-label>Number</mat-label>
            <input matInput [value]="vehicleQuery()" (input)="vehicleQuery.set($any($event.target).value)" />
          </mat-form-field>
        </div>
        @if (shownVehicles().length === 0) {
          <app-empty-state icon="directions_car" message="No vehicles here." />
        } @else {
          <div class="list">
            @for (v of shownVehicles(); track v.id) {
              <div class="row">
                <mat-icon aria-hidden="true">{{ vehicleTypeIcon(v.vehicleType) }}</mat-icon>
                <div class="main">
                  <strong class="plate">{{ v.registrationNumber }}</strong>
                  <span class="meta">
                    {{ v.flat }}{{ v.make ? ' · ' + v.make + ' ' + (v.model ?? '') : '' }}{{ v.colour ? ' · ' + v.colour : '' }}{{
                      v.stickerNumber ? ' · sticker ' + v.stickerNumber : ''
                    }}{{ v.slotNumber ? ' · slot ' + v.slotNumber : '' }}
                  </span>
                </div>
                <app-status-pill [tone]="vehicleState(v.status).tone">{{ vehicleState(v.status).label }}</app-status-pill>
                @if (v.rcUrl) {
                  <button mat-icon-button (click)="openRc(v)" aria-label="View RC"><mat-icon>description</mat-icon></button>
                }
                @if (canApprove() && (v.status === 'PENDING' || v.status === 'REJECTED')) {
                  <button mat-flat-button (click)="approve(v)">Approve</button>
                }
                @if (canApprove() && v.status === 'PENDING') {
                  <button mat-button (click)="rejectVehicle(v)">Reject</button>
                }
              </div>
            }
          </div>
        }
      </mat-tab>

      <mat-tab [label]="'Reports' + (openReports() ? ' (' + openReports() + ' open)' : '')">
        <div class="toolbar">
          <mat-chip-listbox aria-label="Show" [hideSingleSelectionIndicator]="true" (change)="reportStatus.set($event.value ?? null)">
            @for (f of reportFilters; track f.label) {
              <mat-chip-option [value]="f.value" [selected]="reportStatus() === f.value">{{ f.label }}</mat-chip-option>
            }
          </mat-chip-listbox>
        </div>
        @if (shownReports().length === 0) {
          <app-empty-state icon="report" message="No reports here." />
        } @else {
          <div class="list">
            @for (v of shownReports(); track v.id) {
              <div class="row">
                <mat-icon aria-hidden="true">report</mat-icon>
                <div class="main">
                  <strong><span class="plate">{{ v.vehicleNumber }}</span> · {{ kindLabel(v.kind) }}</strong>
                  <span class="meta">
                    {{ v.flat ? 'Flat ' + v.flat : 'Not registered' }}{{ v.flatOffences ? ' · ' + v.flatOffences + ' earlier' : '' }} ·
                    {{ v.slotNumber ?? v.place }} · {{ v.reportedAt | date: 'd MMM, HH:mm' }} by {{ v.reportedBy?.name }}
                  </span>
                  @if (v.reply) {
                    <span class="reply">Flat says: {{ v.reply }}</span>
                  }
                  @if (v.status === 'FINED') {
                    <span class="meta">Fined {{ inr(v.fineAmount) }}</span>
                  }
                </div>
                <app-status-pill [tone]="violationState(v.status).tone">{{ violationState(v.status).label }}</app-status-pill>
                @if (v.photoUrl) {
                  <button mat-icon-button (click)="openPhoto(v)" aria-label="View photo"><mat-icon>photo</mat-icon></button>
                }
                @if (canDecide() && v.status === 'OPEN') {
                  <button mat-flat-button (click)="decide(v)">Decide</button>
                }
              </div>
            }
          </div>
        }
      </mat-tab>
    </mat-tab-group>
  `,
  styles: `
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 16px;
      margin: 16px 0;
    }
    .summary {
      margin-left: auto;
      color: var(--mat-sys-on-surface-variant);
    }
    .search {
      flex: 1 1 200px;
      max-width: 300px;
    }
    .area h2 {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 8px;
    }
    .tile {
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: 10px 6px;
      border: 1px solid var(--app-card-border);
      border-radius: 10px;
      background: var(--mat-sys-surface-container-lowest);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .tile span {
      overflow: hidden;
      max-width: 100%;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tile[data-state='free'] {
      border-color: var(--app-success);
      background: var(--app-success-container);
    }
    .tile[data-state='allotted'] {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .tile[data-state='inactive'] {
      opacity: 0.5;
    }
    .tile[data-state='visitor'] {
      border-style: dashed;
    }
    .menu-title {
      margin: 0;
      padding: 8px 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .list {
      margin-top: 16px;
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      overflow: hidden;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
    }
    .row + .row {
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .main {
      display: grid;
      flex: 1 1 240px;
      min-width: 0;
    }
    .meta {
      color: var(--mat-sys-on-surface-variant);
    }
    .reply {
      font-style: italic;
    }
    .pos {
      min-width: 32px;
      font-weight: 600;
    }
    .plate {
      font-variant-numeric: tabular-nums;
      letter-spacing: 1px;
    }
  `,
})
export class ParkingAdmin {
  private readonly api = inject(ParkingApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly slotLabel = slotLabel;
  protected readonly vehicleTypeIcon = vehicleTypeIcon;
  protected readonly vehicleTypeLabel = vehicleTypeLabel;
  protected readonly requestState = requestState;
  protected readonly vehicleState = vehicleState;
  protected readonly violationState = violationState;
  protected readonly kindLabel = kindLabel;
  protected readonly inr = inr;

  protected readonly slotFilters = [
    { value: 'all', label: 'All' },
    { value: 'free', label: 'Free' },
    { value: 'allotted', label: 'Allotted' },
    { value: 'visitor', label: 'Visitor slots' },
    { value: 'inactive', label: 'Out of use' },
  ];
  protected readonly vehicleFilters: { value: VehicleStatus | null; label: string }[] = [
    { value: 'PENDING', label: 'To approve' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Not approved' },
    { value: null, label: 'All' },
  ];
  protected readonly reportFilters: { value: ViolationStatus | null; label: string }[] = [
    { value: 'OPEN', label: 'Open' },
    { value: 'FINED', label: 'Fined' },
    { value: 'WARNED', label: 'Warned' },
    { value: 'DISMISSED', label: 'Dismissed' },
    { value: null, label: 'All' },
  ];

  protected readonly tabIndex = signal(
    Math.max(0, TABS.indexOf((inject(ActivatedRoute).snapshot.queryParamMap.get('tab') ?? 'slots') as Tab)),
  );
  protected readonly loading = signal(true);
  protected readonly slots = signal<ParkingSlot[]>([]);
  protected readonly waitlist = signal<ParkingRequest[]>([]);
  protected readonly vehicles = signal<Vehicle[]>([]);
  protected readonly reports = signal<Violation[]>([]);
  protected readonly slotFilter = signal('all');
  protected readonly vehicleStatus = signal<VehicleStatus | null>('PENDING');
  protected readonly vehicleQuery = signal('');
  protected readonly reportStatus = signal<ViolationStatus | null>('OPEN');
  private readonly attempt = signal(0);

  private readonly can = (p: string) => this.auth.can(p, this.ctx.selectedSocietyId());
  protected readonly canManage = computed(() => this.can('PARKING.SLOT.MANAGE'));
  protected readonly canExport = computed(() => this.can('PARKING.ADMIN.EXPORT'));
  protected readonly canApprove = computed(() => this.can('PARKING.VEHICLE.APPROVE'));
  protected readonly canDecide = computed(() => this.can('PARKING.VIOLATION.DECIDE'));

  protected readonly freeCount = computed(() => this.slots().filter((s) => this.stateOf(s) === 'free').length);
  protected readonly allottedCount = computed(() => this.slots().filter((s) => !!s.current).length);
  protected readonly pendingVehicles = computed(() => this.vehicles().filter((v) => v.status === 'PENDING').length);
  protected readonly openReports = computed(() => this.reports().filter((v) => v.status === 'OPEN').length);

  /** Slots by area (no area last), each by number, after the chip filter. */
  protected readonly areas = computed(() => {
    const f = this.slotFilter();
    const shown = this.slots().filter((s) => f === 'all' || this.stateOf(s) === f);
    const groups = new Map<string, ParkingSlot[]>();
    for (const s of shown) {
      const key = s.area || 'No area';
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'No area' ? 1 : b === 'No area' ? -1 : a.localeCompare(b)))
      .map(([area, slots]) => ({ area, slots: slots.sort((x, y) => x.slotNumber.localeCompare(y.slotNumber, undefined, { numeric: true })) }));
  });

  protected readonly shownVehicles = computed(() => {
    const status = this.vehicleStatus();
    const q = this.vehicleQuery().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return this.vehicles().filter((v) => (status == null ? v.status !== 'REMOVED' : v.status === status) && (!q || v.registrationNumber.includes(q)));
  });

  protected readonly shownReports = computed(() => {
    const status = this.reportStatus();
    return this.reports().filter((v) => status == null || v.status === status);
  });

  constructor() {
    combineLatest([toObservable(this.ctx.selectedSocietyId), toObservable(this.attempt)])
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) => {
          if (societyId == null) return of(null);
          const settle = <T>(o: Observable<T[]>) => o.pipe(catchError(() => of([] as T[])));
          return forkJoin({
            slots: settle(this.api.slots(societyId)),
            waitlist: settle(this.api.waitlist(societyId)),
            vehicles: settle(this.api.vehicles(societyId, {}, { silent: true })),
            reports: this.can('PARKING.VIOLATION.DECIDE') ? settle(this.api.violations(societyId, null, { silent: true })) : of([] as Violation[]),
          });
        }),
        takeUntilDestroyed(),
      )
      .subscribe((data) => {
        this.loading.set(false);
        if (!data) return;
        this.slots.set(data.slots);
        this.waitlist.set(data.waitlist);
        this.vehicles.set(data.vehicles);
        this.reports.set(data.reports);
      });
  }

  protected stateOf(s: ParkingSlot): string {
    if (!s.active) return 'inactive';
    if (s.current) return 'allotted';
    return s.purpose === 'VISITOR' ? 'visitor' : 'free';
  }

  /** Free resident slots of the request's vehicle type, covered ones first when preferred. */
  protected freeFor(r: ParkingRequest): ParkingSlot[] {
    return this.slots()
      .filter((s) => s.active && !s.current && s.purpose === 'RESIDENT' && s.vehicleType === r.vehicleType)
      .sort((a, b) => (r.coveredPreferred ? Number(b.covered) - Number(a.covered) : 0) || a.slotNumber.localeCompare(b.slotNumber, undefined, { numeric: true }));
  }

  protected reload(): void {
    this.attempt.update((n) => n + 1);
  }

  protected addSlots(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId != null) slotDialog(this.dialog, { societyId }).subscribe(() => this.reload());
  }

  protected edit(s: ParkingSlot): void {
    slotDialog(this.dialog, { societyId: s.societyId, slot: s }).subscribe(() => this.reload());
  }

  protected allot(s: ParkingSlot, request?: ParkingRequest): void {
    allotDialog(this.dialog, { societyId: s.societyId, slot: s, waiting: this.waitlist(), requestId: request?.id }).subscribe(() => {
      this.snack.open(`Slot ${s.slotNumber} allotted`, undefined, { duration: 2500 });
      this.reload();
    });
  }

  protected release(s: ParkingSlot): void {
    confirmDialog(this.dialog, {
      title: `Release slot ${s.slotNumber}?`,
      message: `${s.current?.flat} will no longer hold it, from today. The allotment stays in its history.`,
      confirmText: 'Release',
    })
      .pipe(switchMap((ok) => (ok ? this.api.release(s.id) : of(null))))
      .subscribe((r) => r && this.reload());
  }

  protected history(s: ParkingSlot): void {
    this.api.history(s.id).subscribe((list) => {
      const lines = list.length
        ? list.map((a) => `${a.flat}: ${a.fromDate} to ${a.toDate ?? 'now'}${a.surrendered ? ' (given up)' : ''}${a.note ? ' · ' + a.note : ''}`).join('\n')
        : 'Never allotted.';
      confirmDialog(this.dialog, { title: `Slot ${s.slotNumber}`, message: lines, confirmText: 'Close' }).subscribe();
    });
  }

  protected toggleActive(s: ParkingSlot): void {
    this.api.setActive(s.id, !s.active).subscribe(() => this.reload());
  }

  protected remove(s: ParkingSlot): void {
    confirmDialog(this.dialog, { title: `Delete slot ${s.slotNumber}?`, message: 'Only a slot that was never allotted can be deleted.', confirmText: 'Delete' })
      .pipe(switchMap((ok) => (ok ? this.api.deleteSlot(s.id) : of(null))))
      .subscribe(() => this.reload());
  }

  protected reject(r: ParkingRequest): void {
    textDialog(this.dialog, {
      title: `Reject ${r.flat}'s request?`,
      message: 'The flat is told why.',
      label: 'Reason',
      confirmText: 'Reject',
      save: (reason) => this.api.rejectRequest(r.id, reason),
    }).subscribe(() => this.reload());
  }

  protected approve(v: Vehicle): void {
    this.api.approveVehicle(v.id).subscribe((u) => {
      this.snack.open(`${u.registrationNumber} approved · sticker ${u.stickerNumber}`, undefined, { duration: 3000 });
      this.replaceVehicle(u);
    });
  }

  protected rejectVehicle(v: Vehicle): void {
    textDialog(this.dialog, {
      title: `Reject ${v.registrationNumber}?`,
      message: 'The flat is told why and can fix the details.',
      label: 'Reason',
      confirmText: 'Reject',
      save: (reason) => this.api.rejectVehicle(v.id, reason),
    }).subscribe((u) => this.replaceVehicle(u));
  }

  protected decide(v: Violation): void {
    decideDialog(this.dialog, v).subscribe((u) => this.reports.update((list) => list.map((x) => (x.id === u.id ? u : x))));
  }

  protected openRc(v: Vehicle): void {
    this.api.rc(v.id).subscribe((blob) => this.openBlob(blob));
  }

  protected openPhoto(v: Violation): void {
    this.api.violationPhoto(v.id).subscribe((blob) => this.openBlob(blob));
  }

  protected export(what: 'allotments' | 'vehicles' | 'violations'): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId != null) this.api.export(societyId, what).subscribe((res) => saveResponse(res, `parking-${what}.csv`));
  }

  private replaceVehicle(u: Vehicle): void {
    this.vehicles.update((list) => list.map((x) => (x.id === u.id ? u : x)));
  }

  private openBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
