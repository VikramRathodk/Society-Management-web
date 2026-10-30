import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { switchMap } from 'rxjs';

import { UserApi } from '../../core/api/user.api';
import { AuthStore } from '../../core/auth/auth.store';
import { RoleAssignment } from '../../core/models';
import { PushService } from '../../core/push';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { PageHeader, Section } from '../../shared/ui';

/** The signed-in user's own name and email; reachable for residents, who can't open /users. */
@Component({
  selector: 'app-profile',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    PageHeader,
    Section,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly api = inject(UserApi);
  private readonly ctx = inject(SocietyContextStore);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(AuthStore);
  protected readonly push = inject(PushService);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    email: ['', Validators.email],
  });
  protected readonly saving = signal(false);
  protected readonly canEdit = computed(() => this.auth.can('USER.PROFILE.UPDATE'));

  constructor() {
    // Fill the form once the user is known (and again after a save refreshes it).
    effect(() => {
      const user = this.auth.user();
      const canEdit = this.canEdit();
      untracked(() => {
        if (user) this.form.reset({ name: user.name, email: user.email ?? '' });
        if (canEdit) this.form.enable();
        else this.form.disable();
      });
    });
  }

  protected roleContext(a: RoleAssignment): string {
    if (a.societyId == null) return 'Platform-wide';
    const society =
      this.ctx.societies().find((s) => s.id === a.societyId)?.name ?? `Society #${a.societyId}`;
    return a.residentType
      ? `${society} · ${a.residentType.charAt(0)}${a.residentType.slice(1).toLowerCase()}`
      : society;
  }

  protected save(): void {
    const user = this.auth.user();
    if (!user || this.form.invalid || this.saving()) return;
    const { name, email } = this.form.getRawValue();
    this.saving.set(true);
    this.api
      .update(user.id, { name: name.trim(), email: email.trim() || undefined })
      .pipe(switchMap(() => this.auth.restore())) // refresh the name in the top bar
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.snack.open('Profile saved', undefined, { duration: 3000 });
        },
        error: () => this.saving.set(false), // reported by the error interceptor
      });
  }
}
