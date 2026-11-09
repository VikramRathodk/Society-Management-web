import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';

import { InvitationApi } from '../../core/api/invitation.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { InvitationPreview, InvitationStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { dayLabel, residentTypeLabel } from './invitation-ui';

type Load = { preview: InvitationPreview } | { error: string };

const CLOSED_MESSAGE: Partial<Record<InvitationStatus, string>> = {
  ACCEPTED: 'This invitation has already been accepted. Sign in to continue.',
  DECLINED: 'This invitation was declined.',
  REVOKED: 'This invitation was cancelled. Ask the society for a new one.',
  EXPIRED: 'This invitation has expired. Ask the society to send it again.',
  REJECTED: 'This invitation was not approved.',
  AWAITING_APPROVAL: 'Thanks! The society committee still has to approve this invitation.',
};

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const { password, confirm } = group.value as { password: string; confirm: string };
  return confirm && password !== confirm ? { mismatch: true } : null;
}

/**
 * Where an invitation link or QR code lands. Public: a new person signs up here; someone with an
 * account signs in first and accepts onto it.
 */
@Component({
  selector: 'app-accept-invitation',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './accept-invitation.html',
  styleUrl: './accept-invitation.scss',
})
export class AcceptInvitation {
  private readonly api = inject(InvitationApi);
  private readonly ctx = inject(SocietyContextStore);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(AuthStore);

  /** Bound from the `:token` route param. */
  readonly token = input.required<string>();

  protected readonly load = signal<Load | null>(null);
  protected readonly preview = computed(() => {
    const l = this.load();
    return l && 'preview' in l ? l.preview : null;
  });
  protected readonly closedMessage = computed(() => {
    const p = this.preview();
    return p && p.status !== 'PENDING'
      ? (CLOSED_MESSAGE[p.status] ?? 'This invitation is closed.')
      : null;
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly hidePassword = signal(true);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(255)]],
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
      confirm: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  protected readonly dayLabel = dayLabel;
  protected readonly residentTypeLabel = residentTypeLabel;

  constructor() {
    toObservable(this.token)
      .pipe(
        tap(() => this.load.set(null)),
        switchMap((token) => this.fetch(token)),
        takeUntilDestroyed(),
      )
      .subscribe((load) => this.show(load));
  }

  /** New person: create the account, then sign straight in with the same phone and password. */
  protected signUp(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, password } = this.form.getRawValue();
    this.run(
      this.api
        .accept(this.token(), { name: name.trim(), password })
        .pipe(
          switchMap((invitation) =>
            this.auth.login({ phone: invitation.phone, password }).pipe(map(() => invitation)),
          ),
        ),
    );
  }

  /** Signed in: add the role to this account (the backend checks the phone matches). */
  protected acceptSignedIn(): void {
    if (this.busy()) return;
    this.run(
      this.api
        .accept(this.token())
        .pipe(switchMap((invitation) => this.auth.restore().pipe(map(() => invitation)))),
    );
  }

  protected signIn(): void {
    this.router.navigate(['/login'], { queryParams: { returnUrl: `/invite/${this.token()}` } });
  }

  /** Signed in with another account: sign out and stay here to use the right one. */
  protected switchAccount(): void {
    this.auth.logout();
    this.error.set(null);
  }

  protected decline(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api
      .decline(this.token())
      .pipe(switchMap(() => this.fetch(this.token())))
      .subscribe({
        next: (load) => {
          this.busy.set(false);
          this.show(load);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  private run(accept: Observable<{ societyName: string }>): void {
    this.busy.set(true);
    this.error.set(null);
    accept
      // Load the societies before navigating: route guards check permissions against the selected one.
      .pipe(switchMap((invitation) => this.ctx.load().pipe(map(() => invitation))))
      .subscribe({
        next: (invitation) => {
          this.snack.open(`Welcome to ${invitation.societyName}`, undefined, { duration: 4000 });
          this.router.navigateByUrl('/dashboard');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.error.set(errorMessage(err));
          // The invitation may have changed meanwhile (expired, cancelled): show its current state.
          if (err.status === 409) this.fetch(this.token()).subscribe((load) => this.show(load));
        },
      });
  }

  private fetch(token: string): Observable<Load> {
    return this.api.preview(token).pipe(
      map((preview): Load => ({ preview })),
      catchError((err: HttpErrorResponse) =>
        of<Load>({
          error:
            err.status === 404
              ? 'This invitation link is not valid. It may have been replaced by a newer one; ask the society for a new link.'
              : errorMessage(err),
        }),
      ),
    );
  }

  private show(load: Load): void {
    this.load.set(load);
    if ('preview' in load && !this.form.controls.name.value) {
      this.form.controls.name.setValue(load.preview.name);
    }
  }
}
