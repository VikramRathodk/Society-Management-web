import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, debounceTime, of, switchMap, tap } from 'rxjs';

import { StaffApi } from '../../core/api/staff.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Staff, StaffDirectoryQuery, StaffType } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton } from '../../shared/ui';
import { editStaffDialog } from './staff-dialogs';
import { STAFF_TYPES, StaffPhoto, StaffPhotos, StaffStatePill, monthOf, typeLabel } from './staff-ui';

type ViewKey = 'pending' | 'all' | 'domestic' | 'society' | 'blocked';

const VIEWS: { value: ViewKey; label: string; query: StaffDirectoryQuery }[] = [
  { value: 'pending', label: 'To verify', query: { status: 'PENDING' } },
  { value: 'all', label: 'Everyone', query: {} },
  { value: 'domestic', label: 'Domestic help', query: { kind: 'DOMESTIC' } },
  { value: 'society', label: 'Society staff', query: { kind: 'SOCIETY' } },
  { value: 'blocked', label: 'Blocked', query: { blocked: true } },
];

/**
 * The committee's staff registry: the verification queue first, everyone by kind, the block list;
 * the secretary adds society staff; attendance downloads as CSV.
 */
@Component({
  selector: 'app-staff-directory',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StaffPhoto,
    StaffStatePill,
  ],
  providers: [StaffPhotos],
  template: `
    <app-page-header title="Staff" [subtitle]="ctx.selectedSociety()?.name ?? null">
      @if (canExport()) {
        <mat-form-field appearance="outline" class="month" subscriptSizing="dynamic">
          <mat-label>Attendance for</mat-label>
          <input matInput type="month" [(ngModel)]="month" />
        </mat-form-field>
        <button mat-stroked-button (click)="export()" [disabled]="!month || exporting()">
          <mat-icon>download</mat-icon>
          Attendance CSV
        </button>
      }
      @if (canManage()) {
        <button mat-flat-button (click)="addSocietyStaff()">
          <mat-icon>person_add</mat-icon>
          Add society staff
        </button>
      }
    </app-page-header>

    <div class="toolbar">
      <mat-chip-listbox aria-label="Show" [hideSingleSelectionIndicator]="true" (change)="setView($event.value)">
        @for (v of views; track v.value) {
          <mat-chip-option [value]="v.value" [selected]="view() === v.value">{{ v.label }}</mat-chip-option>
        }
      </mat-chip-listbox>
      <mat-form-field appearance="outline" class="search" subscriptSizing="dynamic">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Name, phone or code</mat-label>
        <input matInput type="search" [value]="query()" (input)="query.set($any($event.target).value)" />
      </mat-form-field>
      <mat-form-field appearance="outline" class="type" subscriptSizing="dynamic">
        <mat-label>Works as</mat-label>
        <mat-select [value]="type()" (selectionChange)="type.set($event.value)">
          <mat-option [value]="null">Any</mat-option>
          @for (t of types; track t.value) {
            <mat-option [value]="t.value">{{ t.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>

    @if (loading()) {
      <app-skeleton variant="list" [count]="5" />
    } @else if (loadError()) {
      <app-empty-state icon="cloud_off" message="Couldn't load the staff.">
        <button mat-stroked-button (click)="reload()">Try again</button>
      </app-empty-state>
    } @else if (people().length === 0) {
      <app-empty-state [icon]="view() === 'pending' ? 'task_alt' : 'badge'" [message]="emptyMessage()" />
    } @else {
      <div class="list">
        @for (s of people(); track s.id) {
          <a class="item" [routerLink]="['/staff', s.id]">
            <app-staff-photo [staffId]="s.id" [name]="s.name" [hasPhoto]="!!s.photoUrl" />
            <div class="main">
              <strong>{{ s.name }}</strong>
              <span class="meta">{{ describe(s) }}</span>
            </div>
            <app-staff-state [staff]="s" />
          </a>
        }
      </div>
    }
  `,
  styles: `
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 16px;
      margin-bottom: 16px;
    }
    .search {
      flex: 1 1 220px;
      max-width: 360px;
    }
    .type {
      width: 180px;
    }
    .month {
      width: 190px;
    }
    .list {
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      overflow: hidden;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      color: inherit;
      text-decoration: none;
    }
    .item + .item {
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .item:hover {
      background: var(--mat-sys-surface-container-low);
    }
    .main {
      display: grid;
      flex: 1;
      min-width: 0;
    }
    .meta {
      overflow: hidden;
      color: var(--mat-sys-on-surface-variant);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class StaffDirectory {
  private readonly api = inject(StaffApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly views = VIEWS;
  protected readonly types = STAFF_TYPES;

  protected readonly view = signal<ViewKey>(
    (VIEWS.find((v) => v.value === inject(ActivatedRoute).snapshot.queryParamMap.get('view'))?.value ?? 'pending') as ViewKey,
  );
  protected readonly query = signal('');
  protected readonly type = signal<StaffType | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly exporting = signal(false);
  protected readonly people = signal<Staff[]>([]);
  protected month = monthOf(new Date());
  private readonly attempt = signal(0);

  private readonly can = (p: string) => this.auth.can(p, this.ctx.selectedSocietyId());
  protected readonly canManage = computed(() => this.can('STAFF.SOCIETY.MANAGE'));
  protected readonly canExport = computed(() => this.can('STAFF.ATTENDANCE.EXPORT'));

  protected readonly emptyMessage = computed(() => {
    if (this.query() || this.type()) return 'Nobody matches.';
    switch (this.view()) {
      case 'pending':
        return 'Nobody is waiting for verification.';
      case 'blocked':
        return 'Nobody is blocked.';
      case 'society':
        return 'No society staff yet.';
      default:
        return 'No staff registered yet. Residents add their help from "My staff".';
    }
  });

  constructor() {
    combineLatest([
      toObservable(this.ctx.selectedSocietyId),
      toObservable(this.view),
      toObservable(this.type),
      toObservable(this.query).pipe(debounceTime(250)),
      toObservable(this.attempt),
    ])
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadError.set(false);
        }),
        switchMap(([societyId, view, type, q]) => {
          if (societyId == null) return of([] as Staff[]);
          const base = VIEWS.find((v) => v.value === view)!.query;
          return this.api.directory(societyId, { ...base, type, q: q.trim() || null }).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loading.set(false);
        if (list) this.people.set(list);
        else this.loadError.set(true);
      });
  }

  protected setView(value: ViewKey | undefined): void {
    if (!value) return;
    this.view.set(value);
    this.router.navigate([], { queryParams: { view: value }, replaceUrl: true });
  }

  protected reload(): void {
    this.attempt.update((n) => n + 1);
  }

  /** "Maid · A-101, A-204" or "Night guard · society staff". */
  protected describe(s: Staff): string {
    const role = s.society?.designation || typeLabel(s.staffType);
    if (s.kind === 'SOCIETY') return `${role} · society staff${s.society?.leftOn ? ' · left' : ''}`;
    const flats = s.links.filter((l) => l.active).map((l) => l.flat);
    return `${role} · ${flats.length ? flats.join(', ') : 'no flat now'}`;
  }

  protected addSocietyStaff(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    editStaffDialog(this.dialog, { societyId, manager: true }).subscribe((s) =>
      this.router.navigate(['/staff', s.id]),
    );
  }

  protected export(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || !this.month) return;
    this.exporting.set(true);
    this.api.exportAttendance(societyId, this.month).subscribe({
      next: (res) => {
        this.exporting.set(false);
        saveResponse(res, `staff-attendance-${this.month}.csv`);
      },
      error: () => this.exporting.set(false),
    });
  }
}
