/**
 * Complaint presentation pieces shared by the complaint pages and the dashboard. Add further
 * complaint UI here rather than in new files.
 */
import { HttpErrorResponse } from '@angular/common/http';
import { Component, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';

import { ComplaintApi, ComplaintMove } from '../../core/api/complaint.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Complaint, ComplaintCategory, ComplaintStatus } from '../../core/models';
import { StatusPill, Tone } from '../../shared/ui';
import { timeAgo } from '../visitors/visitor-ui';

/** How each status reads and is coloured everywhere. */
export const COMPLAINT_STATUS: Record<ComplaintStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'warning' },
  IN_PROGRESS: { label: 'In progress', tone: 'primary' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export const COMPLAINT_CATEGORIES: { value: ComplaintCategory; label: string; icon: string }[] = [
  { value: 'PLUMBING', label: 'Plumbing', icon: 'plumbing' },
  { value: 'ELECTRICAL', label: 'Electrical', icon: 'electrical_services' },
  { value: 'SECURITY', label: 'Security', icon: 'shield' },
  { value: 'OTHER', label: 'Other', icon: 'report' },
];

export function categoryOf(value: ComplaintCategory) {
  return COMPLAINT_CATEGORIES.find((c) => c.value === value) ?? COMPLAINT_CATEGORIES[3];
}

/** While the author may still edit or withdraw it. */
export const EDITABLE_STATUSES: readonly ComplaintStatus[] = ['OPEN', 'IN_PROGRESS'];

/** A status change the committee can make, with the permission and wording it needs. */
export interface MoveOption {
  move: ComplaintMove;
  label: string;
  icon: string;
  permission: string;
  /** Prompt shown in the note dialog. */
  noteHint: string;
  primary?: boolean;
}

const APPROVE = 'COMPLAINT.RESOLUTION.APPROVE';
const REJECT = 'COMPLAINT.RESOLUTION.REJECT';

const START: MoveOption = {
  move: 'start',
  label: 'Start work',
  icon: 'construction',
  permission: APPROVE,
  noteHint: 'e.g. Plumber booked for tomorrow',
};
const RESOLVE: MoveOption = {
  move: 'resolve',
  label: 'Mark resolved',
  icon: 'task_alt',
  permission: APPROVE,
  noteHint: 'How was it fixed?',
  primary: true,
};
const CLOSE: MoveOption = {
  move: 'close',
  label: 'Close',
  icon: 'lock',
  permission: APPROVE,
  noteHint: 'Optional closing remark',
  primary: true,
};
const REOPEN: MoveOption = {
  move: 'reopen',
  label: 'Reopen',
  icon: 'replay',
  permission: REJECT,
  noteHint: 'Why is it being reopened?',
};

/** Mirrors the backend workflow: which moves each status allows. */
export const MOVES: Record<ComplaintStatus, MoveOption[]> = {
  OPEN: [START, RESOLVE],
  IN_PROGRESS: [RESOLVE],
  RESOLVED: [REOPEN, CLOSE],
  CLOSED: [],
};

/**
 * One complaint as a list row: category icon, description, flat and who raised it, status and
 * time. `compact` drops the who trail for dashboards.
 */
@Component({
  selector: 'app-complaint-row',
  imports: [MatIconModule, StatusPill],
  template: `
    <span class="icon"
      ><mat-icon>{{ category().icon }}</mat-icon></span
    >
    <div class="main">
      <div class="title">{{ complaint().description }}</div>
      <div class="meta">
        {{ category().label }} · Flat {{ complaint().flatNumber }}
        @if (!compact()) {
          · Raised by {{ complaint().raisedByName }}
        }
      </div>
    </div>
    <div class="side">
      <app-status-pill [tone]="status().tone">{{ status().label }}</app-status-pill>
      <span class="time">{{ when() }}</span>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 20px;
    }
    .icon {
      display: grid;
      flex-shrink: 0;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    .main {
      flex: 1;
      min-width: 0;
    }
    .title {
      overflow: hidden;
      font: var(--mat-sys-title-small);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta,
    .time {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .side {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }
    .time {
      white-space: nowrap;
    }
    @media (max-width: 599.98px) {
      :host {
        padding: 12px 16px;
      }
    }
  `,
})
export class ComplaintRow {
  readonly complaint = input.required<Complaint>();
  readonly compact = input(false, { transform: booleanAttribute });

  protected readonly status = computed(() => COMPLAINT_STATUS[this.complaint().status]);
  protected readonly category = computed(() => categoryOf(this.complaint().category));
  protected readonly when = computed(() => timeAgo(this.complaint().createdAt));
}

interface MoveDialogData {
  complaint: Complaint;
  option: MoveOption;
}

/** Confirms a status change with an optional note. Closes with the updated complaint. */
@Component({
  selector: 'app-complaint-move-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.option.label }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="what">{{ data.complaint.description }} · Flat {{ data.complaint.flatNumber }}</p>
        <mat-form-field appearance="outline">
          <mat-label>Note (optional)</mat-label>
          <textarea
            matInput
            formControlName="note"
            rows="3"
            maxlength="2000"
            [placeholder]="data.option.noteHint"
          ></textarea>
          <mat-hint>Shown to the resident in the complaint's history</mat-hint>
        </mat-form-field>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">{{ data.option.label }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .what {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
      overflow-wrap: anywhere;
    }
    mat-form-field {
      width: 100%;
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ComplaintMoveDialog {
  protected readonly data = inject<MoveDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(ComplaintApi);
  private readonly ref = inject(MatDialogRef<ComplaintMoveDialog, Complaint>);

  protected readonly form = inject(NonNullableFormBuilder).group({
    note: ['', Validators.maxLength(2000)],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    const note = this.form.controls.note.value.trim() || undefined;
    this.api.move(this.data.complaint.id, this.data.option.move, note).subscribe({
      next: (complaint) => this.ref.close(complaint),
      // A 409 means someone else moved it meanwhile; the page re-fetches when the dialog closes.
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

/** Emits the updated complaint, or undefined if cancelled. */
export function moveDialog(dialog: MatDialog, data: MoveDialogData): Observable<Complaint | undefined> {
  return dialog.open(ComplaintMoveDialog, { data, width: '480px' }).afterClosed();
}

/** The author edits category and description. Closes with the updated complaint. */
@Component({
  selector: 'app-complaint-edit-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>Edit complaint</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>Category</mat-label>
          <mat-select formControlName="category">
            @for (c of categories; track c.value) {
              <mat-option [value]="c.value">{{ c.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>What's wrong?</mat-label>
          <textarea matInput formControlName="description" rows="5" maxlength="5000"></textarea>
          @if (form.controls.description.invalid) {
            <mat-error>Describe the problem</mat-error>
          }
        </mat-form-field>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Save</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ComplaintEditDialog {
  protected readonly complaint = inject<Complaint>(MAT_DIALOG_DATA);
  private readonly api = inject(ComplaintApi);
  private readonly ref = inject(MatDialogRef<ComplaintEditDialog, Complaint>);

  protected readonly categories = COMPLAINT_CATEGORIES;
  protected readonly form = inject(NonNullableFormBuilder).group({
    category: [this.complaint.category],
    description: [
      this.complaint.description,
      [Validators.required, Validators.pattern(/\S/), Validators.maxLength(5000)],
    ],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { category, description } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api.update(this.complaint.id, { category, description: description.trim() }).subscribe({
      next: (complaint) => this.ref.close(complaint),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

/** Emits the updated complaint, or undefined if cancelled. */
export function editComplaintDialog(dialog: MatDialog, complaint: Complaint): Observable<Complaint | undefined> {
  return dialog.open(ComplaintEditDialog, { data: complaint, width: '520px' }).afterClosed();
}
