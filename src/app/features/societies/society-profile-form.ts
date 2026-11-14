import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { SocietyApi } from '../../core/api/society.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Society } from '../../core/models';

const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const LOGO_MAX_BYTES = 1024 * 1024;

/**
 * The society's profile: what going live needs (address, city, state, PIN, contact phone) plus the
 * registration number, email, logo and free-text notes. Setup step 1, and the settings page later.
 */
@Component({
  selector: 'app-society-profile-form',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()">
      <div class="logo-row">
        <div class="logo" [class.empty]="!logoUrl()">
          @if (logoUrl(); as url) {
            <img [src]="url" alt="Society logo" />
          } @else {
            <mat-icon aria-hidden="true">apartment</mat-icon>
          }
        </div>
        <div class="logo-actions">
          <button
            mat-stroked-button
            type="button"
            (click)="logoInput.click()"
            [disabled]="logoBusy()"
          >
            <mat-icon>upload</mat-icon> {{ society().hasLogo ? 'Change logo' : 'Add logo' }}
          </button>
          @if (society().hasLogo) {
            <button mat-button type="button" (click)="removeLogo()" [disabled]="logoBusy()">
              Remove
            </button>
          }
          <span class="hint">Optional · JPEG, PNG or WebP, up to 1 MB</span>
          <input
            #logoInput
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            (change)="pickLogo($event)"
            data-testid="logo-input"
          />
        </div>
      </div>

      <mat-form-field appearance="outline">
        <mat-label>Name</mat-label>
        <input matInput formControlName="name" />
        @if (form.controls.name.invalid) {
          <mat-error>Name is required</mat-error>
        }
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Registration number</mat-label>
        <input matInput formControlName="registrationNumber" placeholder="e.g. PNA/HSG/1234" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Address</mat-label>
        <textarea matInput formControlName="address" rows="2" required></textarea>
      </mat-form-field>

      <div class="row">
        <mat-form-field appearance="outline">
          <mat-label>City</mat-label>
          <input matInput formControlName="city" required />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>State</mat-label>
          <input matInput formControlName="state" required />
        </mat-form-field>
        <mat-form-field appearance="outline" class="pin">
          <mat-label>PIN code</mat-label>
          <input matInput formControlName="pincode" inputmode="numeric" maxlength="6" required />
          @if (form.controls.pincode.invalid) {
            <mat-error>6 digits</mat-error>
          }
        </mat-form-field>
      </div>

      <div class="row">
        <mat-form-field appearance="outline">
          <mat-label>Contact phone</mat-label>
          <input matInput formControlName="contactPhone" inputmode="tel" required />
          @if (form.controls.contactPhone.invalid) {
            <mat-error>A phone number of 10 to 14 digits</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Contact email</mat-label>
          <input matInput formControlName="contactEmail" type="email" />
          @if (form.controls.contactEmail.invalid) {
            <mat-error>Not an email address</mat-error>
          }
        </mat-form-field>
      </div>

      <mat-form-field appearance="outline">
        <mat-label>Notes</mat-label>
        <textarea
          matInput
          formControlName="notes"
          rows="3"
          maxlength="2000"
          placeholder="Anything else worth recording: water tank cleaning, lift contract, …"
        ></textarea>
        <mat-hint align="end">{{ form.controls.notes.value.length }} / 2000</mat-hint>
      </mat-form-field>

      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      <div class="form-actions">
        <button mat-flat-button type="submit" [disabled]="form.pristine || saving()">
          Save profile
        </button>
      </div>
    </form>
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
    .row .pin {
      flex: 0 1 140px;
    }
    .logo-row {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .logo {
      width: 72px;
      height: 72px;
      border-radius: 16px;
      overflow: hidden;
      display: grid;
      place-items: center;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    .logo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .logo-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .form-error {
      color: var(--mat-sys-error);
    }
    .form-actions {
      display: flex;
      justify-content: flex-end;
    }
  `,
})
export class SocietyProfileForm {
  private readonly societies = inject(SocietyApi);
  private readonly onboarding = inject(OnboardingApi);
  private readonly snack = inject(MatSnackBar);

  readonly society = input.required<Society>();
  /** After each save (profile or logo), with the society as the server has it. */
  readonly saved = output<Society>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    registrationNumber: [''],
    address: [''],
    city: [''],
    state: [''],
    pincode: ['', Validators.pattern(/^\s*([1-9][0-9]{5})?\s*$/)],
    contactPhone: ['', Validators.pattern(/^\s*(\+?[0-9]{10,14})?\s*$/)],
    contactEmail: ['', Validators.email],
    notes: [''],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly logoUrl = signal<string | null>(null);
  protected readonly logoBusy = signal(false);
  private loadedLogoFor: string | null = null;

  constructor() {
    effect(() => {
      const s = this.society();
      this.form.reset({
        name: s.name,
        registrationNumber: s.registrationNumber ?? '',
        address: s.address ?? '',
        city: s.city ?? '',
        state: s.state ?? '',
        pincode: s.pincode ?? '',
        contactPhone: s.contactPhone ?? '',
        contactEmail: s.contactEmail ?? '',
        notes: s.notes ?? '',
      });
      untracked(() => this.loadLogo(s));
    });
    inject(DestroyRef).onDestroy(() => this.setLogoUrl(null));
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const t = (s: string) => s.trim();
    this.saving.set(true);
    this.error.set(null);
    this.societies
      .update(this.society().id, {
        name: t(v.name),
        registrationNumber: t(v.registrationNumber),
        address: t(v.address),
        city: t(v.city),
        state: t(v.state),
        pincode: t(v.pincode),
        contactPhone: t(v.contactPhone),
        contactEmail: t(v.contactEmail),
        notes: t(v.notes),
      })
      .subscribe({
        next: (society) => {
          this.saving.set(false);
          this.snack.open('Profile saved', undefined, { duration: 3000 });
          this.saved.emit(society);
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          if (err.status === 400) this.error.set(errorMessage(err));
        },
      });
  }

  protected pickLogo(event: Event): void {
    const field = event.target as HTMLInputElement;
    const file = field.files?.[0];
    field.value = ''; // picking the same file again still fires change
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      this.snack.open('A logo must be a JPEG, PNG or WebP image', undefined, { duration: 4000 });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      this.snack.open('A logo can be at most 1 MB', undefined, { duration: 4000 });
      return;
    }
    this.logoBusy.set(true);
    this.onboarding.uploadLogo(this.society().id, file).subscribe({
      next: (society) => this.logoSaved(society),
      error: () => this.logoBusy.set(false),
    });
  }

  protected removeLogo(): void {
    this.logoBusy.set(true);
    this.onboarding.removeLogo(this.society().id).subscribe({
      next: (society) => this.logoSaved(society),
      error: () => this.logoBusy.set(false),
    });
  }

  private logoSaved(society: Society): void {
    this.logoBusy.set(false);
    this.loadedLogoFor = null; // a new picture under the same society
    this.saved.emit(society);
  }

  private loadLogo(s: Society): void {
    const key = `${s.id}:${s.hasLogo}`;
    if (!s.hasLogo) {
      this.loadedLogoFor = key;
      this.setLogoUrl(null);
      return;
    }
    if (this.loadedLogoFor === key) return;
    this.loadedLogoFor = key;
    this.onboarding.logo(s.id).subscribe({
      next: (blob) => this.setLogoUrl(URL.createObjectURL(blob)),
      error: () => this.setLogoUrl(null),
    });
  }

  private setLogoUrl(url: string | null): void {
    const old = this.logoUrl();
    if (old) URL.revokeObjectURL(old);
    this.logoUrl.set(url);
  }
}
