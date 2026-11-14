import { Component, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap, tap } from 'rxjs';

import { SocietyApi } from '../../core/api/society.api';
import { Society } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Section, Skeleton } from '../../shared/ui';
import { SocietyProfileForm } from './society-profile-form';
import { SocietyRules } from './society-rules';

@Component({
  selector: 'app-society-settings',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    Skeleton,
    EmptyState,
    PageHeader,
    Section,
    SocietyProfileForm,
    SocietyRules,
  ],
  templateUrl: './society-settings.html',
  styleUrl: './society-settings.scss',
})
export class SocietySettings {
  private readonly api = inject(SocietyApi);
  private readonly ctx = inject(SocietyContextStore);

  /** Bound from the `:id` route param. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly society = signal<Society | null>(null);
  protected readonly loading = signal(true);

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
      });
  }

  protected saved(society: Society): void {
    const renamed = society.name !== this.society()?.name;
    this.society.set(society);
    if (renamed) this.ctx.load().subscribe(); // the switcher shows the name
  }
}
