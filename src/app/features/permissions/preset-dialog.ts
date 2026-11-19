import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { SocietyPermissionApi } from '../../core/api/society-permission.api';
import { PermissionCatalogEntry, PermissionPreset } from '../../core/models';
import { PermissionDraft, changeOf, cycle, draftOf } from './permission-draft';
import { SocietyPermissionMatrix } from './society-permission-matrix';

export interface PresetDialogData {
  societyId: number;
  catalog: readonly PermissionCatalogEntry[];
  /** Editing this one; omitted for a new preset. */
  preset?: PermissionPreset;
}

/** Creates or edits a preset: a name and the permissions it adds or removes when applied. */
@Component({
  selector: 'app-preset-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SocietyPermissionMatrix,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.preset ? 'Edit preset' : 'New preset' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content>
        <div class="fields">
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" maxlength="100" placeholder="Treasurer" />
            @if (form.controls.name.invalid) {
              <mat-error>Name is required</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Description</mat-label>
            <input matInput formControlName="description" maxlength="500" />
          </mat-form-field>
        </div>
        <p class="hint">
          Click a box once to <strong>add</strong> that permission, again to
          <strong>remove</strong> it, and a third time to leave it as it is. Applying the preset to
          someone changes only these.
        </p>
        <app-society-permission-matrix
          mode="preset"
          [catalog]="data.catalog"
          [draft]="draft()"
          (toggled)="draft.set(cycleCode($event))"
        />
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <span class="count">{{ count() }}</span>
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="form.invalid || !count() || saving()">
          Save preset
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0 12px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 12px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .count {
      margin-right: auto;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class PresetDialog {
  protected readonly data = inject<PresetDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<PresetDialog, PermissionPreset>);
  private readonly api = inject(SocietyPermissionApi);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.data.preset?.name ?? '', [Validators.required, Validators.pattern(/\S/)]],
    description: [this.data.preset?.description ?? ''],
  });
  protected readonly draft = signal<PermissionDraft>(
    draftOf(this.data.preset?.grant ?? [], this.data.preset?.revoke ?? []),
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly count = computed(() => {
    const d = this.draft();
    const parts = [
      d.added.size ? `${d.added.size} added` : null,
      d.removed.size ? `${d.removed.size} removed` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  });

  protected cycleCode(code: string): PermissionDraft {
    return cycle(this.draft(), code);
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    const { name, description } = this.form.getRawValue();
    const { grant, revoke } = changeOf(this.draft());
    const body = { name: name.trim(), description: description.trim() || null, grant, revoke };
    this.saving.set(true);
    this.error.set(null);
    const request = this.data.preset
      ? this.api.updatePreset(this.data.preset.id, body)
      : this.api.createPreset(this.data.societyId, body);
    request.subscribe({
      next: (preset) => this.ref.close(preset),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(err.error?.message ?? 'Could not save the preset');
      },
    });
  }
}
