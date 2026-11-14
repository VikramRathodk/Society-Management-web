import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { switchMap } from 'rxjs';

import { AuthStore } from '../../../core/auth/auth.store';
import { errorMessage } from '../../../core/auth/error.interceptor';
import { SocietyContextStore } from '../../../core/society-context/society-context.store';
import { Logo } from '../../../shared/ui';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    Logo,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly router = inject(Router);

  /** Bound from the `?returnUrl=` query param. */
  readonly returnUrl = input<string>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    phone: ['', [Validators.required, Validators.maxLength(15)]],
    password: ['', Validators.required],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly hidePassword = signal(true);

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.auth
      .login(this.form.getRawValue())
      // Pick the society before navigating, since route guards check permissions against it.
      .pipe(switchMap(() => this.ctx.load()))
      .subscribe({
        next: () => this.router.navigateByUrl(this.safeReturnUrl()),
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  /** Only follow same-app paths, so a crafted link can't redirect off-site. */
  private safeReturnUrl(): string {
    const url = this.returnUrl();
    return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/login')
      ? url
      : '/dashboard';
  }
}
