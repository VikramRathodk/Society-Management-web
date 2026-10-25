import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { Observable, catchError, filter, forkJoin, of, switchMap, tap } from 'rxjs';

import { RoleApi } from '../../core/api/role.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission, Role } from '../../core/models';
import { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { confirmDialog } from '../../shared/confirm-dialog';
import { sortBy } from '../../shared/sort';
import { EmptyState, PageHeader, Section, StatusPill } from '../../shared/ui';
import { PermissionMatrix } from './permission-matrix';
import { inheritCandidates, inheritedPermissions } from './role-graph';

@Component({
  selector: 'app-role-detail',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Section,
    StatusPill,
    PermissionMatrix,
  ],
  templateUrl: './role-detail.html',
  host: { '(window:beforeunload)': 'warnBeforeUnload($event)' },
  styleUrl: './role-detail.scss',
})
export class RoleDetail implements HasUnsavedChanges {
  private readonly api = inject(RoleApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  /** Bound from the `:code` route param. */
  readonly code = input.required<string>();

  protected readonly roles = signal<Role[]>([]);
  protected readonly permissions = signal<Permission[]>([]);
  protected readonly loading = signal(true);
  protected readonly role = computed(
    () => this.roles().find((r) => r.code === this.code()) ?? null,
  );

  protected readonly roleMeta = computed(() => {
    const r = this.role();
    if (!r) return null;
    return [
      r.code,
      r.scopeLevel === 'PLATFORM' ? 'Platform role' : 'Society role',
      r.isSystem ? 'Built-in' : null,
      r.requiresFlat ? 'Tied to a flat' : null,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  protected readonly canUpdateRole = this.auth.canOnPlatform('SYSTEM.ROLE.UPDATE');
  protected readonly canEditPermissions = this.auth.canOnPlatform('SYSTEM.PERMISSION.UPDATE');
  protected readonly canViewPermissions = this.auth.canOnPlatform('SYSTEM.PERMISSION.VIEW');
  protected readonly canDelete = computed(
    () => this.role()?.isSystem === false && this.auth.canOnPlatform('SYSTEM.ROLE.DELETE'),
  );

  // Details
  protected readonly detailsForm = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    description: [''],
  });
  protected readonly savingDetails = signal(false);

  // Hierarchy
  protected readonly inheritsDraft = signal<string[]>([]);
  protected readonly savingInherits = signal(false);
  protected readonly inheritOptions = computed(() =>
    sortBy(inheritCandidates(this.code(), this.roles()), (r) => r.name),
  );
  protected readonly includedIn = computed(() =>
    this.roles().filter((r) => r.inherits.includes(this.code())),
  );
  protected readonly inheritsDirty = computed(
    () => !sameMembers(this.inheritsDraft(), this.role()?.inherits ?? []),
  );

  // Permissions
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly savingPermissions = signal(false);
  /** From the saved parents, so the matrix shows exactly what the role gets today. */
  protected readonly inherited = computed(() =>
    inheritedPermissions(this.role()?.inherits ?? [], this.roles()),
  );
  protected readonly permissionsDirty = computed(
    () => !sameMembers([...this.selected()], this.role()?.permissions ?? []),
  );
  protected readonly effectiveCount = computed(
    () => new Set([...this.selected(), ...this.inherited()]).size,
  );

  constructor() {
    toObservable(this.code)
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(() =>
          forkJoin({
            roles: this.api.list(),
            permissions: this.canViewPermissions ? this.api.permissions() : of([]),
          }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if (!result) return;
        this.roles.set(result.roles);
        this.permissions.set(result.permissions);
        this.resetDetails();
        this.resetInherits();
        this.resetPermissions();
      });
  }

  canLeave(): boolean | Observable<boolean> {
    if (!this.hasUnsavedChanges()) return true;
    return confirmDialog(this.dialog, {
      title: 'Discard changes?',
      message: 'You have unsaved changes to this role. Leave without saving them?',
      confirmText: 'Discard',
    });
  }

  /** Closing the tab or reloading: let the browser show its own "leave site?" prompt. */
  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  private hasUnsavedChanges(): boolean {
    return (
      (this.canUpdateRole && this.detailsForm.dirty) ||
      this.inheritsDirty() ||
      this.permissionsDirty()
    );
  }

  protected roleName(code: string): string {
    return this.roles().find((r) => r.code === code)?.name ?? code;
  }

  protected saveDetails(): void {
    if (this.detailsForm.invalid || this.savingDetails()) return;
    const { name, description } = this.detailsForm.getRawValue();
    this.savingDetails.set(true);
    this.api.update(this.code(), { name: name.trim(), description: description.trim() }).subscribe({
      next: (role) => {
        this.savingDetails.set(false);
        this.replaceRole(role);
        this.resetDetails();
        this.snack.open('Role saved', undefined, { duration: 3000 });
      },
      error: () => this.savingDetails.set(false), // reported by the error interceptor
    });
  }

  protected resetInherits(): void {
    this.inheritsDraft.set([...(this.role()?.inherits ?? [])]);
  }

  protected saveInherits(): void {
    if (this.savingInherits()) return;
    this.savingInherits.set(true);
    this.api
      .setInherits(this.code(), this.inheritsDraft())
      // Every role below this one changes too, so reload them all.
      .pipe(switchMap(() => this.api.list()))
      .subscribe({
        next: (roles) => {
          this.savingInherits.set(false);
          this.roles.set(roles);
          this.resetInherits();
          this.snack.open('Hierarchy saved', undefined, { duration: 3000 });
        },
        error: () => this.savingInherits.set(false), // reported by the error interceptor
      });
  }

  protected togglePermission(code: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  protected resetPermissions(): void {
    this.selected.set(new Set(this.role()?.permissions ?? []));
  }

  protected savePermissions(): void {
    if (this.savingPermissions()) return;
    this.savingPermissions.set(true);
    this.api
      .setPermissions(this.code(), [...this.selected()].sort())
      .pipe(switchMap(() => this.api.list()))
      .subscribe({
        next: (roles) => {
          this.savingPermissions.set(false);
          this.roles.set(roles);
          this.resetPermissions();
          this.snack.open('Permissions saved', undefined, { duration: 3000 });
        },
        error: () => this.savingPermissions.set(false), // reported by the error interceptor
      });
  }

  protected remove(): void {
    const role = this.role();
    if (!role) return;
    confirmDialog(this.dialog, {
      title: 'Delete role',
      message: `Delete the ${role.name} role? Roles that inherit it lose its permissions.`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.delete(role.code)),
      )
      .subscribe({
        next: () => {
          this.snack.open(`Deleted ${role.name}`, undefined, { duration: 3000 });
          this.router.navigate(['/roles']);
        },
        error: () => {}, // e.g. still assigned to users — reported by the error interceptor
      });
  }

  private resetDetails(): void {
    const role = this.role();
    if (!role) return;
    this.detailsForm.reset({ name: role.name, description: role.description ?? '' });
    if (this.canUpdateRole) this.detailsForm.enable();
    else this.detailsForm.disable();
  }

  private replaceRole(role: Role): void {
    this.roles.update((list) => list.map((r) => (r.code === role.code ? role : r)));
  }
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
