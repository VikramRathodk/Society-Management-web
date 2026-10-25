import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';

import { UserApi } from '../../core/api/user.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { RoleFields } from './role-fields';

/** Create a user together with their first role (guide section 7.1). */
@Component({
  selector: 'app-user-create',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    RoleFields,
  ],
  templateUrl: './user-create.html',
  styleUrl: './user-create.scss',
})
export class UserCreate {
  private readonly api = inject(UserApi);
  private readonly router = inject(Router);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly includePlatformRoles = inject(AuthStore).canOnPlatform('USER.ACCOUNT.CREATE');

  private readonly roleFields = viewChild.required(RoleFields);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    phone: ['', [Validators.required, Validators.maxLength(15)]],
    email: ['', Validators.email],
    password: ['', Validators.required],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly hidePassword = signal(true);

  protected submit(): void {
    const roleForm = this.roleFields().form;
    if (this.form.invalid || roleForm.invalid || this.saving()) {
      this.form.markAllAsTouched();
      roleForm.markAllAsTouched();
      return;
    }
    const { name, phone, email, password } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .create({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        password,
        ...this.roleFields().request(),
      })
      .subscribe({
        next: (user) => this.router.navigate(user?.id ? ['/users', user.id] : ['/users']),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}
