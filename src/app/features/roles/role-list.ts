import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import { filter, finalize } from 'rxjs';

import { RoleApi } from '../../core/api/role.api';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { Role } from '../../core/models';
import { EmptyState } from '../../shared/empty-state';
import { sortBy } from '../../shared/sort';
import { RoleCreateDialog, RoleCreateDialogData } from './role-create-dialog';

@Component({
  selector: 'app-role-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    HasPermission,
    EmptyState,
  ],
  templateUrl: './role-list.html',
  styleUrl: './role-list.scss',
})
export class RoleList {
  private readonly api = inject(RoleApi);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  protected readonly roles = signal<Role[]>([]);
  protected readonly loading = signal(true);
  protected readonly columns = ['name', 'scope', 'inherits', 'permissions'];

  protected readonly loadError = signal(false);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.api
      .list()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (roles) => this.roles.set(sortRoles(roles)),
        error: () => this.loadError.set(true), // also reported by the error interceptor
      });
  }

  protected roleName(code: string): string {
    return this.roles().find((r) => r.code === code)?.name ?? code;
  }

  protected create(): void {
    this.dialog
      .open<RoleCreateDialog, RoleCreateDialogData, Role>(RoleCreateDialog, {
        width: '560px',
        data: { roles: this.roles() },
      })
      .afterClosed()
      .pipe(filter((role) => role !== undefined))
      .subscribe((role) => this.router.navigate(['/roles', role.code]));
  }
}

/** Platform roles first, then by how much they can do — roughly the hierarchy, top to bottom. */
function sortRoles(roles: Role[]): Role[] {
  return sortBy(roles, (r) => r.name).sort(
    (a, b) =>
      Number(b.scopeLevel === 'PLATFORM') - Number(a.scopeLevel === 'PLATFORM') ||
      b.effectivePermissions.length - a.effectivePermissions.length,
  );
}
