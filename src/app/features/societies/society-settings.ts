import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap, tap } from 'rxjs';

import { SocietyApi } from '../../core/api/society.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Society } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Section, Skeleton } from '../../shared/ui';
import { SocietyRules } from './society-rules';

@Component({
  selector: 'app-society-settings',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    Skeleton,
    EmptyState,
    PageHeader,
    Section,
    SocietyRules,
  ],
  templateUrl: './society-settings.html',
  styleUrl: './society-settings.scss',
})
export class SocietySettings {
  private readonly api = inject(SocietyApi);
  private readonly ctx = inject(SocietyContextStore);
  private readonly snack = inject(MatSnackBar);

  /** Bound from the `:id` route param. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly society = signal<Society | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    address: [''],
  });

  constructor() {
    toObservable(this.id)
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap((id) => this.api.get(id).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((society) => {
        this.society.set(society);
        this.loading.set(false);
        if (society) this.form.reset({ name: society.name, address: society.address ?? '' });
      });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, address } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api.update(this.id(), { name: name.trim(), address: address.trim() }).subscribe({
      next: (society) => {
        this.saving.set(false);
        this.society.set(society);
        this.form.reset({ name: society.name, address: society.address ?? '' });
        this.snack.open('Settings saved', undefined, { duration: 3000 });
        this.ctx.load().subscribe(); // the switcher shows the name
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 400) this.error.set(errorMessage(err));
      },
    });
  }
}
