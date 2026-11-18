import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';

import { errorMessage } from '../../core/auth/error.interceptor';
import {
  AgendaItem,
  MeetingKind,
  MeetingPerson,
  MeetingStatus,
  Outcome,
  VoteChoice,
} from '../../core/models';
import { Tone } from '../../shared/ui';
import { CanMatchFn, Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';

/** Members see general meetings, the committee its own meetings too. */
export function canOpenMeetings(auth: AuthStore, societyId: number | null): boolean {
  return (
    auth.can('GOVERNANCE.MEETING.VIEW', societyId) ||
    auth.can('GOVERNANCE.COMMITTEE.VIEW', societyId)
  );
}

export const meetingsGuard: CanMatchFn = () =>
  canOpenMeetings(inject(AuthStore), inject(SocietyContextStore).selectedSocietyId()) ||
  inject(Router).createUrlTree(['/forbidden']);

// ---- Labels ----

export const MEETING_KIND: Record<MeetingKind, { label: string; short: string; icon: string }> = {
  AGM: { label: 'Annual general meeting', short: 'AGM', icon: 'groups' },
  SGM: { label: 'Special general meeting', short: 'SGM', icon: 'groups' },
  COMMITTEE: { label: 'Committee meeting', short: 'Committee', icon: 'diversity_3' },
};

export const MEETING_STATUS: Record<MeetingStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  NOTICE_SENT: { label: 'Announced', tone: 'primary' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  ADJOURNED: { label: 'Adjourned', tone: 'warning' },
  HELD: { label: 'Held', tone: 'success' },
  MINUTES_PUBLISHED: { label: 'Minutes published', tone: 'success' },
};

export const OUTCOME: Record<Outcome, { label: string; tone: Tone; icon: string }> = {
  PASSED: { label: 'Passed', tone: 'success', icon: 'check_circle' },
  REJECTED: { label: 'Not passed', tone: 'danger', icon: 'cancel' },
  DEFERRED: { label: 'Deferred', tone: 'neutral', icon: 'schedule' },
};

export const VOTE_CHOICE: Record<VoteChoice, string> = {
  FOR: 'For',
  AGAINST: 'Against',
  ABSTAIN: 'Abstain',
};

/** A `datetime-local` value (local time) from an ISO instant, and back. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/** Whole days from today to the meeting's day (local time). */
export function daysUntil(iso: string): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(new Date(iso)) - day(new Date())) / 86_400_000);
}

/** "Turnout 3 of 12 (25%)". */
export function turnoutText(item: AgendaItem, electorate: number): string {
  const percent = electorate ? Math.round((item.turnout / electorate) * 100) : 0;
  return `${item.turnout} of ${electorate} voted (${percent}%)`;
}

// ---- A reason (cancel, send back, short notice, correction) ----

export interface ReasonDialogData {
  title: string;
  message?: string;
  label: string;
  confirmText: string;
  maxLength?: number;
  /** Sends the text; errors show in the dialog. Closes with what it emits. */
  submit: (text: string) => Observable<unknown>;
}

