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
import { MatSelectModule } from '@angular/material/select';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

import { InvitationApi } from '../../core/api/invitation.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { FlatInviteOption, IssuedInvitation, ResidentType } from '../../core/models';
import { RoleFields } from '../users/role-fields';
import { InviteShare } from './invite-share';
import { residentTypeLabel } from './invitation-ui';

export interface InviteDialogData {
  societyId: number;
  /** Open straight on the QR of this link (after "Show QR" resent it). */
  issued?: IssuedInvitation;
  /**
   * Resident mode: invite onto one of these flats (from /invitations/flat-options) instead of choosing
   * any role.
   */
  flatOptions?: FlatInviteOption[];
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
    MatSelectModule,
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
      <h2 mat-dialog-title>{{ flatOptions.length ? 'Invite to your flat' : 'Invite someone' }}</h2>
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
          @if (flatOptions.length) {
            @if (flatOptions.length > 1) {
              <mat-form-field appearance="outline">
                <mat-label>Flat</mat-label>
                <mat-select formControlName="flat">
                  @for (o of flatOptions; track o.flatId) {
                    <mat-option [value]="o">{{ o.flatLabel }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
            <mat-form-field appearance="outline">
              <mat-label>Joins {{ form.controls.flat.value?.flatLabel }} as</mat-label>
              <mat-select formControlName="residentType">
                @for (t of form.controls.flat.value?.residentTypes ?? []; track t) {
                  <mat-option [value]="t">{{ residentTypeLabel(t) }}</mat-option>
                }
              </mat-select>
              @if (form.controls.flat.value?.needsApproval) {
                <mat-hint>A committee member approves it before the link works.</mat-hint>
              }
              @if (form.controls.residentType.invalid) {
                <mat-error>Choose who they are</mat-error>
              }
            </mat-form-field>
          } @else {
            <app-role-fields [societyId]="data.societyId" source="invite" />
          }
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

  protected readonly flatOptions = this.data.flatOptions ?? [];
  protected readonly residentTypeLabel = residentTypeLabel;

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(255)]],
    phone: ['', [Validators.required, Validators.pattern(/^\s*\+?[0-9]{10,14}\s*$/)]],
    // Resident mode only.
    flat: this.fb.control<FlatInviteOption | null>(this.flatOptions[0] ?? null),
    residentType: this.fb.control<ResidentType | null>(
      onlyType(this.flatOptions[0]),
      this.flatOptions.length ? Validators.required : null,
    ),
  });
  protected readonly issued = signal<IssuedInvitation | null>(this.data.issued ?? null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // A flat whose resident offers one type (a tenant's flat: tenants only) needs no choice.
    this.form.controls.flat.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((flat) => this.form.controls.residentType.setValue(onlyType(flat)));
  }

  protected submit(): void {
    const residentMode = this.flatOptions.length > 0;
    const roleForm = residentMode ? null : (this.roleFields()?.form ?? null);
    if (this.form.invalid || (!residentMode && (!roleForm || roleForm.invalid)) || this.saving()) {
      this.form.markAllAsTouched();
      roleForm?.markAllAsTouched();
      return;
    }
    const { name, phone, flat, residentType: type } = this.form.getRawValue();
    const { role, flatId, residentType } =
      residentMode && flat
        ? { role: flat.role, flatId: flat.flatId, residentType: type ?? undefined }
        : this.roleFields()!.request();
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
    this.form.reset({
      flat: this.flatOptions[0] ?? null,
      residentType: onlyType(this.flatOptions[0]),
    });
    this.issued.set(null);
  }
}

function onlyType(option: FlatInviteOption | null | undefined): ResidentType | null {
  return option?.residentTypes.length === 1 ? option.residentTypes[0] : null;
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
