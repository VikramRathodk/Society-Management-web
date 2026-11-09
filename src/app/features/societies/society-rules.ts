import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, of, switchMap, tap } from 'rxjs';

import { SocietyApi } from '../../core/api/society.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  SocietySetting,
  SocietySettingChanges,
  SocietySettingGroup,
  SocietySettings,
} from '../../core/models';
import { EmptyState, Section, Skeleton } from '../../shared/ui';
import { changedSettings, limitText, settingValidators, valueText } from './society-rules-ui';

/**
 * A society's configurable rules, drawn entirely from the settings API: one card per group, one
 * field per setting by its type. A setting added on the backend shows up here without changes.
 */
@Component({
  selector: 'app-society-rules',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    EmptyState,
    Section,
    Skeleton,
  ],
  templateUrl: './society-rules.html',
  styleUrl: './society-rules.scss',
})
export class SocietyRules {
  private readonly api = inject(SocietyApi);
  private readonly snack = inject(MatSnackBar);

  readonly societyId = input.required<number>();

  protected readonly groups = signal<SocietySettingGroup[] | null>(null);
  protected readonly loading = signal(true);
  /** Key of the group being saved. */
  protected readonly saving = signal<string | null>(null);
  /** Inline 400 message per group key. */
  protected readonly errors = signal<Record<string, string>>({});
  private forms: Record<string, FormGroup> = {};

  protected readonly valueText = valueText;
  protected readonly limitText = limitText;

  constructor() {
    toObservable(this.societyId)
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap((id) => this.api.settings(id).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((settings) => {
        this.loading.set(false);
        this.apply(settings);
      });
  }

  protected formOf(group: SocietySettingGroup): FormGroup {
    return this.forms[group.key];
  }

  protected save(group: SocietySettingGroup): void {
    const form = this.formOf(group);
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    const changes = changedSettings(group.settings, form.getRawValue());
    if (Object.keys(changes).length === 0) {
      form.markAsPristine();
      return;
    }
    this.send(group, changes, 'Settings saved');
  }

  protected reset(group: SocietySettingGroup, setting: SocietySetting): void {
    this.send(group, { [setting.key]: null }, `${setting.label}: back to the default`);
  }

  private send(group: SocietySettingGroup, changes: SocietySettingChanges, done: string): void {
    if (this.saving()) return;
    this.saving.set(group.key);
    this.setError(group.key, null);
    this.api.updateSettings(this.societyId(), changes).subscribe({
      next: (settings) => {
        this.saving.set(null);
        this.apply(settings);
        this.snack.open(done, undefined, { duration: 3000 });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(null);
        if (err.status === 400) this.setError(group.key, errorMessage(err));
      },
    });
  }

  private apply(settings: SocietySettings | null): void {
    const groups = settings?.groups ?? null;
    this.forms = {};
    for (const group of groups ?? []) {
      const controls: Record<string, FormControl> = {};
      for (const s of group.settings) {
        controls[s.key] = new FormControl(s.value, {
          nonNullable: true,
          validators: settingValidators(s),
        });
      }
      this.forms[group.key] = new FormGroup(controls);
    }
    this.groups.set(groups);
  }

  private setError(groupKey: string, message: string | null): void {
    const { [groupKey]: _, ...rest } = this.errors();
    this.errors.set(message ? { ...rest, [groupKey]: message } : rest);
  }
}
