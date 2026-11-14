import { HttpResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Observable, map } from 'rxjs';

/** The backend's limits for one report. */
const MAX_DAYS = 366;

export interface DateRange {
  /** ISO dates (yyyy-mm-dd), both inclusive. */
  from: string;
  to: string;
}

interface ExportDialogData {
  title: string;
  download: (range: DateRange) => Observable<HttpResponse<Blob>>;
}

/** Picks an inclusive date range (default: the last 30 days) and downloads the CSV for it. */
@Component({
  selector: 'app-export-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="hint">Downloads a CSV file you can open in Excel or Google Sheets.</p>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>From</mat-label>
            <input matInput type="date" formControlName="from" [max]="today" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>To</mat-label>
            <input matInput type="date" formControlName="to" [max]="today" />
          </mat-form-field>
        </div>
        @if (form.hasError('order')) {
          <p class="error" role="alert">"To" must not be before "From".</p>
        } @else if (form.hasError('tooLong')) {
          <p class="error" role="alert">A report can cover at most {{ maxDays }} days.</p>
        } @else if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">
          {{ busy() ? 'Preparing…' : 'Download' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .hint {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 0 12px;
    }
    .row mat-form-field {
      flex: 1 1 160px;
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ExportDialog {
  protected readonly data = inject<ExportDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ExportDialog>);

  protected readonly maxDays = MAX_DAYS;
  protected readonly today = isoDate(new Date());
  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      from: [isoDate(new Date(Date.now() - 29 * 86_400_000)), Validators.required],
      to: [this.today, Validators.required],
    },
    { validators: validRange },
  );
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.data.download(this.form.getRawValue()).subscribe({
      next: (res) => {
        saveFile(res.body!, fileName(res) ?? 'export.csv');
        this.ref.close(true);
      },
      error: (err: { status?: number }) => {
        this.busy.set(false);
        this.error.set(
          err.status === 400
            ? 'Too many records in this range; choose fewer days.'
            : "Couldn't download the report.",
        );
      },
    });
  }
}

/** Opens the export dialog; the download happens inside it. Emits true once a file was saved. */
export function exportDialog(dialog: MatDialog, data: ExportDialogData): Observable<boolean> {
  return dialog
    .open(ExportDialog, { data, width: '440px' })
    .afterClosed()
    .pipe(map((done) => done === true));
}

function validRange(group: AbstractControl): ValidationErrors | null {
  const { from, to } = group.value as DateRange;
  if (!from || !to) return null;
  if (to < from) return { order: true };
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return days >= MAX_DAYS ? { tooLong: true } : null;
}

/** Local calendar date as yyyy-mm-dd (not UTC, which can be a day off). */
function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Saves a CSV (or other blob) response under the server's filename. */
export function saveResponse(res: HttpResponse<Blob>, fallback = 'export.csv'): void {
  saveFile(res.body!, fileName(res) ?? fallback);
}

/** The filename from `Content-Disposition: attachment; filename="..."`, if present. */
function fileName(res: HttpResponse<Blob>): string | null {
  const header = res.headers.get('Content-Disposition') ?? '';
  return /filename="?([^";]+)"?/.exec(header)?.[1] ?? null;
}

/** Hands a blob to the browser as a file download. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url));
}
