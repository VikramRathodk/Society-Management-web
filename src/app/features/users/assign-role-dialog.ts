import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

import { UserApi } from '../../core/api/user.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { RoleAssignment } from '../../core/models';
import { RoleFields } from './role-fields';

export interface AssignRoleDialogData {
  userId: number;
  userName: string;
  societyId: number | null;
  includePlatform: boolean;
}

@Component({
  selector: 'app-assign-role-dialog',
  imports: [MatButtonModule, MatDialogModule, RoleFields],
  template: `
    <h2 mat-dialog-title>Assign role to {{ data.userName }}</h2>
    <mat-dialog-content>
      <app-role-fields [societyId]="data.societyId" [includePlatform]="data.includePlatform" />
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="submit()" [disabled]="saving()">Assign</button>
    </mat-dialog-actions>
  `,
  styles: `
    app-role-fields {
      display: block;
      padding-top: 8px;
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class AssignRoleDialog {
  private readonly api = inject(UserApi);
  private readonly ref = inject<MatDialogRef<AssignRoleDialog, RoleAssignment>>(MatDialogRef);
  private readonly roleFields = viewChild.required(RoleFields);
  protected readonly data = inject<AssignRoleDialogData>(MAT_DIALOG_DATA);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    const form = this.roleFields().form;
    if (form.invalid || this.saving()) {
      form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api.assignRole(this.data.userId, this.roleFields().request()).subscribe({
      next: (assignment) => this.ref.close(assignment),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}
