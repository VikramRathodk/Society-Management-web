import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { SocietyApi } from '../../core/api/society.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Complex, Society } from '../../core/models';
import { sortBy } from '../../shared/sort';

@Component({
  selector: 'app-society-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>New society</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial />
          @if (form.controls.name.invalid) {
            <mat-error>Name is required</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Address</mat-label>
          <textarea matInput formControlName="address" rows="2"></textarea>
        </mat-form-field>

        @if (canPickComplex) {
          <mat-form-field appearance="outline">
            <mat-label>Complex</mat-label>
            <mat-select formControlName="complexId">
              <mat-option [value]="null">None</mat-option>
              @for (complex of complexes(); track complex.id) {
                <mat-option [value]="complex.id">{{ complex.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Create</button>
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
export class SocietyCreateDialog {
  private readonly api = inject(SocietyApi);
  private readonly ref = inject<MatDialogRef<SocietyCreateDialog, Society>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly canPickComplex = inject(AuthStore).canOnPlatform('COMPLEX.SETTINGS.VIEW');
  protected readonly complexes = signal<Complex[]>([]);
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    address: [''],
    complexId: this.fb.control<number | null>(null),
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (this.canPickComplex) {
      this.api.complexes().subscribe({
        next: (list) => this.complexes.set(sortBy(list, (c) => c.name)),
        error: () => {}, // the field just stays at "None"
      });
    }
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, address, complexId } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .create({
        name: name.trim(),
        address: address.trim() || undefined,
        complexId: complexId ?? undefined,
      })
      .subscribe({
        next: (society) => this.ref.close(society),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          if (err.status === 400) this.error.set(errorMessage(err));
        },
      });
  }
}
