import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Observable, filter } from 'rxjs';

import { UserApi } from '../../core/api/user.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { RoleAssignment, User } from '../../core/models';
import { sortBy } from '../../shared/sort';
import { FlatPreset, RoleFields } from './role-fields';

/** Suggestions shown at once; typing narrows them. */
const SHOWN = 20;

export interface AddResidentDialogData {
  societyId: number;
  /** "Wing A · 101" */
  flatLabel: string;
  preset: FlatPreset;
  /** The society's users to pick from; anyone already on this flat is left out. */
  users: readonly User[];
}

export interface AddResidentResult {
  user: User;
  assignment: RoleAssignment;
}

/** Gives an existing user a resident role on one flat. */
@Component({
  selector: 'app-add-resident-dialog',
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    RoleFields,
  ],
  template: `
    <h2 mat-dialog-title>Add resident to {{ data.flatLabel }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="user-field">
        <mat-label>User</mat-label>
        <input
          matInput
          [formControl]="userControl"
          [matAutocomplete]="auto"
          placeholder="Search by name or phone"
          cdkFocusInitial
        />
        <mat-autocomplete #auto="matAutocomplete" [displayWith]="userName">
          @for (user of matches(); track user.id) {
            <mat-option [value]="user">
              {{ user.name }} <span class="phone">{{ user.phone }}</span>
            </mat-option>
          } @empty {
            <mat-option disabled>No matching users</mat-option>
          }
        </mat-autocomplete>
        <mat-error>Pick a user from the list</mat-error>
        <mat-hint>Not listed? Use "New user" instead.</mat-hint>
      </mat-form-field>
      <app-role-fields [societyId]="data.societyId" [preset]="data.preset" />
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="submit()" [disabled]="saving()">Add</button>
    </mat-dialog-actions>
  `,
  styles: `
    .user-field {
      width: 100%;
      padding-top: 8px;
    }
    .phone {
      margin-left: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class AddResidentDialog {
  private readonly api = inject(UserApi);
  private readonly ref = inject<MatDialogRef<AddResidentDialog, AddResidentResult>>(MatDialogRef);
  private readonly roleFields = viewChild.required(RoleFields);
  protected readonly data = inject<AddResidentDialogData>(MAT_DIALOG_DATA);

  /** Text while typing, the chosen user once picked. */
  protected readonly userControl = new FormControl<string | User | null>(null, (c) =>
    typeof c.value === 'object' && c.value != null ? null : { pick: true },
  );
  private readonly query = toSignal(this.userControl.valueChanges, { initialValue: null });
  private readonly candidates = sortBy(
    this.data.users.filter(
      (u) => u.isActive && !u.roles.some((r) => r.flatId === this.data.preset.flatId),
    ),
    (u) => u.name,
  );
  protected readonly matches = computed(() => {
    const query = this.query();
    const text = typeof query === 'string' ? query.trim().toLowerCase() : '';
    return this.candidates
      .filter((u) => !text || u.name.toLowerCase().includes(text) || u.phone.includes(text))
      .slice(0, SHOWN);
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly userName = (user: User | string | null) =>
    typeof user === 'string' ? user : (user?.name ?? '');

  protected submit(): void {
    const user = this.userControl.value;
    const form = this.roleFields().form;
    if (typeof user !== 'object' || user == null || form.invalid || this.saving()) {
      this.userControl.markAsTouched();
      form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api.assignRole(user.id, this.roleFields().request()).subscribe({
      next: (assignment) => this.ref.close({ user, assignment }),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

/** Opens the dialog and emits once a resident was added; completes without emitting if cancelled. */
export function addResidentDialog(
  dialog: MatDialog,
  data: AddResidentDialogData,
): Observable<AddResidentResult> {
  return dialog
    .open<AddResidentDialog, AddResidentDialogData, AddResidentResult>(AddResidentDialog, {
      data,
      width: '440px',
    })
    .afterClosed()
    .pipe(filter((r): r is AddResidentResult => r !== undefined));
}
