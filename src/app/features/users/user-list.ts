import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggle, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap, tap } from 'rxjs';

import { UserApi } from '../../core/api/user.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { RoleAssignment, User } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { sortBy } from '../../shared/sort';
import { Avatar, EmptyState, PageHeader, Section, StatusPill, Skeleton } from '../../shared/ui';

/** Directory of users in the selected society (or everyone visible when none is selected). */
@Component({
  selector: 'app-user-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    Skeleton,
    MatSlideToggleModule,
    MatTableModule,
    HasPermission,
    Avatar,
    EmptyState,
    PageHeader,
    Section,
    StatusPill,
  ],
  templateUrl: './user-list.html',
  styleUrl: './user-list.scss',
})
export class UserList {
  private readonly api = inject(UserApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);

  protected readonly users = signal<User[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly columns = ['name', 'roles', 'status'];

  protected readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) return this.users();
    return this.users().filter(
      (u) => u.name.toLowerCase().includes(query) || u.phone.includes(query),
    );
  });
  protected readonly canToggleActive = computed(() =>
    this.auth.can('USER.ACCOUNT.DELETE', this.ctx.selectedSocietyId()),
  );
  protected readonly selfId = computed(() => this.auth.user()?.id);
  protected readonly subtitle = computed(() => {
    const society = this.ctx.selectedSociety()?.name;
    const count = this.loading() ? null : `${this.users().length} people`;
    return [count, society].filter(Boolean).join(' · ') || null;
  });

  protected readonly loadError = signal(false);
  private readonly attempt = signal(0);

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) => this.api.list(societyId).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((users) => {
        this.loadError.set(users === null);
        this.users.set(sortBy(users ?? [], (u) => u.name));
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  /** Assignments that matter here: platform roles and roles in the selected society. */
  protected rolesHere(user: User): RoleAssignment[] {
    const societyId = this.ctx.selectedSocietyId();
    return user.roles.filter((a) => a.societyId == null || a.societyId === societyId);
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected setActive(user: User, active: boolean, toggle: MatSlideToggle): void {
    (active ? this.api.activate(user.id) : this.api.deactivate(user.id)).subscribe({
      next: () =>
        this.users.update((list) =>
          list.map((u) => (u.id === user.id ? { ...u, isActive: active } : u)),
        ),
      error: () => (toggle.checked = user.isActive), // reported by the error interceptor
    });
  }
}
