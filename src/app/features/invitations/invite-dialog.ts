import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Observable } from 'rxjs';

import { InvitationApi } from '../../core/api/invitation.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { IssuedInvitation } from '../../core/models';
import { RoleFields } from '../users/role-fields';
import { InviteShare } from './invite-share';

export interface InviteDialogData {
  societyId: number;
  /** Open straight on the QR of this link (after "Show QR" resent it). */
  issued?: IssuedInvitation;
}

/** Step 1: who and which role. Step 2: the QR code and ways to share the link. */
@Component({
  selector: 'app-invite-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    RoleFields,
    InviteShare,
  ],
  template: `
    @if (issued(); as issued) {
      <h2 mat-dialog-title>Invitation ready</h2>
      <mat-dialog-content>
        <app-invite-share [issued]="issued" />
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        @if (!data.issued) {
          <button mat-button type="button" (click)="another()">Invite another</button>
        }
        <button mat-flat-button [mat-dialog-close]="issued">Done</button>
      </mat-dialog-actions>
    } @else {
      <h2 mat-dialog-title>Invite someone</h2>
      <mat-dialog-content>
        <form [formGroup]="form" (ngSubmit)="submit()" id="invite-form">
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" autocomplete="off" />
            @if (form.controls.name.invalid) {
              <mat-error>Name is required</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Phone</mat-label>
            <input matInput formControlName="phone" type="tel" autocomplete="off" />
            <mat-hint>The invitation can only be accepted with this number.</mat-hint>
            @if (form.controls.phone.invalid) {
              <mat-error>10 to 14 digits, optionally starting with +</mat-error>
            }
          </mat-form-field>
          <app-role-fields [societyId]="data.societyId" source="invite" />
        </form>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" form="invite-form" [disabled]="saving()">
          Create invitation
        </button>
      </mat-dialog-actions>
    }
  `,
  styles: `
    form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-top: 8px;
    }
    .dialog-error {
      margin: 8px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class InviteDialog {
  private readonly api = inject(InvitationApi);
  private readonly ref = inject<MatDialogRef<InviteDialog, IssuedInvitation>>(MatDialogRef);
  private readonly roleFields = viewChild(RoleFields);
  protected readonly data = inject<InviteDialogData>(MAT_DIALOG_DATA);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(255)]],
    phone: ['', [Validators.required, Validators.pattern(/^\s*\+?[0-9]{10,14}\s*$/)]],
  });
  protected readonly issued = signal<IssuedInvitation | null>(this.data.issued ?? null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    const roleForm = this.roleFields()?.form;
    if (this.form.invalid || !roleForm || roleForm.invalid || this.saving()) {
      this.form.markAllAsTouched();
      roleForm?.markAllAsTouched();
      return;
    }
    const { role, flatId, residentType } = this.roleFields()!.request();
    const { name, phone } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .create(this.data.societyId, {
        name: name.trim(),
        phone: phone.trim(),
        role,
        flatId,
        residentType,
      })
      .subscribe({
        next: (issued) => {
          this.saving.set(false);
          this.issued.set(issued);
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  protected another(): void {
    this.form.reset();
    this.issued.set(null);
  }
}

/** Opens the invite dialog; emits the last link made (if any) when it closes. */
export function inviteDialog(
  dialog: MatDialog,
  data: InviteDialogData,
): Observable<IssuedInvitation | undefined> {
  return dialog
    .open<InviteDialog, InviteDialogData, IssuedInvitation>(InviteDialog, {
      data,
      width: '560px',
      maxWidth: '95vw',
      autoFocus: data.issued ? 'dialog' : 'first-tabbable',
    })
    .afterClosed();
}
