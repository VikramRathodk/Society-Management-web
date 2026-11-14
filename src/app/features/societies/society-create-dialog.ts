import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { SocietyApi } from '../../core/api/society.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Complex, NewSocietyResponse, Society } from '../../core/models';
import { sortBy } from '../../shared/sort';
import { InviteShare } from '../invitations/invite-share';

export const PHONE_PATTERN = /^\s*\+?[0-9]{10,14}\s*$/;

/**
 * Platform-led onboarding: the society (in Setup, unless it is already running) and its secretary's
 * invitation in one go. Afterwards the dialog shows the secretary's link to hand over. Once created,
 * only "Done" closes it.
 */
@Component({
  selector: 'app-society-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    InviteShare,
  ],
  template: `
    @if (created(); as done) {
      <h2 mat-dialog-title>{{ done.society.name }} is ready</h2>
      <mat-dialog-content>
        <p class="lead">
          @if (done.society.status === 'SETUP') {
            Send this link to the secretary. They sign up with it and set the society up: profile,
            wings and flats, residents. It goes live when they're done.
          } @else {
            Send this link to the secretary to sign up.
          }
        </p>
        <app-invite-share [issued]="done.secretaryInvitation" />
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-flat-button type="button" (click)="close()">Done</button>
      </mat-dialog-actions>
    } @else {
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

          <p class="group-label">Secretary</p>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Secretary's name</mat-label>
              <input matInput formControlName="secretaryName" autocomplete="off" />
              @if (form.controls.secretaryName.invalid) {
                <mat-error>Name is required</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Secretary's phone</mat-label>
              <input matInput formControlName="secretaryPhone" inputmode="tel" autocomplete="off" />
              @if (form.controls.secretaryPhone.invalid) {
                <mat-error>A phone number of 10 to 14 digits</mat-error>
              }
            </mat-form-field>
          </div>

          <mat-checkbox formControlName="startLive">
            Already running: skip the setup and make it live now
          </mat-checkbox>

          @if (error(); as message) {
            <p class="dialog-error" role="alert">{{ message }}</p>
          }
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>Cancel</button>
          <button mat-flat-button type="submit" [disabled]="saving()">Create and invite</button>
        </mat-dialog-actions>
      </form>
    }
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .row mat-form-field {
      flex: 1 1 180px;
    }
    .group-label {
      margin: 4px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .lead {
      margin-top: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .dialog-error {
      margin: 8px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class SocietyCreateDialog {
  private readonly api = inject(SocietyApi);
  private readonly onboarding = inject(OnboardingApi);
  private readonly ref = inject<MatDialogRef<SocietyCreateDialog, Society>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly canPickComplex = inject(AuthStore).canOnPlatform('COMPLEX.SETTINGS.VIEW');
  protected readonly complexes = signal<Complex[]>([]);
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    address: [''],
    complexId: this.fb.control<number | null>(null),
    secretaryName: ['', [Validators.required, Validators.pattern(/\S/)]],
    secretaryPhone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
    startLive: [false],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly created = signal<NewSocietyResponse | null>(null);

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
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.onboarding
      .createWithSecretary({
        name: v.name.trim(),
        address: v.address.trim() || undefined,
        complexId: v.complexId ?? undefined,
        startLive: v.startLive,
        secretary: { name: v.secretaryName.trim(), phone: v.secretaryPhone.trim() },
      })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.created.set(res);
          // From here only "Done" closes it, so the new society always reaches the list.
          this.ref.disableClose = true;
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  protected close(): void {
    this.ref.close(this.created()?.society);
  }
}
