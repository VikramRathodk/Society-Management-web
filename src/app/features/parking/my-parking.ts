import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, combineLatest, forkJoin, of, switchMap, tap } from 'rxjs';

import { ParkingApi } from '../../core/api/parking.api';
import { AuthStore } from '../../core/auth/auth.store';
import { FlatParking, Vehicle, Violation } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { OwnFlats } from '../staff/staff-ui';
import {
  askSlotDialog,
  inr,
  kindLabel,
  reportDialog,
  requestState,
  slotLabel,
  textDialog,
  vehicleDialog,
  vehicleState,
  vehicleTypeIcon,
  vehicleTypeLabel,
  violationState,
} from './parking-ui';

/**
 * A resident's parking: the slots their flat holds (give one up), its requests and place in the queue,
 * its vehicles (register, change, remove), and wrong-parking reports against its vehicles (reply once).
 */
@Component({
  selector: 'app-my-parking',
  imports: [DatePipe, MatButtonModule, MatChipsModule, MatIconModule, EmptyState, PageHeader, Section, Skeleton, StatusPill],
  providers: [OwnFlats],
  template: `
    <app-page-header title="My parking" [subtitle]="data()?.flat ? 'Flat ' + data()!.flat : null">
      @if (canReport()) {
        <button mat-stroked-button (click)="report()">
          <mat-icon>report</mat-icon>
          Report wrong parking
        </button>
      }
    </app-page-header>

    @if ((flats()?.length ?? 0) > 1) {
      <mat-chip-listbox aria-label="Flat" [hideSingleSelectionIndicator]="true" (change)="flatId.set($event.value)" class="flats">
        @for (f of flats(); track f.id) {
          <mat-chip-option [value]="f.id" [selected]="f.id === flatId()">{{ f.label }}</mat-chip-option>
        }
      </mat-chip-listbox>
    }

    @if (loading()) {
      <app-skeleton variant="list" [count]="4" />
    } @else if (!data()) {
      <app-empty-state icon="cloud_off" message="Couldn't load your parking.">
        <button mat-stroked-button (click)="reload()">Try again</button>
      </app-empty-state>
    } @else {
      @let d = data()!;
      <app-section title="Slots">
        <div sectionActions>
          <button mat-stroked-button (click)="ask()">
            <mat-icon>add</mat-icon>
            Ask for a slot
          </button>
        </div>
        @for (s of d.slots; track s.id) {
          <div class="row">
            <mat-icon aria-hidden="true">{{ vehicleTypeIcon(s.vehicleType) }}</mat-icon>
            <div class="main">
              <strong>Slot {{ s.slotNumber }}</strong>
              <span class="meta">{{ slotLabel(s) }} · since {{ s.current?.fromDate | date: 'd MMM y' }}{{ s.monthlyCharge != null ? ' · ' + inr(s.monthlyCharge) + ' a month' : '' }}</span>
            </div>
            <button mat-button (click)="surrender(s.id, s.slotNumber)">Give up</button>
          </div>
        } @empty {
          <p class="quiet">Your flat holds no slot.</p>
        }
        @for (r of openRequests(); track r.id) {
          <div class="row">
            <mat-icon aria-hidden="true">hourglass_top</mat-icon>
            <div class="main">
              <strong>{{ vehicleTypeLabel(r.vehicleType) }} slot requested</strong>
              <span class="meta">Asked {{ r.requestedAt | date: 'd MMM y' }} · number {{ r.position }} in the queue</span>
            </div>
            <app-status-pill tone="warning">Waiting</app-status-pill>
            <button mat-button (click)="withdraw(r.id)">Withdraw</button>
          </div>
        }
        @for (r of closedRequests(); track r.id) {
          <div class="row faded">
            <mat-icon aria-hidden="true">history</mat-icon>
            <div class="main">
              <strong>{{ vehicleTypeLabel(r.vehicleType) }} slot request</strong>
              <span class="meta">{{ r.requestedAt | date: 'd MMM y' }}{{ r.reason ? ' · ' + r.reason : '' }}</span>
            </div>
            <app-status-pill [tone]="requestState(r.status).tone">{{ requestState(r.status).label }}</app-status-pill>
          </div>
        }
      </app-section>

      <app-section title="Vehicles">
        <div sectionActions>
          <button mat-stroked-button (click)="register()">
            <mat-icon>add</mat-icon>
            Register a vehicle
          </button>
        </div>
        @for (v of d.vehicles; track v.id) {
          <div class="row">
            <mat-icon aria-hidden="true">{{ vehicleTypeIcon(v.vehicleType) }}</mat-icon>
            <div class="main">
              <strong class="plate">{{ v.registrationNumber }}</strong>
              <span class="meta">
                {{ looks(v) }}{{
                  v.stickerNumber ? ' · sticker ' + v.stickerNumber : ''
                }}{{ v.slotNumber ? ' · slot ' + v.slotNumber : '' }}
              </span>
              @if (v.status === 'REJECTED' && v.rejectionReason) {
                <span class="warn">Not approved: {{ v.rejectionReason }}</span>
              }
            </div>
            <app-status-pill [tone]="vehicleState(v.status).tone">{{ vehicleState(v.status).label }}</app-status-pill>
            <button mat-icon-button (click)="editVehicle(v)" aria-label="Change"><mat-icon>edit</mat-icon></button>
            <button mat-icon-button (click)="removeVehicle(v)" aria-label="Remove"><mat-icon>delete</mat-icon></button>
          </div>
        } @empty {
          <p class="quiet">No vehicles registered. Registered vehicles get a sticker and the guard can find them by number.</p>
        }
      </app-section>

      @if (reports().length) {
        <app-section title="Reports about your vehicles">
          @for (v of reports(); track v.id) {
            <div class="row">
              <mat-icon aria-hidden="true">report</mat-icon>
              <div class="main">
                <strong><span class="plate">{{ v.vehicleNumber }}</span> · {{ kindLabel(v.kind) }}</strong>
                <span class="meta">{{ v.reportedAt | date: 'd MMM, HH:mm' }} · {{ v.slotNumber ?? v.place }}{{ v.note ? ' · ' + v.note : '' }}</span>
                @if (v.reply) {
                  <span class="reply">Your reply: {{ v.reply }}</span>
                }
                @if (v.status === 'FINED') {
                  <span class="warn">Fined {{ inr(v.fineAmount) }}, on your next maintenance bill{{ v.decisionNote ? ' · ' + v.decisionNote : '' }}</span>
                }
              </div>
              <app-status-pill [tone]="violationState(v.status).tone">{{ violationState(v.status).label }}</app-status-pill>
              @if (v.status === 'OPEN' && !v.reply) {
                <button mat-stroked-button (click)="reply(v)">Reply</button>
              }
            </div>
          }
        </app-section>
      }
    }
  `,
  styles: `
    .flats {
      display: block;
      margin-bottom: 16px;
    }
    app-section {
      display: block;
      margin-bottom: 16px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .row.faded {
      opacity: 0.7;
    }
    .main {
      display: grid;
      flex: 1 1 220px;
      min-width: 0;
    }
    .meta,
    .quiet {
      color: var(--mat-sys-on-surface-variant);
    }
    .quiet {
      margin: 0;
      padding: 12px 20px;
    }
    .warn {
      color: var(--mat-sys-error);
    }
    .reply {
      font-style: italic;
    }
    .plate {
      letter-spacing: 1px;
    }
  `,
})
export class MyParking {
  private readonly api = inject(ParkingApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly own = inject(OwnFlats);
  private readonly ctx = inject(SocietyContextStore);

  protected readonly slotLabel = slotLabel;
  protected readonly vehicleTypeIcon = vehicleTypeIcon;
  protected readonly vehicleTypeLabel = vehicleTypeLabel;
  protected readonly requestState = requestState;
  protected readonly vehicleState = vehicleState;
  protected readonly violationState = violationState;
  protected readonly kindLabel = kindLabel;
  protected readonly inr = inr;

  protected readonly flats = this.own.flats;
  protected readonly flatId = signal<number | null>(null);
  protected readonly data = signal<FlatParking | null>(null);
  protected readonly reports = signal<Violation[]>([]);
  protected readonly loading = signal(true);
  private readonly attempt = signal(0);

  protected readonly canReport = computed(() => this.auth.can('PARKING.VIOLATION.CREATE', this.ctx.selectedSocietyId()));
  protected readonly openRequests = computed(() => (this.data()?.requests ?? []).filter((r) => r.status === 'WAITING'));
  protected readonly closedRequests = computed(() =>
    (this.data()?.requests ?? []).filter((r) => r.status === 'REJECTED' || r.status === 'WITHDRAWN').slice(0, 3),
  );

  constructor() {
    effect(() => {
      const flats = this.flats();
      if (flats && !flats.some((f) => f.id === this.flatId())) this.flatId.set(flats[0]?.id ?? null);
    });
    combineLatest([toObservable(this.flatId), toObservable(this.attempt)])
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([flatId]) =>
          // No flat yet: the user's flats are still loading.
          flatId == null
            ? of(undefined)
            : forkJoin({
                parking: this.api.ofFlat(flatId),
                reports: this.api.violationsOfFlat(flatId).pipe(catchError(() => of([]))),
              }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (result === undefined) return;
        this.loading.set(false);
        this.data.set(result?.parking ?? null);
        this.reports.set(result?.reports ?? []);
      });
  }

