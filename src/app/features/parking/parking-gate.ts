import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { catchError, filter, forkJoin, interval, of, switchMap } from 'rxjs';

import { ParkingApi } from '../../core/api/parking.api';
import { VisitorApi } from '../../core/api/visitor.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Vehicle, Visitor, VisitorSlot, VisitorStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, StatusPill } from '../../shared/ui';
import { parkVisitorDialog, reportDialog, vehicleState, vehicleTypeIcon } from './parking-ui';

const REFRESH_MS = 30_000;

/**
 * Parking at the gate: find a vehicle by part of its number (flat, slot, sticker, or "not registered"),
 * see the visitor slots and free them, and report wrong parking.
 */
@Component({
  selector: 'app-parking-gate',
  imports: [DatePipe, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, EmptyState, PageHeader, StatusPill],
  template: `
    <app-page-header title="Parking at the gate" [subtitle]="ctx.selectedSociety()?.name ?? null">
      @if (canVisitors()) {
        <a mat-stroked-button routerLink="/gate"><mat-icon>badge</mat-icon>Visitors</a>
      }
      @if (canReport()) {
        <button mat-flat-button (click)="report()"><mat-icon>report</mat-icon>Report wrong parking</button>
      }
    </app-page-header>

    <section class="search">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Vehicle number (any part)</mat-label>
        <input matInput autocomplete="off" [value]="number()" (input)="number.set($any($event.target).value)" (keydown.enter)="search()" />
      </mat-form-field>
      <button mat-flat-button class="big" (click)="search()" [disabled]="clean().length < 3">Find</button>
    </section>
    @if (searchError(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
    @if (results(); as list) {
      <div class="results">
        @for (v of list; track v.id) {
          <article class="vehicle" [attr.data-status]="v.status">
            <mat-icon aria-hidden="true">{{ vehicleTypeIcon(v.vehicleType) }}</mat-icon>
            <div class="main">
              <strong class="plate">{{ v.registrationNumber }}</strong>
              <span>Flat {{ v.flat }}{{ v.slotNumber ? ' · slot ' + v.slotNumber : '' }}{{ v.stickerNumber ? ' · sticker ' + v.stickerNumber : '' }}</span>
              <span class="meta">{{ looks(v) }}</span>
            </div>
            <app-status-pill [tone]="vehicleState(v.status).tone">{{ vehicleState(v.status).label }}</app-status-pill>
          </article>
        } @empty {
          <article class="vehicle" data-status="NONE">
            <mat-icon aria-hidden="true">help</mat-icon>
            <div class="main">
              <strong>Not registered</strong>
              <span class="meta">No vehicle of the society has a number containing "{{ clean() }}".</span>
            </div>
            @if (canReport()) {
              <button mat-stroked-button (click)="report(clean())">Report</button>
            }
          </article>
        }
      </div>
    }

    @if (canPark()) {
      <section class="lane park" aria-label="Park a visitor">
        <header>
          <h2>Park a visitor</h2>
          <span class="meta">At the gate or inside, not parked yet</span>
        </header>
        @for (v of unparked(); track v.id) {
          <div class="row">
            <div class="main">
              <span>{{ v.visitorName }} for {{ v.flatNumber }}{{ v.vehicleNumber ? ' · ' + v.vehicleNumber : '' }}</span>
              <span class="meta">{{ v.status === 'ENTERED' ? 'Inside' : v.status === 'APPROVED' ? 'Approved, at the gate' : 'Waiting for the flat' }}</span>
            </div>
            <button mat-flat-button (click)="park(v)" [disabled]="freeSlots() === 0">
              <mat-icon>local_parking</mat-icon>
              Park
            </button>
          </div>
        } @empty {
          <p class="hint">No visitor is waiting to be parked.</p>
        }
      </section>
    }

    <section class="lane" aria-label="Visitor slots">
      <header>
        <h2>Visitor slots</h2>
        <span class="meta">{{ freeSlots() }} free of {{ slots().length }}</span>
      </header>
      @for (s of slots(); track s.slotId) {
        <div class="row" [class.overstay]="s.overstaying">
          <strong class="slot">{{ s.slotNumber }}</strong>
          <div class="main">
            @if (s.parking; as p) {
              <span>{{ s.visitorName }} for {{ p.flat }}{{ p.vehicleNumber ? ' · ' + p.vehicleNumber : '' }}</span>
              <span class="meta">Since {{ p.fromAt | date: 'HH:mm' }}{{ s.overstaying ? ' · past the time limit' : '' }}</span>
            } @else {
              <span class="meta">Free{{ s.area ? ' · ' + s.area : '' }}</span>
            }
          </div>
          @if (s.parking && canPark()) {
            <button mat-stroked-button (click)="free(s)">Free</button>
          }
        </div>
      } @empty {
        <app-empty-state icon="local_parking" message="The society has no visitor slots." />
      }
      <p class="hint">Park a visitor when logging them; their slot frees itself when they are marked out.</p>
    </section>
  `,
  styles: `
    .search {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
    }
    .search mat-form-field {
      flex: 1 1 260px;
      max-width: 420px;
    }
    .big {
      --mat-button-filled-container-height: 52px;
      min-width: 112px;
    }
    .error {
      margin: 0 0 12px;
      color: var(--mat-sys-error);
    }
    .results {
      display: grid;
      gap: 8px;
      margin-bottom: 24px;
    }
    .vehicle {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      border: 2px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
    }
    .vehicle[data-status='APPROVED'] {
      border-color: var(--app-success);
    }
    .vehicle[data-status='NONE'],
    .vehicle[data-status='REJECTED'] {
      border-color: var(--mat-sys-error);
    }
    .main {
      display: grid;
      flex: 1;
      min-width: 0;
    }
    .plate {
      font: var(--mat-sys-title-large);
      letter-spacing: 2px;
    }
    .meta,
    .hint {
      color: var(--mat-sys-on-surface-variant);
    }
    .lane {
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      overflow: hidden;
    }
    .lane header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px 8px;
    }
    h2 {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 20px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .lane.park {
      margin-bottom: 16px;
    }
    .row.overstay {
      background: var(--app-warning-container);
    }
    .slot {
      min-width: 64px;
    }
    .hint {
      margin: 0;
      padding: 12px 20px;
      font: var(--mat-sys-body-small);
    }
  `,
})
export class ParkingGate {
  private readonly api = inject(ParkingApi);
  private readonly visitorApi = inject(VisitorApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly vehicleState = vehicleState;
  protected readonly vehicleTypeIcon = vehicleTypeIcon;

  protected readonly number = signal('');
  protected readonly clean = computed(() => this.number().toUpperCase().replace(/[^A-Z0-9]/g, ''));
  protected readonly results = signal<Vehicle[] | null>(null);
  protected readonly searchError = signal<string | null>(null);
  protected readonly slots = signal<VisitorSlot[]>([]);
  protected readonly freeSlots = computed(() => this.slots().filter((s) => !s.occupied).length);
  /** Visitors at the gate or inside. */
  private readonly visitors = signal<Visitor[]>([]);
  /** Those not in a visitor slot yet, longest at the gate first. */
  protected readonly unparked = computed(() => {
    const parked = new Set(this.slots().flatMap((s) => (s.parking ? [s.parking.visitorId] : [])));
    return this.visitors().filter((v) => !parked.has(v.id));
  });

  private readonly can = (p: string) => this.auth.can(p, this.ctx.selectedSocietyId());
  protected readonly canPark = computed(() => this.can('PARKING.VISITOR.UPDATE'));
  protected readonly canReport = computed(() => this.can('PARKING.VIOLATION.CREATE'));
  protected readonly canVisitors = computed(() => this.can('VISITOR.ENTRY.UPDATE'));

  constructor() {
    toObservable(this.ctx.selectedSocietyId)
      .pipe(
        switchMap((id) => (id == null ? of([]) : this.api.visitorSlots(id).pipe(catchError(() => of([]))))),
        takeUntilDestroyed(),
      )
      .subscribe((list) => this.slots.set(list));
    interval(REFRESH_MS)
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        switchMap(() => {
          const id = this.ctx.selectedSocietyId();
          return id == null ? of(null) : this.api.visitorSlots(id, { silent: true }).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => {
        if (list) this.slots.set(list);
        this.loadVisitors();
      });
    toObservable(this.ctx.selectedSocietyId)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.loadVisitors());
  }

  /** Pending, approved and inside visitors, for the Park list (only for those who may park them). */
  private loadVisitors(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || !this.canPark() || !this.auth.can('VISITOR.ENTRY.VIEW', societyId)) {
      this.visitors.set([]);
      return;
    }
    const lane = (status: VisitorStatus) =>
      this.visitorApi.list({ societyId, status, page: 0, size: 100 }, { silent: true }).pipe(catchError(() => of([] as Visitor[])));
    forkJoin([lane('ENTERED'), lane('APPROVED'), lane('PENDING')]).subscribe((lists) =>
      this.visitors.set(lists.flat().sort((a, b) => (a.loggedAt ?? '').localeCompare(b.loggedAt ?? ''))),
    );
  }

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
      this.snack.open(`${v.visitorName} parked in ${p.slotNumber}`, undefined, { duration: 2500 });
      this.api.visitorSlots(societyId, { silent: true }).pipe(catchError(() => of(null))).subscribe((list) => list && this.slots.set(list));
    });
  }

  protected looks(v: Vehicle): string {
    return [v.make, v.model, v.colour].filter((x) => !!x).join(' ');
  }

  protected search(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || this.clean().length < 3) return;
    this.searchError.set(null);
    this.api.searchVehicles(societyId, this.clean()).subscribe({
      next: (list) => this.results.set(list),
      error: (err: HttpErrorResponse) => {
        this.results.set(null);
        this.searchError.set(errorMessage(err));
      },
    });
  }

  protected free(s: VisitorSlot): void {
    if (!s.parking) return;
    this.api.freeVisitorSlot(s.parking.id).subscribe(() => {
      this.snack.open(`Slot ${s.slotNumber} is free`, undefined, { duration: 2500 });
      this.slots.update((list) => list.map((x) => (x.slotId === s.slotId ? { ...x, occupied: false, parking: null, visitorName: null, overstaying: false } : x)));
    });
  }

  protected report(number?: string): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId != null) reportDialog(this.dialog, societyId, number).subscribe(() => this.snack.open('Reported to the committee', undefined, { duration: 2500 }));
  }
}
