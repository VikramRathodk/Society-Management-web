import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Observable, catchError, of, switchMap } from 'rxjs';

import { GovernanceApi } from '../../core/api/governance.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Meeting, MeetingKind, MeetingRequest } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton } from '../../shared/ui';
import { MEETING_KIND, fromLocalInput, toLocalInput } from './governance-ui';

type AgendaForm = FormGroup<{
  title: import('@angular/forms').FormControl<string>;
  description: import('@angular/forms').FormControl<string>;
  resolutionText: import('@angular/forms').FormControl<string>;
}>;

/** Plans a meeting (or edits its draft): kind, time, place or link, and the agenda with resolutions. */
@Component({
  selector: 'app-meeting-editor',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
  ],
  templateUrl: './meeting-editor.html',
  styleUrl: './meeting-editor.scss',
})
export class MeetingEditor implements HasUnsavedChanges {
  private readonly api = inject(GovernanceApi);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  /** Absent for a new meeting. */
  readonly id = input<string | undefined>(undefined);

  protected readonly kinds = Object.entries(MEETING_KIND) as [
    MeetingKind,
    (typeof MEETING_KIND)[MeetingKind],
  ][];
  protected readonly form = this.fb.group({
    kind: ['AGM' as MeetingKind, Validators.required],
    title: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(200)]],
    description: ['', Validators.maxLength(4000)],
    scheduledAt: ['', Validators.required],
    place: ['', Validators.maxLength(300)],
    onlineLink: ['', [Validators.maxLength(500), Validators.pattern(/^(https?:\/\/\S+)?$/)]],
    agenda: this.fb.array<AgendaForm>([]),
  });
  protected readonly meeting = signal<Meeting | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly isNew = computed(() => this.id() == null);
  private saved = false;

  constructor() {
    toObservable(this.id)
      .pipe(
        switchMap((id) =>
          id == null
            ? of(null)
            : this.api.get(Number(id)).pipe(
                catchError((err: HttpErrorResponse) => {
                  this.loadError.set(
                    err.status === 404
                      ? "This meeting doesn't exist or isn't yours to edit."
                      : "Couldn't load the meeting.",
                  );
                  return of(undefined);
                }),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((meeting) => {
        this.loading.set(false);
        if (meeting === undefined) return;
        this.meeting.set(meeting);
        if (meeting) this.fill(meeting);
        else if (this.agenda.length === 0) {
          // A first, empty item to fill in; not a change until the user types.
          this.addItem();
          this.form.markAsPristine();
        }
      });
  }

  protected get agenda(): FormArray<AgendaForm> {
    return this.form.controls.agenda;
  }

  protected addItem(title = '', description = '', resolutionText = ''): void {
    this.agenda.push(
      this.fb.group({
        title: [title, [Validators.required, Validators.pattern(/\S/), Validators.maxLength(300)]],
        description: [description, Validators.maxLength(4000)],
        resolutionText: [resolutionText, Validators.maxLength(4000)],
      }),
    );
    this.form.markAsDirty();
  }

  protected removeItem(index: number): void {
    this.agenda.removeAt(index);
    this.form.markAsDirty();
  }

  protected moveItem(index: number, by: -1 | 1): void {
    const target = index + by;
    if (target < 0 || target >= this.agenda.length) return;
    const item = this.agenda.at(index);
    this.agenda.removeAt(index);
    this.agenda.insert(target, item);
    this.form.markAsDirty();
  }

  canLeave(): boolean | Observable<boolean> {
    if (this.saved || !this.form.dirty) return true;
    return confirmDialog(this.dialog, {
      title: 'Leave without saving?',
      message: 'Your changes to this meeting will be lost.',
      confirmText: 'Leave',
    });
  }

  protected save(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    if (!v.place.trim() && !v.onlineLink.trim()) {
      this.error.set('Give a place, an online link, or both.');
      return;
    }
    const societyId = this.meeting()?.societyId ?? this.ctx.selectedSocietyId();
    if (societyId == null) return;
    const request: MeetingRequest = {
      kind: v.kind,
      title: v.title.trim(),
      description: v.description.trim() || null,
      scheduledAt: fromLocalInput(v.scheduledAt),
      place: v.place.trim() || null,
      onlineLink: v.onlineLink.trim() || null,
      agenda: v.agenda.map((a) => ({
        title: a.title.trim(),
        description: a.description.trim() || null,
        resolutionText: a.resolutionText.trim() || null,
      })),
    };
    this.saving.set(true);
    this.error.set(null);
    const existing = this.meeting();
    (existing
      ? this.api.update(existing.id, request)
      : this.api.create(societyId, request)
    ).subscribe({
      next: (saved) => {
        this.saved = true;
        this.saving.set(false);
        this.snack.open('Saved as a draft', undefined, { duration: 3000 });
        this.router.navigate(['/meetings', saved.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  protected cancel(): void {
    const m = this.meeting();
    this.router.navigate(m ? ['/meetings', m.id] : ['/meetings']);
  }

  private fill(m: Meeting): void {
    this.form.patchValue({
      kind: m.kind,
      title: m.title,
      description: m.description ?? '',
      scheduledAt: toLocalInput(m.scheduledAt),
      place: m.place ?? '',
      onlineLink: m.onlineLink ?? '',
    });
    this.agenda.clear();
    m.agenda.forEach((a) => this.addItem(a.title, a.description ?? '', a.resolutionText ?? ''));
    this.form.markAsPristine();
  }
}
