import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { UserApi } from '../../core/api/user.api';
import { errorMessage } from '../../core/auth/error.interceptor';

export interface ResetPasswordDialogData {
  userId: number;
  userName: string;
}

/**
 * Sets a new password for someone who forgot theirs; the admin passes it on. Closes with `true`
 * once saved. Every error (rank too low, too short, ...) is shown here, not as a snackbar.
 */
@Component({
  selector: 'app-reset-password-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Reset password</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <p class="hint">
          Set a new password for {{ data.userName }}, then pass it on to them. They can change it
          from their profile.
        </p>
        <mat-form-field appearance="outline">
          <mat-label>New password</mat-label>
          <input
            matInput
            formControlName="newPassword"
            [type]="hide() ? 'password' : 'text'"
            autocomplete="new-password"
            cdkFocusInitial
          />
          <button
            mat-icon-button
            matSuffix
            type="button"
            (click)="hide.set(!hide())"
            [attr.aria-label]="hide() ? 'Show passwords' : 'Hide passwords'"
          >
            <mat-icon>{{ hide() ? 'visibility' : 'visibility_off' }}</mat-icon>
          </button>
          <mat-hint>At least 8 characters</mat-hint>
          @if (form.controls.newPassword.hasError('required')) {
            <mat-error>New password is required</mat-error>
          } @else if (form.controls.newPassword.hasError('minlength')) {
            <mat-error>At least 8 characters</mat-error>
          } @else if (form.controls.newPassword.hasError('maxlength')) {
            <mat-error>At most 72 characters</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Confirm new password</mat-label>
          <input
            matInput
            formControlName="confirmPassword"
            [type]="hide() ? 'password' : 'text'"
            autocomplete="new-password"
          />
        </mat-form-field>
        @if (form.hasError('mismatch') && form.controls.confirmPassword.touched) {
          <p class="dialog-error" role="alert">Passwords don't match</p>
        } @else if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Reset password</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .hint {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ResetPasswordDialog {
  private readonly api = inject(UserApi);
  private readonly ref = inject<MatDialogRef<ResetPasswordDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<ResetPasswordDialogData>(MAT_DIALOG_DATA);

  // Same limits as the backend: at least 8 characters, at most 72 (all BCrypt reads).
  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly hide = signal(true);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api
      .resetPassword(this.data.userId, { newPassword: this.form.controls.newPassword.value })
      .subscribe({
        next: () => this.ref.close(true),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const { newPassword, confirmPassword } = group.value as Record<string, string>;
  return confirmPassword && newPassword !== confirmPassword ? { mismatch: true } : null;
}