  protected reload(): void {
    this.attempt.update((n) => n + 1);
  }

  /** "Maruti Swift White", or the vehicle type when nothing was given. */
  protected looks(v: Vehicle): string {
    return [v.make, v.model, v.colour].filter((x) => !!x).join(' ') || vehicleTypeLabel(v.vehicleType);
  }

  protected ask(): void {
    const flatId = this.flatId();
    if (flatId == null) return;
    askSlotDialog(this.dialog, flatId).subscribe((r) => {
      this.snack.open(`Request sent; you are number ${r.position} in the queue`, undefined, { duration: 3000 });
      this.reload();
    });
  }

  protected withdraw(id: number): void {
    this.api.withdraw(id).subscribe(() => this.reload());
  }

  protected surrender(slotId: number, number: string): void {
    confirmDialog(this.dialog, {
      title: `Give up slot ${number}?`,
      message: 'The committee can allot it to another flat. To get one again, ask and wait in the queue.',
      confirmText: 'Give up',
    })
      .pipe(switchMap((ok) => (ok ? this.api.surrender(slotId) : of(null))))
      .subscribe((r) => r && this.reload());
  }

  protected register(): void {
    const flatId = this.flatId();
    if (flatId == null) return;
    vehicleDialog(this.dialog, { flatId, slots: this.data()?.slots ?? [] }).subscribe((v) => {
      this.snack.open(v.status === 'APPROVED' ? `${v.registrationNumber} registered · sticker ${v.stickerNumber}` : `${v.registrationNumber} sent for approval`, undefined, {
        duration: 3000,
      });
      this.reload();
    });
  }

  protected editVehicle(v: Vehicle): void {
    vehicleDialog(this.dialog, { flatId: v.flatId, slots: this.data()?.slots ?? [], vehicle: v }).subscribe(() => this.reload());
  }

  protected removeVehicle(v: Vehicle): void {
    confirmDialog(this.dialog, { title: `Remove ${v.registrationNumber}?`, message: 'Its sticker stops counting at the gate.', confirmText: 'Remove' })
      .pipe(switchMap((ok) => (ok ? this.api.removeVehicle(v.id) : of(null))))
      .subscribe((r) => r && this.reload());
  }

  protected reply(v: Violation): void {
    textDialog(this.dialog, {
      title: `Reply about ${v.vehicleNumber}`,
      message: 'The committee reads it before deciding. You can reply once.',
      label: 'Your explanation',
      confirmText: 'Send',
      save: (text) => this.api.reply(v.id, text),
    }).subscribe((u) => this.reports.update((list) => list.map((x) => (x.id === u.id ? u : x))));
  }

  protected report(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId != null) reportDialog(this.dialog, societyId).subscribe(() => this.snack.open('Reported to the committee', undefined, { duration: 2500 }));
  }
}
