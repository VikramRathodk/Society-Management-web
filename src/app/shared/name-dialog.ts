import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Observable, filter } from 'rxjs';

import { errorMessage } from '../core/auth/error.interceptor';

export interface NameDialogData<T> {
  title: string;
  label: string;
  value?: string;
  confirmText?: string;
  /** Called with the trimmed value; the dialog closes with its result, or shows a 400 inline. */
  save: (value: string) => Observable<T>;
}

/** Single-field dialog for adding or renaming things (wings, flats, ...). */
@Component({
  selector: 'app-name-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>{{ data.label }}</mat-label>
          <input matInput formControlName="value" cdkFocusInitial />
          @if (form.controls.value.invalid) {
            <mat-error>{{ data.label }} is required</mat-error>
          }
        </mat-form-field>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ data.confirmText ?? 'Save' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class NameDialog<T> {
  private readonly ref = inject<MatDialogRef<NameDialog<T>, T>>(MatDialogRef);
  protected readonly data = inject<NameDialogData<T>>(MAT_DIALOG_DATA);

  protected readonly form = new FormGroup({
    value: new FormControl(this.data.value ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/)],
    }),
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) return;
    const value = this.form.controls.value.value.trim();
    if (value === this.data.value) {
      this.ref.close();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.data.save(value).subscribe({
      next: (result) => this.ref.close(result),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        // Other statuses are already reported by the error interceptor.
        if (err.status === 400) this.error.set(errorMessage(err));
      },
    });
  }
}

/** Opens the dialog and emits the saved result; completes without emitting if cancelled. */
export function nameDialog<T>(dialog: MatDialog, data: NameDialogData<T>): Observable<T> {
  return dialog
    .open<NameDialog<T>, NameDialogData<T>, T>(NameDialog, { data, width: '400px' })
    .afterClosed()
    .pipe(filter((result): result is T => result !== undefined));
}
