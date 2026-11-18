import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, LOCALE_ID, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Observable, catchError, forkJoin, of, switchMap } from 'rxjs';

import { GovernanceApi } from '../../core/api/governance.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Meeting, Minutes } from '../../core/models';
import { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton } from '../../shared/ui';
import { RulesText, fileSize } from '../policies/policy-ui';
import { MEETING_KIND, OUTCOME } from './governance-ui';

const MAX_BODY = 100_000;
const MAX_FILE = 5 * 1024 * 1024;

/** A first draft of the minutes from the meeting: who was there, each item and its result. */
export function minutesTemplate(m: Meeting, locale: string): string {
  const when = formatDate(m.scheduledAt, 'EEEE d MMMM y, h:mm a', locale);
  const lines = [
    `# Minutes of the ${MEETING_KIND[m.kind].label.toLowerCase()}`,
    `${m.title}, held on ${when}${m.place ? ` at ${m.place}` : ''}.`,
  ];
  if (m.chairperson) lines.push(`Chaired by ${m.chairperson.name}.`);
  if (m.quorumRequired != null) {
    const unit = m.general ? 'member flats' : 'committee members';
    const met =
      (m.quorumPresent ?? 0) >= m.quorumRequired
        ? 'The quorum was present.'
        : 'The quorum was not present.';
    lines.push(
      '',
      '## Attendance',
      `${m.quorumPresent} ${unit} present; ${m.quorumRequired} needed. ${met}`,
    );
  }
  for (const item of m.agenda) {
    lines.push('', `## ${item.position}. ${item.title}`);
    if (item.description) lines.push(item.description);
    if (item.resolutionText) {
      lines.push(
        `Resolution${item.resolutionNumber ? ` ${item.resolutionNumber}` : ''}: ${item.resolutionText}`,
      );
      if (item.proposedBy)
        lines.push(
          `Proposed by ${item.proposedBy.name}${item.secondedBy ? `, seconded by ${item.secondedBy.name}` : ''}.`,
        );
    }
    if (item.outcome) {
      const r = item.results;
      lines.push(
        `- ${OUTCOME[item.outcome].label}${r ? ` (for ${r.votesFor}, against ${r.votesAgainst}, abstained ${r.abstained})` : ''}`,
      );
    }
    lines.push('- Discussion: ');
  }
  lines.push('', 'The meeting ended with a vote of thanks to the chair.');
  return lines.join('\n');
}

/** Writes the minutes of a held meeting (secretary and above), from a template on first open. */
@Component({
  selector: 'app-minutes-editor',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    RulesText,
    Section,
    Skeleton,
  ],
  templateUrl: './minutes-editor.html',
  styleUrl: './minutes-editor.scss',
})
export class MinutesEditor implements HasUnsavedChanges {
  private readonly api = inject(GovernanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly meeting = signal<Meeting | null>(null);
  protected readonly minutes = signal<Minutes | null>(null);
  protected readonly body = signal('');
  protected readonly mode = signal<'write' | 'preview'>('write');
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dirty = signal(false);
  protected readonly maxBody = MAX_BODY;
  protected readonly fileSize = fileSize;

  constructor() {
    toObservable(this.id)
      .pipe(
        switchMap((id) =>
          forkJoin({
            meeting: this.api.get(id),
            minutes: this.api.minutes(id).pipe(catchError(() => of(null))),
          }).pipe(
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
        const { meeting, minutes } = result;
        this.meeting.set(meeting);
        this.minutes.set(minutes);
        if (minutes && minutes.status !== 'DRAFT') {
          this.loadError.set(
            minutes.status === 'PENDING'
              ? 'The minutes are waiting for approval; they can be edited if sent back.'
              : 'The minutes are published; add a correction from the meeting page instead.',
          );
          return;
        }
        if (meeting.status !== 'HELD') {
          this.loadError.set('Minutes are written once the meeting is marked held.');
          return;
        }
        this.body.set(minutes?.body || minutesTemplate(meeting, this.locale));
        this.dirty.set(!minutes);
      });
  }

  canLeave(): boolean | Observable<boolean> {
    if (!this.dirty()) return true;
    return confirmDialog(this.dialog, {
      title: 'Leave without saving?',
      message: 'Your changes to the minutes will be lost.',
      confirmText: 'Leave',
    });
  }

  protected edit(value: string): void {
    this.body.set(value);
    this.dirty.set(true);
  }

  protected chooseFile(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE) {
      this.error.set('Files can be at most 5 MB.');
      return;
    }
    this.save(false, () =>
      this.api.setMinutesAttachment(this.id(), file).subscribe({
        next: (saved) => this.minutes.set(saved),
        error: (err: HttpErrorResponse) => this.error.set(errorMessage(err)),
      }),
    );
  }

  protected removeFile(): void {
    this.api.removeMinutesAttachment(this.id()).subscribe((saved) => this.minutes.set(saved));
  }

  protected save(submit = false, then?: () => void): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .saveMinutes(this.id(), this.body())
      .pipe(switchMap((saved) => (submit ? this.api.submitMinutes(this.id()) : of(saved))))
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.minutes.set(saved);
          this.dirty.set(false);
          if (then) {
            then();
            return;
          }
          this.snack.open(submit ? 'Sent for approval' : 'Saved', undefined, { duration: 3000 });
          if (submit) this.router.navigate(['/meetings', this.id()]);
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  protected back(): void {
    this.router.navigate(['/meetings', this.id()]);
  }
}
