import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { RoleApi } from '../../core/api/role.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Role, RoleScope } from '../../core/models';
import { cycleConflicts } from './role-graph';

export interface RoleCreateDialogData {
  roles: Role[];
}

/** Define a custom role and its place in the hierarchy; permissions are set on its page after. */
@Component({
  selector: 'app-role-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './role-create-dialog.html',
  styleUrl: './role-create-dialog.scss',
})
export class RoleCreateDialog {
  private readonly api = inject(RoleApi);
  private readonly ref = inject<MatDialogRef<RoleCreateDialog, Role>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly data = inject<RoleCreateDialogData>(MAT_DIALOG_DATA);

  protected readonly form = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Z][A-Z0-9_]*$/)]],
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    description: [''],
    scopeLevel: this.fb.control<RoleScope>('SOCIETY'),
    requiresFlat: [false],
    inherits: this.fb.control<string[]>([]),
    includedIn: this.fb.control<string[]>([]),
  });
  protected readonly scope = toSignal(this.form.controls.scopeLevel.valueChanges, {
    initialValue: this.form.controls.scopeLevel.value,
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Role codes are UPPER_SNAKE_CASE; fix up what is typed. */
  protected normalizeCode(): void {
    const control = this.form.controls.code;
    const normalized = control.value.toUpperCase().replace(/[\s-]+/g, '_');
    if (normalized !== control.value) control.setValue(normalized);
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const conflicts = cycleConflicts(value.inherits, value.includedIn, this.data.roles);
    if (conflicts.length) {
      const names = conflicts.map((c) => this.data.roles.find((r) => r.code === c)?.name ?? c);
      this.error.set(`${names.join(', ')} can't be both above and below the new role.`);
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api
      .create({
        code: value.code,
        name: value.name.trim(),
        description: value.description.trim() || undefined,
        scopeLevel: value.scopeLevel,
        requiresFlat: value.scopeLevel === 'SOCIETY' && value.requiresFlat,
        inherits: value.inherits,
        includedIn: value.includedIn,
      })
      .subscribe({
        next: (role) => this.ref.close(role),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}
