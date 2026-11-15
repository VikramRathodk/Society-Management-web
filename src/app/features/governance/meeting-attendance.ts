import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';

import { GovernanceApi } from '../../core/api/governance.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { AttendanceSheet, Meeting } from '../../core/models';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';

/** The attendance sheet on the day: tick who is present and watch the quorum. */
@Component({
  selector: 'app-meeting-attendance',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './meeting-attendance.html',
  styleUrl: './meeting-attendance.scss',
})
export class MeetingAttendance {
  private readonly api = inject(GovernanceApi);
  private readonly snack = inject(MatSnackBar);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly meeting = signal<Meeting | null>(null);
  protected readonly sheet = signal<AttendanceSheet | null>(null);
  protected readonly present = signal<ReadonlySet<number>>(new Set());
  protected readonly query = signal('');
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    return (this.sheet()?.people ?? []).filter(
      (p) => !q || (p.user.name ?? '').toLowerCase().includes(q),
    );
  });
  protected readonly presentCount = computed(() => this.present().size);

  constructor() {
    toObservable(this.id)
      .pipe(
        switchMap((id) =>
          forkJoin({ meeting: this.api.get(id), sheet: this.api.attendance(id) }).pipe(
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(errorMessage(err));
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if (!result) return;
        this.meeting.set(result.meeting);
        this.apply(result.sheet);
      });
  }

  protected toggle(userId: number, checked: boolean): void {
    this.present.update((set) => {
      const next = new Set(set);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
    this.dirty.set(true);
  }

  protected save(): void {
    const m = this.meeting();
    if (!m || this.saving()) return;
    this.saving.set(true);
    this.api.setAttendance(m.id, [...this.present()]).subscribe({
      next: (sheet) => {
        this.saving.set(false);
        this.apply(sheet);
        this.snack.open('Attendance saved', undefined, { duration: 3000 });
      },
      error: () => this.saving.set(false),
    });
  }

  private apply(sheet: AttendanceSheet): void {
    this.sheet.set(sheet);
    this.present.set(new Set(sheet.people.filter((p) => p.present).map((p) => p.user.id)));
    this.dirty.set(false);
  }
}