@Component({
  selector: 'app-reason-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="send()" novalidate>
      <mat-dialog-content>
        @if (data.message) {
          <p class="lead">{{ data.message }}</p>
        }
        <mat-form-field appearance="outline">
          <mat-label>{{ data.label }}</mat-label>
          <textarea
            matInput
            formControlName="text"
            rows="4"
            [attr.maxlength]="max"
            cdkFocusInitial
          ></textarea>
          <mat-hint align="end">{{ form.controls.text.value.length }} / {{ max }}</mat-hint>
          @if (form.controls.text.invalid) {
            <mat-error>Required</mat-error>
          }
        </mat-form-field>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">{{ data.confirmText }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .lead {
      margin: 0 0 16px;
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ReasonDialog {
  protected readonly data = inject<ReasonDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ReasonDialog>);
  protected readonly max = this.data.maxLength ?? 500;
  protected readonly form = inject(NonNullableFormBuilder).group({
    text: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(this.max)]],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected send(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.data.submit(this.form.controls.text.value.trim()).subscribe({
      next: (result) => this.ref.close(result ?? true),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function reasonDialog<T>(
  dialog: MatDialog,
  data: ReasonDialogData,
): Observable<T | undefined> {
  return dialog.open(ReasonDialog, { data, width: '520px' }).afterClosed();
}

// ---- Adjourn ----

export interface AdjournDialogData {
  title: string;
  after: string;
  place: string | null;
  onlineLink: string | null;
  submit: (request: {
    scheduledAt: string;
    place: string | null;
    onlineLink: string | null;
    reason: string;
  }) => Observable<unknown>;
}

@Component({
  selector: 'app-adjourn-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Adjourn {{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="send()" novalidate>
      <mat-dialog-content>
        <p class="lead">
          The meeting moves to a new date with the same agenda, and everyone invited is told.
        </p>
        <mat-form-field appearance="outline">
          <mat-label>New date and time</mat-label>
          <input matInput type="datetime-local" formControlName="scheduledAt" />
          @if (form.controls.scheduledAt.invalid) {
            <mat-error>Choose when</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Place</mat-label>
          <input matInput formControlName="place" maxlength="300" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Online link</mat-label>
          <input matInput formControlName="onlineLink" maxlength="500" placeholder="https://" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Reason</mat-label>
          <textarea matInput formControlName="reason" rows="3" maxlength="500"></textarea>
          @if (form.controls.reason.invalid) {
            <mat-error>Give a reason, e.g. no quorum</mat-error>
          }
        </mat-form-field>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Adjourn</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .lead {
      margin: 0 0 16px;
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class AdjournDialog {
  protected readonly data = inject<AdjournDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<AdjournDialog>);
  protected readonly form = inject(NonNullableFormBuilder).group({
    scheduledAt: ['', Validators.required],
    place: [this.data.place ?? ''],
    onlineLink: [this.data.onlineLink ?? ''],
    reason: ['', [Validators.required, Validators.pattern(/\S/)]],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected send(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.data
      .submit({
        scheduledAt: fromLocalInput(v.scheduledAt),
        place: v.place.trim() || null,
        onlineLink: v.onlineLink.trim() || null,
        reason: v.reason.trim(),
      })
      .subscribe({
        next: (result) => this.ref.close(result),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

export function adjournDialog<T>(
  dialog: MatDialog,
  data: AdjournDialogData,
): Observable<T | undefined> {
  return dialog.open(AdjournDialog, { data, width: '520px' }).afterClosed();
}

// ---- Open voting (proposer and seconder) ----

export interface OpenVotingDialogData {
  item: AgendaItem;
  people: MeetingPerson[];
  submit: (proposedBy: number | null, secondedBy: number | null) => Observable<unknown>;
}

@Component({
  selector: 'app-open-voting-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>Open voting</h2>
    <form [formGroup]="form" (ngSubmit)="send()" novalidate>
      <mat-dialog-content>
        <p class="lead">
          <strong>{{ data.item.title }}</strong
          ><br />
          {{ data.item.resolutionText }}
        </p>
        <p class="hint">
          Members get a push and vote in the app. The ballot is secret: only the totals are shown,
          after you close voting.
        </p>
        <mat-form-field appearance="outline">
          <mat-label>Proposed by (optional)</mat-label>
          <mat-select formControlName="proposedBy">
            <mat-option [value]="null">—</mat-option>
            @for (p of data.people; track p.id) {
              <mat-option [value]="p.id">{{ p.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Seconded by (optional)</mat-label>
          <mat-select formControlName="secondedBy">
            <mat-option [value]="null">—</mat-option>
            @for (p of data.people; track p.id) {
              <mat-option [value]="p.id">{{ p.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Open voting</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .lead {
      margin: 0 0 8px;
      white-space: pre-line;
    }
    .hint {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class OpenVotingDialog {
  protected readonly data = inject<OpenVotingDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<OpenVotingDialog>);
  protected readonly form = inject(NonNullableFormBuilder).group({
    proposedBy: [null as number | null],
    secondedBy: [null as number | null],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected send(): void {
    if (this.saving()) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.data.submit(v.proposedBy, v.secondedBy).subscribe({
      next: (result) => this.ref.close(result),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function openVotingDialog<T>(
  dialog: MatDialog,
  data: OpenVotingDialogData,
): Observable<T | undefined> {
  return dialog.open(OpenVotingDialog, { data, width: '520px' }).afterClosed();
}

// ---- Vote ----

export interface VoteDialogData {
  item: AgendaItem;
  /** Flats the caller still votes for (more than one: they choose). */
  flats: { id: number; label: string }[];
  submit: (choice: VoteChoice, flatId: number | null) => Observable<unknown>;
}

@Component({
  selector: 'app-vote-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatRadioModule,
    MatSelectModule,
    MatFormFieldModule,
  ],
  template: `
    <h2 mat-dialog-title>Your vote</h2>
    <form [formGroup]="form" (ngSubmit)="send()" novalidate>
      <mat-dialog-content>
        <p class="lead">
          <strong>{{ data.item.title }}</strong
          ><br />
          {{ data.item.resolutionText }}
        </p>
        @if (data.flats.length > 1) {
          <mat-form-field appearance="outline">
            <mat-label>Voting for flat</mat-label>
            <mat-select formControlName="flatId">
              @for (f of data.flats; track f.id) {
                <mat-option [value]="f.id">{{ f.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <mat-radio-group formControlName="choice" class="choices" aria-label="Your vote">
          <mat-radio-button value="FOR">For</mat-radio-button>
          <mat-radio-button value="AGAINST">Against</mat-radio-button>
          <mat-radio-button value="ABSTAIN">Abstain</mat-radio-button>
        </mat-radio-group>
        <p class="hint">
          Your vote is secret and final: nobody sees how you voted, and it can't be changed.
        </p>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Cast vote</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .lead {
      margin: 0 0 16px;
      white-space: pre-line;
    }
    .choices {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }
    .hint {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class VoteDialog {
  protected readonly data = inject<VoteDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<VoteDialog>);
  protected readonly form = inject(NonNullableFormBuilder).group({
    choice: ['' as VoteChoice | '', Validators.required],
    flatId: [this.data.flats[0]?.id ?? (null as number | null)],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected send(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.error.set('Choose For, Against or Abstain.');
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.data
      .submit(v.choice as VoteChoice, this.data.flats.length > 1 ? v.flatId : null)
      .subscribe({
        next: (result) => this.ref.close(result),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

export function voteDialog<T>(dialog: MatDialog, data: VoteDialogData): Observable<T | undefined> {
  return dialog.open(VoteDialog, { data, width: '480px' }).afterClosed();
}
