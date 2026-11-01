import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Observable, catchError, filter, map, of, switchMap, tap } from 'rxjs';

import { StructureApi } from '../../core/api/structure.api';
import { UserApi } from '../../core/api/user.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Access, RoleAssignment, User } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, StatusPill, Skeleton } from '../../shared/ui';
import { AssignRoleDialog, AssignRoleDialogData } from './assign-role-dialog';
import { ResetPasswordDialog, ResetPasswordDialogData } from './reset-password-dialog';

@Component({
  selector: 'app-user-detail',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    Skeleton,
    MatTooltipModule,
    EmptyState,
    PageHeader,
    Section,
    StatusPill,
  ],
  templateUrl: './user-detail.html',
  styleUrl: './user-detail.scss',
})
export class UserDetail {
  private readonly api = inject(UserApi);
  private readonly structureApi = inject(StructureApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  /** Bound from the `:id` route param. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly user = signal<User | null>(null);
  protected readonly loading = signal(true);
  protected readonly access = signal<Access | null>(null);
  protected readonly flatLabels = signal<ReadonlyMap<number, string>>(new Map());
  protected readonly savingProfile = signal(false);

  protected readonly profileForm = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    email: ['', Validators.email],
  });

  private readonly societyId = this.ctx.selectedSocietyId;
  protected readonly isSelf = computed(() => this.auth.user()?.id === this.id());
  protected readonly canEditProfile = computed(() =>
    this.isSelf()
      ? this.auth.can('USER.PROFILE.UPDATE')
      : this.auth.can('USER.ACCOUNT.UPDATE', this.societyId()),
  );
  protected readonly canToggleActive = computed(
    () => !this.isSelf() && this.auth.can('USER.ACCOUNT.DELETE', this.societyId()),
  );
  // Own password is changed on the profile page, with the current one.
  protected readonly canResetPassword = computed(
    () => !this.isSelf() && this.auth.can('USER.ACCOUNT.UPDATE', this.societyId()),
  );
  protected readonly canDelete = computed(
    () => !this.isSelf() && this.auth.canOnPlatform('USER.ACCOUNT.DELETE'),
  );
  protected readonly canAssignRole = computed(() =>
    this.auth.can('USER.ROLE.ASSIGN', this.societyId()),
  );
  protected readonly canViewAccess = computed(() =>
    this.auth.can('USER.ROLE.VIEW', this.societyId()),
  );

  constructor() {
    toObservable(this.id)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.access.set(null);
        }),
        switchMap((id) => this.api.get(id).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((user) => {
        this.loading.set(false);
        this.setUser(user);
        if (user) {
          this.loadFlatLabels(user.roles);
          this.loadAccess();
        }
      });
  }

  protected societyLabel(societyId: number): string {
    return this.ctx.societies().find((s) => s.id === societyId)?.name ?? `Society #${societyId}`;
  }

  protected flatLabel(flatId: number): string {
    return this.flatLabels().get(flatId) ?? `Flat #${flatId}`;
  }

  protected canRemoveRole(assignment: RoleAssignment): boolean {
    return assignment.societyId == null
      ? this.auth.canOnPlatform('USER.ROLE.DELETE')
      : this.auth.can('USER.ROLE.DELETE', assignment.societyId);
  }

  protected saveProfile(): void {
    const user = this.user();
    if (!user || this.profileForm.invalid || this.savingProfile()) return;
    const name = this.profileForm.controls.name.value.trim();
    const email = this.profileForm.controls.email.value.trim();
    this.savingProfile.set(true);
    this.api.update(user.id, { name, email: email || undefined }).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.setUser({ ...user, name, email: email || null });
        this.snack.open('Profile saved', undefined, { duration: 3000 });
        if (this.isSelf()) this.auth.restore().subscribe(); // refresh the name in the top bar
      },
      error: () => this.savingProfile.set(false), // reported by the error interceptor
    });
  }

  protected setActive(active: boolean): void {
    const user = this.user();
    if (!user) return;
    const confirmed: Observable<boolean> = active
      ? of(true)
      : confirmDialog(this.dialog, {
          title: 'Deactivate user',
          message: `${user.name} will no longer be able to sign in.`,
          confirmText: 'Deactivate',
        });
    confirmed
      .pipe(
        filter(Boolean),
        switchMap(() => (active ? this.api.activate(user.id) : this.api.deactivate(user.id))),
      )
      .subscribe({
        next: () => this.user.update((u) => (u ? { ...u, isActive: active } : u)),
        error: () => {}, // reported by the error interceptor
      });
  }

  protected resetPassword(): void {
    const user = this.user();
    if (!user) return;
    this.dialog
      .open<ResetPasswordDialog, ResetPasswordDialogData, boolean>(ResetPasswordDialog, {
        width: '420px',
        data: { userId: user.id, userName: user.name },
      })
      .afterClosed()
      .pipe(filter(Boolean))
      .subscribe(() =>
        this.snack.open(`Password reset for ${user.name}`, undefined, { duration: 3000 }),
      );
  }

  protected remove(): void {
    const user = this.user();
    if (!user) return;
    confirmDialog(this.dialog, {
      title: 'Delete user',
      message: `Permanently delete ${user.name}? This cannot be undone.`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.delete(user.id)),
      )
      .subscribe({
        next: () => {
          this.snack.open(`Deleted ${user.name}`, undefined, { duration: 3000 });
          this.router.navigate(['/users']);
        },
        error: (err: HttpErrorResponse) => {
          // 409: the user has history. Deactivating keeps the history and blocks sign-in.
          if (err.status === 409 && user.isActive && this.canToggleActive()) this.setActive(false);
        },
      });
  }

  protected assignRole(): void {
    const user = this.user();
    if (!user) return;
    this.dialog
      .open<AssignRoleDialog, AssignRoleDialogData, RoleAssignment>(AssignRoleDialog, {
        width: '480px',
        data: {
          userId: user.id,
          userName: user.name,
          societyId: this.societyId(),
          includePlatform: this.auth.canOnPlatform('USER.ROLE.ASSIGN'),
        },
      })
      .afterClosed()
      .pipe(filter((assignment) => assignment !== undefined))
      .subscribe((assignment) => {
        this.user.update((u) => (u ? { ...u, roles: [...u.roles, assignment] } : u));
        this.loadFlatLabels([assignment]);
        this.loadAccess();
      });
  }

  protected removeRole(assignment: RoleAssignment): void {
    const user = this.user();
    if (!user) return;
    confirmDialog(this.dialog, {
      title: 'Remove role',
      message: `Remove the ${assignment.roleName} role from ${user.name}?`,
      confirmText: 'Remove',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.removeRole(user.id, assignment.id)),
      )
      .subscribe({
        next: () => {
          this.user.update((u) =>
            u ? { ...u, roles: u.roles.filter((a) => a.id !== assignment.id) } : u,
          );
          this.loadAccess();
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  private setUser(user: User | null): void {
    this.user.set(user);
    if (user) this.profileForm.reset({ name: user.name, email: user.email ?? '' });
    if (this.canEditProfile()) this.profileForm.enable();
    else this.profileForm.disable();
  }

  private loadAccess(): void {
    if (!this.canViewAccess()) return;
    this.api.permissions(this.id()).subscribe({
      next: (access) => this.access.set(access),
      error: () => {}, // reported by the error interceptor
    });
  }

  /** Resolves "Wing A · 101" labels for flat-bound roles the viewer may see. */
  private loadFlatLabels(roles: RoleAssignment[]): void {
    for (const a of roles) {
      if (a.flatId == null || a.societyId == null || this.flatLabels().has(a.flatId)) continue;
      if (!this.auth.can('FLAT.DIRECTORY.VIEW', a.societyId)) continue;
      const flatId = a.flatId;
      this.structureApi
        .getFlat(flatId)
        .pipe(
          switchMap((flat) =>
            this.structureApi.getWing(flat.wingId).pipe(
              map((wing) => `${wing.name} · ${flat.flatNumber}`),
              catchError(() => of(`Flat ${flat.flatNumber}`)),
            ),
          ),
          catchError(() => of(null)),
        )
        .subscribe((label) => {
          if (label) this.flatLabels.update((m) => new Map(m).set(flatId, label));
        });
    }
  }
}
