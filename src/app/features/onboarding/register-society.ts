import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { ApplicationStatusView } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { StatusPill } from '../../shared/ui';
import { PHONE_PATTERN } from '../societies/society-create-dialog';
import { APPLICATION_STATUS } from './onboarding-ui';

type Mode = 'register' | 'status';

/**
 * Public: a secretary registers their society. Nothing is created until the platform calls them to
 * confirm and approves it; the same page looks up a registration by its number and phone. A signed-in
 * user registers with their own account.
 */
@Component({
  selector: 'app-register-society',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    StatusPill,
  ],
  templateUrl: './register-society.html',
  styleUrl: './register-society.scss',
})
export class RegisterSociety {
  private readonly api = inject(OnboardingApi);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly ctx = inject(SocietyContextStore);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);

  protected readonly enabled = signal<boolean | null>(null);
  protected readonly mode = signal<Mode>('register');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly submitted = signal<{ view: ApplicationStatusView; phone: string } | null>(
    null,
  );
  protected readonly found = signal<ApplicationStatusView | null>(null);
  protected readonly lookupError = signal<string | null>(null);
  protected readonly statusOf = (s: ApplicationStatusView) => APPLICATION_STATUS[s.status];

  protected readonly form = this.fb.group({
    societyName: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(255)]],
    city: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(100)]],
    address: ['', Validators.maxLength(500)],
    approxFlats: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(10000)]),
    applicantName: ['', Validators.maxLength(255)],
    applicantPhone: ['', Validators.pattern(PHONE_PATTERN)],
    applicantEmail: ['', Validators.email],
    password: ['', [Validators.minLength(8), Validators.maxLength(72)]],
    message: ['', Validators.maxLength(1000)],
  });

  protected readonly lookup = this.fb.group({
    number: this.fb.control<number | null>(null, Validators.required),
    phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
  });

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    if (q.get('number')) {
      this.mode.set('status');
      this.lookup.patchValue({ number: Number(q.get('number')), phone: q.get('phone') ?? '' });
    }
    // New applicants need their own name, phone and password.
    if (!this.auth.isAuthenticated()) {
      for (const name of ['applicantName', 'applicantPhone', 'password'] as const) {
        this.form.controls[name].addValidators(Validators.required);
      }
    }
    this.api.selfSignupEnabled().subscribe({
      next: (on) => this.enabled.set(on),
      error: () => this.enabled.set(true), // the form still answers if registration is closed
    });
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const t = (s: string) => s.trim() || undefined;
    const signedIn = this.auth.isAuthenticated();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .apply({
        societyName: v.societyName.trim(),
        city: v.city.trim(),
        address: t(v.address),
        approxFlats: v.approxFlats ?? undefined,
        message: t(v.message),
        ...(signedIn
          ? {}
          : {
              applicantName: t(v.applicantName),
              applicantPhone: t(v.applicantPhone),
              applicantEmail: t(v.applicantEmail),
              password: v.password,
            }),
      })
      .subscribe({
        next: (view) => {
          this.saving.set(false);
          const phone = signedIn ? (this.auth.user()?.phone ?? '') : v.applicantPhone.trim();
          this.submitted.set({ view, phone });
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  protected check(): void {
    if (this.lookup.invalid) {
      this.lookup.markAllAsTouched();
      return;
    }
    const { number, phone } = this.lookup.getRawValue();
    this.lookupError.set(null);
    this.found.set(null);
    this.api.applicationStatus(number!, phone.trim()).subscribe({
      next: (view) => this.found.set(view),
      error: (err: HttpErrorResponse) => this.lookupError.set(errorMessage(err)),
    });
  }

  protected showStatus(): void {
    const s = this.submitted();
    if (s) this.lookup.patchValue({ number: s.view.number, phone: s.phone });
    this.mode.set('status');
    this.submitted.set(null); // leave the thank-you page for the lookup
    this.check();
  }

  /** A signed-in applicant who was just approved: load the new role and open the setup. */
  protected openSociety(): void {
    this.auth
      .restore()
      .pipe(switchMap(() => this.ctx.load()))
      .subscribe(() => void this.router.navigate(['/dashboard']));
  }
}
