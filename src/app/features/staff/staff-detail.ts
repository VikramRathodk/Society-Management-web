import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, catchError, combineLatest, of, switchMap, tap } from 'rxjs';

import { StaffApi } from '../../core/api/staff.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Staff, StaffEntry, StaffLink } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton } from '../../shared/ui';
import { openStaffCard } from './staff-card-dialog';
import { editLinkDialog, editStaffDialog, reasonDialog } from './staff-dialogs';
import {
  OwnFlats,
  StaffPhoto,
  StaffPhotos,
  StaffStatePill,
  durationLabel,
  hhmm,
  idTypeLabel,
  monthOf,
  scheduleLabel,
  typeLabel,
} from './staff-ui';

/** One person: details, the flats they work for, verification and blocking, their visits by month. */
@Component({
  selector: 'app-staff-detail',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StaffPhoto,
    StaffStatePill,
  ],
  providers: [StaffPhotos, OwnFlats],
  template: `
    @if (loading()) {
      <app-skeleton variant="form" />
    } @else if (!staff()) {
      <app-empty-state icon="person_off" message="This person couldn't be loaded.">
        <a mat-stroked-button [routerLink]="backLink()">Back</a>
      </app-empty-state>
    } @else {
      @let s = staff()!;
      <app-page-header [title]="s.name" [subtitle]="role()" [back]="backLink()">
        @if (canVerify() && s.status !== 'VERIFIED') {
          <button mat-flat-button (click)="verify()" [disabled]="busy()">
            <mat-icon>verified</mat-icon>
            Verify
          </button>
        }
        @if (canVerify() && s.status === 'PENDING') {
          <button mat-stroked-button (click)="reject()" [disabled]="busy()">Reject</button>
        }
        @if (canPrint()) {
          <button mat-stroked-button (click)="print()">
            <mat-icon>badge</mat-icon>
            ID card
          </button>
        }
        @if (hasMenu()) {
          <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="More actions">
            <mat-icon>more_vert</mat-icon>
          </button>
          <mat-menu #menu="matMenu">
            @if (canEdit()) {
              <button mat-menu-item (click)="edit()">
                <mat-icon>edit</mat-icon>
                Edit details
              </button>
              <label mat-menu-item class="upload">
                <mat-icon>photo_camera</mat-icon>
                {{ s.photoUrl ? 'Change photo' : 'Add photo' }}
                <input type="file" accept="image/jpeg,image/png,image/webp" (change)="upload($event, 'photo')" />
              </label>
              <label mat-menu-item class="upload">
                <mat-icon>upload_file</mat-icon>
                {{ s.idProofUrl ? 'Replace ID proof' : 'Upload ID proof' }}
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" (change)="upload($event, 'idProof')" />
              </label>
            }
            @if (s.idProofUrl) {
              <button mat-menu-item (click)="openIdProof()">
                <mat-icon>badge</mat-icon>
                View ID proof
              </button>
            }
            @if (canVerify()) {
              <button mat-menu-item (click)="regenerate()">
                <mat-icon>pin</mat-icon>
                New entry code
              </button>
            }
            @if (canBlock()) {
              @if (s.blocked) {
                <button mat-menu-item (click)="unblock()">
                  <mat-icon>lock_open</mat-icon>
                  Unblock
                </button>
              } @else {
                <button mat-menu-item class="danger" (click)="block()">
                  <mat-icon>block</mat-icon>
                  Block
                </button>
              }
            }
          </mat-menu>
        }
      </app-page-header>

      <div class="hero">
        <app-staff-photo [staffId]="s.id" [name]="s.name" [hasPhoto]="!!s.photoUrl" [size]="96" [version]="photoVersion()" />
        <div class="facts">
          <app-staff-state [staff]="s" />
          @if (s.blocked) {
            <p class="alert danger">Blocked: {{ s.blockReason }}</p>
          } @else if (s.status === 'REJECTED' && s.rejectionReason) {
            <p class="alert danger">Not verified: {{ s.rejectionReason }}{{ canEdit() ? '. Fix the details or upload a clearer ID; the committee will look again.' : '' }}</p>
          } @else if (s.status === 'PENDING') {
            <p class="alert">Waiting for the committee to check their ID. They can't come in with their code yet.</p>
          }
          @if (s.entryCode) {
            <p class="code" aria-label="Entry code">{{ s.entryCode }}</p>
          }
        </div>
      </div>

      <div class="grid">
        <app-section title="Details" padded>
          <dl>
            <div><dt>Works as</dt><dd>{{ typeLabel(s.staffType) }}</dd></div>
            <div><dt>Kind</dt><dd>{{ s.kind === 'SOCIETY' ? 'Society staff' : 'Domestic help' }}</dd></div>
            @if (s.phone) {
              <div><dt>Phone</dt><dd><a [href]="'tel:' + s.phone">{{ s.phone }}</a></dd></div>
            }
            @if (s.idType) {
              <div><dt>{{ idTypeLabel(s.idType) }}</dt><dd>{{ s.idLast4 ? '•••• ' + s.idLast4 : 'number not given' }}</dd></div>
            }
            @if (s.society; as e) {
              @if (e.designation) {
                <div><dt>Designation</dt><dd>{{ e.designation }}</dd></div>
              }
              @if (e.shiftStart || e.shiftEnd) {
                <div><dt>Shift</dt><dd>{{ hhmm(e.shiftStart) }}–{{ hhmm(e.shiftEnd) }}</dd></div>
              }
              @if (e.monthlySalary != null) {
                <div><dt>Monthly salary</dt><dd>₹{{ e.monthlySalary | number: '1.0-2' }}</dd></div>
              }
              @if (e.joinedOn) {
                <div><dt>Joined</dt><dd>{{ e.joinedOn | date: 'd MMM y' }}</dd></div>
              }
              @if (e.leftOn) {
                <div><dt>Left</dt><dd>{{ e.leftOn | date: 'd MMM y' }}</dd></div>
              }
            }
            @if (s.createdBy) {
              <div><dt>Added by</dt><dd>{{ s.createdBy.name }}{{ s.createdAt ? ', ' + (s.createdAt | date: 'd MMM y') : '' }}</dd></div>
            }
            @if (s.verifiedBy) {
              <div><dt>Verified by</dt><dd>{{ s.verifiedBy.name }}{{ s.verifiedAt ? ', ' + (s.verifiedAt | date: 'd MMM y') : '' }}</dd></div>
            }
          </dl>
        </app-section>

        @if (s.kind === 'DOMESTIC' || s.links.length) {
          <app-section title="Works for">
            @for (l of s.links; track l.id) {
              <div class="link" [class.ended]="!l.active">
                <div class="main">
                  <strong>{{ l.flat }}</strong>
                  <span class="meta">
                    {{ l.work || 'Work not given' }}{{ scheduleLabel(l) ? ' · ' + scheduleLabel(l) : '' }}
                  </span>
                  <span class="meta">
                    {{ l.active ? 'Since ' + (l.startedOn | date: 'd MMM y') : 'Until ' + (l.endedOn | date: 'd MMM y') }}
                    {{ l.active && l.notify === false ? ' · notifications off' : '' }}
                  </span>
                </div>
                @if (l.active && ownsLink(l)) {
                  <button mat-icon-button (click)="editLink(l)" aria-label="Change days and times">
                    <mat-icon>edit_calendar</mat-icon>
                  </button>
                  <button mat-icon-button (click)="endLink(l)" aria-label="No longer works for this flat">
                    <mat-icon>person_remove</mat-icon>
                  </button>
                }
              </div>
            } @empty {
              <p class="quiet">Not working for any flat.</p>
            }
          </app-section>
        }
      </div>

      @if (entriesFlat() !== undefined) {
        <app-section title="Visits">
          <div sectionActions>
            <mat-form-field appearance="outline" class="month" subscriptSizing="dynamic">
              <mat-label>Month</mat-label>
              <input matInput type="month" [ngModel]="month()" (ngModelChange)="month.set($event)" />
            </mat-form-field>
          </div>
          @if (entries(); as list) {
            <p class="summary">
              {{ days(list) }} {{ days(list) === 1 ? 'day' : 'days' }} ·
              {{ durationLabel(totalMinutes(list)) }} · {{ list.length }} {{ list.length === 1 ? 'visit' : 'visits' }}
            </p>
            @for (e of list; track e.id) {
              <div class="entry">
                <span class="day">{{ e.inAt | date: 'EEE d MMM' }}</span>
                <span>{{ e.inAt | date: 'HH:mm' }} – {{ e.outAt ? (e.outAt | date: 'HH:mm') : 'inside' }}</span>
                <span class="meta">
                  {{ e.minutes != null ? durationLabel(e.minutes) : '' }}{{ e.autoCheckout ? ' · auto check-out' : '' }}
                </span>
              </div>
            } @empty {
              <p class="quiet">No visits this month.</p>
            }
          } @else {
            <p class="quiet">Couldn't load the visits.</p>
          }
        </app-section>
      }

      @if (s.blockHistory?.length) {
        <app-section title="Block history">
          @for (h of s.blockHistory; track $index) {
            <div class="entry">
              <span class="day">{{ h.at | date: 'd MMM y, HH:mm' }}</span>
              <span>{{ h.blocked ? 'Blocked' : 'Unblocked' }} by {{ h.by.name }}</span>
              <span class="meta">{{ h.reason }}</span>
            </div>
          }
        </app-section>
      }
    }
  `,
  styles: `
    .hero {
      display: flex;
      align-items: center;
      gap: 20px;
      margin-bottom: 20px;
    }
    .facts {
      display: grid;
      gap: 8px;
      justify-items: start;
    }
    .code {
      margin: 0;
      font-size: 1.8rem;
      font-weight: 700;
      letter-spacing: 6px;
      font-variant-numeric: tabular-nums;
    }
    .alert {
      margin: 0;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--app-warning-container);
      color: var(--app-warning);
    }
    .alert.danger {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
      gap: 16px;
      align-items: start;
      margin-bottom: 16px;
    }
    app-section {
      display: block;
      margin-bottom: 16px;
    }
    dl {
      display: grid;
      gap: 8px;
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
    .link,
    .entry {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .link.ended {
      opacity: 0.65;
    }
    .main {
      display: grid;
      flex: 1;
    }
    .meta,
    .quiet,
    .summary {
      color: var(--mat-sys-on-surface-variant);
    }
    .quiet,
    .summary {
      margin: 0;
      padding: 12px 20px;
    }
    .entry .day {
      min-width: 110px;
      font-weight: 500;
    }
    .entry .meta {
      margin-left: auto;
    }
    .month {
      width: 180px;
    }
    .upload input {
      display: none;
    }
    .danger {
      color: var(--mat-sys-error);
    }
  `,
})
export class StaffDetail {
  private readonly api = inject(StaffApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly own = inject(OwnFlats);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly typeLabel = typeLabel;
  protected readonly idTypeLabel = idTypeLabel;
  protected readonly scheduleLabel = scheduleLabel;
  protected readonly durationLabel = durationLabel;
  protected readonly hhmm = hhmm;

  private readonly id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  protected readonly staff = signal<Staff | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly photoVersion = signal('');
  protected readonly month = signal(monthOf(new Date()));
  /** undefined: not loaded; null: failed. */
  protected readonly entries = signal<StaffEntry[] | null | undefined>(undefined);

  private readonly can = (p: string) => this.auth.can(p, this.staff()?.societyId ?? this.ctx.selectedSocietyId());
  protected readonly canVerify = computed(() => this.staff()?.view === 'FULL' && this.can('STAFF.MEMBER.VERIFY'));
  protected readonly canBlock = computed(() => this.staff()?.view === 'FULL' && this.can('STAFF.MEMBER.BLOCK'));
  /** The backend has the last word (a resident edits only help they added, until it's verified). */
  protected readonly canEdit = computed(() => {
    const s = this.staff();
    if (!s) return false;
    if (s.view === 'FULL') return this.can('STAFF.MEMBER.VERIFY') || this.can('STAFF.SOCIETY.MANAGE');
    return s.view === 'FLAT' && s.kind === 'DOMESTIC' && s.status !== 'VERIFIED';
  });
  protected readonly canPrint = computed(() => {
    const s = this.staff();
    return !!s && s.view !== 'GATE' && s.status === 'VERIFIED' && !s.blocked;
  });
  protected readonly hasMenu = computed(() => this.canEdit() || this.canVerify() || this.canBlock() || !!this.staff()?.idProofUrl);
  protected readonly role = computed(() => {
    const s = this.staff();
    return s ? s.society?.designation || typeLabel(s.staffType) : null;
  });
  protected readonly backLink = computed(() =>
    this.can('STAFF.DIRECTORY.VIEW') ? '/staff' : this.own.ids().length ? '/my-staff' : '/dashboard',
  );

  /**
   * Whose visits to load: null = everyone's (committee), a flat id = while they worked for the
   * caller's flat, undefined = the caller can't see visits.
   */
  protected readonly entriesFlat = computed<number | null | undefined>(() => {
    const s = this.staff();
    if (!s || s.view === 'GATE') return undefined;
    if (this.can('STAFF.DIRECTORY.VIEW')) return null;
    const mine = new Set(this.own.ids());
    return s.links.find((l) => mine.has(l.flatId))?.flatId;
  });

  constructor() {
    this.api.get(this.id).subscribe({
      next: (s) => {
        this.staff.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    combineLatest([toObservable(this.entriesFlat), toObservable(this.month)])
      .pipe(
        tap(() => this.entries.set(undefined)),
        switchMap(([flatId, month]) => {
          const s = this.staff();
          if (!s || flatId === undefined || !month) return of(undefined);
          const [y, m] = month.split('-').map(Number);
          const last = new Date(y, m, 0).getDate();
          return this.api
            .entries(s.societyId, { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, staffId: s.id, flatId })
            .pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((list) => this.entries.set(list));
  }

  protected days(list: StaffEntry[]): number {
    return new Set(list.map((e) => new Date(e.inAt).toDateString())).size;
  }

  protected totalMinutes(list: StaffEntry[]): number {
    return list.reduce((sum, e) => sum + (e.minutes ?? 0), 0);
  }

  /** The caller's own flat (residents), or any flat for the committee. */
  protected ownsLink(link: StaffLink): boolean {
    return this.can('STAFF.DIRECTORY.VIEW') || this.own.ids().includes(link.flatId);
  }

  protected verify(): void {
    this.run(this.api.verify(this.id), 'Verified; they can now check in with their code');
  }

  protected reject(): void {
    const s = this.staff()!;
    reasonDialog(this.dialog, {
      title: `Reject ${s.name}?`,
      message: 'The resident who added them sees the reason and can fix the details.',
      label: 'Why',
      confirmText: 'Reject',
      required: true,
      danger: true,
      save: (reason) => this.api.reject(s.id, reason),
    }).subscribe((updated) => this.staff.set(updated));
  }

  protected block(): void {
    const s = this.staff()!;
    reasonDialog(this.dialog, {
      title: `Block ${s.name}?`,
      message: 'The gate will refuse them everywhere in the society, and every flat they work for is told why.',
      label: 'Reason',
      confirmText: 'Block',
      required: true,
      danger: true,
      save: (reason) => this.api.block(s.id, reason),
    }).subscribe((updated) => this.staff.set(updated));
  }

  protected unblock(): void {
    const s = this.staff()!;
    reasonDialog(this.dialog, {
      title: `Unblock ${s.name}?`,
      message: 'They can come in again. The block stays in their history.',
      label: 'Note (optional)',
      confirmText: 'Unblock',
      required: false,
      save: (reason) => this.api.unblock(s.id, reason),
    }).subscribe((updated) => this.staff.set(updated));
  }

  protected regenerate(): void {
    confirmDialog(this.dialog, {
      title: 'New entry code?',
      message: 'The old code stops working at once; print a new ID card.',
      confirmText: 'New code',
    }).subscribe((ok) => {
      if (ok) this.run(this.api.regenerateCode(this.id), 'New entry code made');
    });
  }

  protected edit(): void {
    const s = this.staff()!;
    editStaffDialog(this.dialog, { staff: s, societyId: s.societyId, manager: this.can('STAFF.SOCIETY.MANAGE') }).subscribe(
      (updated) => this.staff.set(updated),
    );
  }

  protected editLink(link: StaffLink): void {
    editLinkDialog(this.dialog, { staff: this.staff()!, link }).subscribe((updated) => this.staff.set(updated));
  }

  protected endLink(link: StaffLink): void {
    const s = this.staff()!;
    confirmDialog(this.dialog, {
      title: `${s.name} no longer works for ${link.flat}?`,
      message: 'Their past visits stay in the log.',
      confirmText: 'Confirm',
    }).subscribe((ok) => {
      if (ok) this.run(this.api.endLink(link.flatId, s.id), null);
    });
  }

  protected upload(event: Event, which: 'photo' | 'idProof'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const request = which === 'photo' ? this.api.setPhoto(this.id, file) : this.api.setIdProof(this.id, file);
    this.run(request, which === 'photo' ? 'Photo updated' : 'ID proof uploaded', () => {
      if (which === 'photo') this.photoVersion.set(String(Date.now()));
    });
  }

  protected openIdProof(): void {
    this.api.idProof(this.id).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  protected print(): void {
    openStaffCard(this.dialog, this.staff()!);
  }

  private run(request: Observable<Staff>, message: string | null, after?: () => void): void {
    this.busy.set(true);
    // Errors are reported by the error interceptor.
    request.subscribe({
      next: (s) => {
        this.staff.set(s);
        this.busy.set(false);
        after?.();
        if (message) this.snack.open(message, undefined, { duration: 3000 });
      },
      error: () => this.busy.set(false),
    });
  }
}
