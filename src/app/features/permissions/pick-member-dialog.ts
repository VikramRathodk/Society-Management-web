import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

import { UserApi } from '../../core/api/user.api';
import { User } from '../../core/models';
import { sortBy } from '../../shared/sort';

export interface PickMemberDialogData {
  societyId: number;
  title: string;
  message: string;
  /** Left out of the list (the person being edited, the editor). */
  exclude: number[];
}

/** Picks another member of the society (e.g. to copy their permissions). Closes with their id. */
@Component({
  selector: 'app-pick-member-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="hint">{{ data.message }}</p>
      <mat-form-field appearance="outline" class="full">
        <mat-label>Person</mat-label>
        <mat-select [(ngModel)]="picked">
          @for (u of users(); track u.id) {
            <mat-option [value]="u.id">
              {{ u.name }}
              <span class="muted">· {{ rolesOf(u) }}</span>
            </mat-option>
          } @empty {
            <mat-option disabled>No one else in this society</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="picked == null" (click)="ref.close(picked)">
        Continue
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .full {
      width: 100%;
    }
    .hint,
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class PickMemberDialog {
  protected readonly data = inject<PickMemberDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<PickMemberDialog, number>);
  private readonly userApi = inject(UserApi);

  protected readonly users = signal<User[]>([]);
  protected picked: number | null = null;

  constructor() {
    this.userApi.list(this.data.societyId).subscribe({
      next: (list) =>
        this.users.set(
          sortBy(
            list.filter((u) => !this.data.exclude.includes(u.id)),
            (u) => u.name,
          ),
        ),
      error: () => {},
    });
  }

  protected rolesOf(user: User): string {
    return user.roles
      .filter((r) => r.societyId === this.data.societyId)
      .map((r) => r.roleName)
      .join(', ');
  }
}
