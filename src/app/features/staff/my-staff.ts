import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, combineLatest, forkJoin, of, switchMap, tap } from 'rxjs';

import { StaffApi } from '../../core/api/staff.api';
import { Staff, StaffAttendance, StaffLink } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Skeleton } from '../../shared/ui';
import { addStaffDialog, editLinkDialog } from './staff-dialogs';
import {
  OwnFlats,
  StaffPhoto,
  StaffPhotos,
  StaffStatePill,
  durationLabel,
  monthOf,
  printCardFor,
  scheduleLabel,
  typeLabel,
} from './staff-ui';

interface Row {
  staff: Staff;
  link: StaffLink;
  attendance: StaffAttendance | null;
}

/**
 * A resident's own help: who works for their flat, their entry code and card, how they work for the
 * flat, arrival notifications, this month's attendance; add someone new or link someone registered.
 */
@Component({
  selector: 'app-my-staff',
  imports: [
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatTooltipModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StaffPhoto,
    StaffStatePill,
  ],
  providers: [OwnFlats, StaffPhotos],
  template: `
    <app-page-header title="My staff" [subtitle]="subtitle()">
      @if (flatId() != null) {
        <button mat-flat-button (click)="add()">
          <mat-icon>person_add</mat-icon>
          Add staff
        </button>
      }
    </app-page-header>

    @if (flats() === undefined) {
      <app-skeleton variant="list" [count]="3" />
    } @else if (flats()!.length === 0) {
      <app-empty-state icon="cleaning_services" message="You don't live in a flat in this society, so there is no help of yours to show.">
        <a mat-stroked-button routerLink="/staff">Open the staff directory</a>
      </app-empty-state>
    } @else {
      <div class="toolbar">
        @if (flats()!.length > 1) {
          <mat-chip-listbox aria-label="Flat" [hideSingleSelectionIndicator]="true" (change)="flatId.set($event.value)">
            @for (f of flats(); track f.id) {
              <mat-chip-option [value]="f.id" [selected]="f.id === flatId()">{{ f.label }}</mat-chip-option>
            }
          </mat-chip-listbox>
        }
        <mat-slide-toggle [checked]="showEnded()" (change)="showEnded.set($event.checked)">
          Show people who no longer work here
        </mat-slide-toggle>
      </div>

      @if (loading()) {
        <app-skeleton variant="list" [count]="3" />
      } @else if (loadError()) {
        <app-empty-state icon="cloud_off" message="Couldn't load your staff.">
          <button mat-stroked-button (click)="reload()">Try again</button>
        </app-empty-state>
      } @else if (rows().length === 0) {
        <app-empty-state icon="cleaning_services" message="Nobody is registered as working for this flat yet.">
          <button mat-stroked-button (click)="add()">Add your maid, cook or driver</button>
        </app-empty-state>
      } @else {
        <div class="cards">
          @for (r of rows(); track r.link.id) {
            <article class="card" [class.ended]="!r.link.active">
              <div class="top">
                <app-staff-photo [staffId]="r.staff.id" [name]="r.staff.name" [hasPhoto]="!!r.staff.photoUrl" [size]="56" />
                <div class="who">
                  <a class="name" [routerLink]="['/staff', r.staff.id]">{{ r.staff.name }}</a>
                  <span class="meta">{{ typeLabel(r.staff.staffType) }}{{ r.link.work ? ' · ' + r.link.work : '' }}</span>
                  <app-staff-state [staff]="r.staff" />
                </div>
                @if (r.link.active) {
                  <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="More actions">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                  <mat-menu #menu="matMenu">
                    <button mat-menu-item (click)="edit(r)">
                      <mat-icon>edit_calendar</mat-icon>
                      Change days and times
                    </button>
                    <button mat-menu-item (click)="print(r.staff)" [disabled]="r.staff.status !== 'VERIFIED'">
                      <mat-icon>badge</mat-icon>
                      Print ID card
                    </button>
                    <button mat-menu-item (click)="end(r)">
                      <mat-icon>person_remove</mat-icon>
                      No longer works for us
                    </button>
                  </mat-menu>
                }
              </div>

              @if (r.staff.blocked) {
                <p class="alert danger">Blocked by the committee: {{ r.staff.blockReason }}</p>
              } @else if (r.staff.status === 'REJECTED') {
                <p class="alert danger">Not verified: {{ r.staff.rejectionReason }}. <a [routerLink]="['/staff', r.staff.id]">Fix the details</a></p>
              } @else if (r.staff.status === 'PENDING') {
                <p class="alert">The committee will check their ID. Until then the gate can't let them in with their code.</p>
              }

              <dl>
                @if (scheduleLabel(r.link); as schedule) {
                  <div><dt>Usually</dt><dd>{{ schedule }}</dd></div>
                }
                @if (r.staff.entryCode && r.link.active) {
                  <div><dt>Entry code</dt><dd class="code">{{ r.staff.entryCode }}</dd></div>
                }
                @if (r.staff.phone) {
                  <div><dt>Phone</dt><dd>{{ r.staff.phone }}</dd></div>
                }
                @if (r.attendance; as a) {
                  <div>
                    <dt>This month</dt>
                    <dd>{{ a.daysPresent }} {{ a.daysPresent === 1 ? 'day' : 'days' }}{{ a.minutes ? ' · ' + durationLabel(a.minutes) : '' }}</dd>
                  </div>
                }
                @if (!r.link.active) {
                  <div><dt>Worked here</dt><dd>until {{ r.link.endedOn }}</dd></div>
                }
              </dl>

              @if (r.link.active) {
                <mat-slide-toggle [checked]="!!r.link.notify" (change)="toggleNotify(r, $event.checked)" [disabled]="busy().has(r.link.id)">
                  Notify me when they come and go
                </mat-slide-toggle>
              }
            </article>
          }
        </div>
      }
    }
  `,
  styles: `
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 24px;
      margin-bottom: 16px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
      gap: 16px;
    }
    .card {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
    }
    .card.ended {
      opacity: 0.7;
    }
    .top {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .who {
      display: grid;
      flex: 1;
      gap: 4px;
      justify-items: start;
    }
    .name {
      font: var(--mat-sys-title-medium);
      color: inherit;
      text-decoration: none;
    }
    .name:hover {
      text-decoration: underline;
    }
    .meta {
      color: var(--mat-sys-on-surface-variant);
    }
    .alert {
      margin: 0;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--app-warning-container);
      color: var(--app-warning);
      font: var(--mat-sys-body-small);
    }
    .alert.danger {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    dl {
      display: grid;
      gap: 6px;
      margin: 0;
    }
    dl div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    dt {
      color: var(--mat-sys-on-surface-variant);
    }
    dd {
      margin: 0;
      text-align: right;
    }
    .code {
      font-variant-numeric: tabular-nums;
      letter-spacing: 3px;
      font-weight: 600;
    }
  `,
})
export class MyStaff {
  private readonly api = inject(StaffApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly own = inject(OwnFlats);
  private readonly ctx = inject(SocietyContextStore);

  protected readonly typeLabel = typeLabel;
  protected readonly scheduleLabel = scheduleLabel;
  protected readonly durationLabel = durationLabel;

  protected readonly flats = this.own.flats;
  protected readonly flatId = signal<number | null>(null);
  protected readonly showEnded = signal(false);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly busy = signal<ReadonlySet<number>>(new Set());
  private readonly staff = signal<Staff[]>([]);
  private readonly attendance = signal<StaffAttendance[]>([]);
  private readonly attempt = signal(0);

  protected readonly subtitle = computed(() => {
    const flat = this.flats()?.find((f) => f.id === this.flatId());
    return flat ? `Flat ${flat.label}` : null;
  });

  /** One row per link to this flat (a person who left and came back has two). */
  protected readonly rows = computed<Row[]>(() => {
    const flatId = this.flatId();
    const byStaff = new Map(this.attendance().map((a) => [a.staff.id, a]));
    return this.staff()
      .flatMap((s) => s.links.filter((l) => l.flatId === flatId).map((link) => ({ staff: s, link })))
      .filter((r) => this.showEnded() || r.link.active)
      .sort((a, b) => Number(b.link.active) - Number(a.link.active) || a.staff.name.localeCompare(b.staff.name))
      .map((r) => ({ ...r, attendance: r.link.active ? (byStaff.get(r.staff.id) ?? null) : null }));
  });

  constructor() {
    // The first flat by default, and again when the society changes.
    effect(() => {
      const flats = this.flats();
      if (flats && !flats.some((f) => f.id === this.flatId())) this.flatId.set(flats[0]?.id ?? null);
    });

    combineLatest([toObservable(this.flatId), toObservable(this.attempt)])
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadError.set(false);
        }),
        switchMap(([flatId]) => {
          const societyId = this.ctx.selectedSocietyId();
          if (flatId == null || societyId == null) return of({ staff: [] as Staff[], attendance: [] as StaffAttendance[] });
          return forkJoin({
            staff: this.api.ofFlat(flatId, true),
            attendance: this.api.attendance(societyId, monthOf(new Date()), flatId).pipe(catchError(() => of([]))),
          }).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if (!result) {
          this.loadError.set(true);
          return;
        }
        this.staff.set(result.staff);
        this.attendance.set(result.attendance);
      });
  }

  protected reload(): void {
    this.attempt.update((n) => n + 1);
  }

  protected add(): void {
    const flatId = this.flatId();
    const societyId = this.ctx.selectedSocietyId();
    const flat = this.flats()?.find((f) => f.id === flatId);
    if (flatId == null || societyId == null || !flat) return;
    addStaffDialog(this.dialog, { societyId, flatId, flatLabel: flat.label }).subscribe((staff) => {
      this.snack.open(
        staff.status === 'VERIFIED' ? `${staff.name} added` : `${staff.name} added; the committee will verify them`,
        undefined,
        { duration: 3000 },
      );
      this.reload();
    });
  }

  protected edit(row: Row): void {
    editLinkDialog(this.dialog, { staff: row.staff, link: row.link }).subscribe((s) => this.replace(s));
  }

  protected toggleNotify(row: Row, notify: boolean): void {
    this.setBusy(row.link.id, true);
    this.api
      .updateLink(row.link.flatId, row.staff.id, {
        work: row.link.work,
        days: row.link.days,
        timeFrom: row.link.timeFrom?.slice(0, 5) ?? null,
        timeTo: row.link.timeTo?.slice(0, 5) ?? null,
        notify,
      })
      .subscribe({
        next: (s) => {
          this.replace(s);
          this.setBusy(row.link.id, false);
        },
        error: () => {
          this.setBusy(row.link.id, false);
          this.reload();
        },
      });
  }

  protected end(row: Row): void {
    confirmDialog(this.dialog, {
      title: `${row.staff.name} no longer works for you?`,
      message: 'They will no longer be let in for your flat. Their past visits stay in the log.',
      confirmText: 'Confirm',
    })
      .pipe(
        switchMap((ok) => (ok ? this.api.endLink(row.link.flatId, row.staff.id) : of(null))),
      )
      .subscribe((s) => {
        if (s) this.replace(s);
      });
  }

  protected print(staff: Staff): void {
    printCardFor(this.api, staff);
  }

  private replace(updated: Staff): void {
    this.staff.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
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

