import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Observable } from 'rxjs';

import { NoticeApi } from '../../core/api/notice.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Notice } from '../../core/models';

interface NoticeDialogData {
  societyId: number;
  /** Edit this notice; omit to post a new one. */
  notice?: Notice;
}

/** Post a notice, or edit one. Closes with the saved notice. */
@Component({
  selector: 'app-notice-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.notice ? 'Edit notice' : 'Post a notice' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>Title</mat-label>
          <input matInput formControlName="title" maxlength="255" cdkFocusInitial />
          @if (form.controls.title.hasError('maxlength')) {
            <mat-error>At most 255 characters</mat-error>
          } @else if (form.controls.title.invalid) {
            <mat-error>Title is required</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Details (optional)</mat-label>
          <textarea matInput formControlName="description" rows="6" maxlength="5000"></textarea>
          <mat-hint align="end">{{ form.controls.description.value.length }} / 5000</mat-hint>
        </mat-form-field>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ data.notice ? 'Save' : 'Post' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    form mat-form-field {
      width: 100%;
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class NoticeDialog {
  protected readonly data = inject<NoticeDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(NoticeApi);
  private readonly ref = inject(MatDialogRef<NoticeDialog, Notice>);

  protected readonly form = inject(NonNullableFormBuilder).group({
    title: [
      this.data.notice?.title ?? '',
      [Validators.required, Validators.pattern(/\S/), Validators.maxLength(255)],
    ],
    description: [this.data.notice?.description ?? '', Validators.maxLength(5000)],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const title = this.form.controls.title.value.trim();
    const description = this.form.controls.description.value.trim();
    this.saving.set(true);
    this.error.set(null);
    // On edit an empty description is sent as "" so the backend clears it.
    const request = this.data.notice
      ? this.api.update(this.data.notice.id, { title, description })
      : this.api.create(this.data.societyId, { title, description: description || undefined });
    request.subscribe({
      next: (notice) => this.ref.close(notice),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

/** Emits the saved notice, or undefined if the dialog was cancelled. */
export function noticeDialog(dialog: MatDialog, data: NoticeDialogData): Observable<Notice | undefined> {
  return dialog.open(NoticeDialog, { data, width: '560px' }).afterClosed();
}
