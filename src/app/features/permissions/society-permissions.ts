import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, catchError, filter, forkJoin, of, switchMap, tap } from 'rxjs';

import { SocietyPermissionApi } from '../../core/api/society-permission.api';
import { AuthStore } from '../../core/auth/auth.store';
import { PermissionCatalogEntry, PermissionPreset, RolePermissions } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { PermissionHistory } from './permission-history';
import {
  EMPTY_DRAFT,
  PermissionDraft,
  changeOf,
  codeLabel,
  draftOf,
  sameDraft,
  toggle,
} from './permission-draft';
import { PresetDialog, PresetDialogData } from './preset-dialog';
import { SocietyPermissionMatrix } from './society-permission-matrix';

/** Highest first; roles a society adds later follow in name order. */
const ROLE_ORDER = ['ADMIN', 'SECRETARY', 'CHAIRMAN', 'COMMITTEE', 'GUARD', 'RESIDENT'];

/**
 * Roles & permissions of the selected society: what each role may do here (on top of the platform
 * default), the society's presets and the history of changes. Committee and above look and change roles
 * ranked below their own.
 */
@Component({
  selector: 'app-society-permissions',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTabsModule,
    MatTooltipModule,
    EmptyState,
    PageHeader,
    PermissionHistory,
    Section,
    Skeleton,
    SocietyPermissionMatrix,
    StatusPill,
  ],
  templateUrl: './society-permissions.html',
  styleUrl: './society-permissions.scss',
  host: { '(window:beforeunload)': 'warnBeforeUnload($event)' },
})
export class SocietyPermissions implements HasUnsavedChanges {
  private readonly api = inject(SocietyPermissionApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly societyId = this.ctx.selectedSocietyId;
  protected readonly canEdit = computed(() =>
    this.auth.can('SOCIETY.PERMISSION.UPDATE', this.societyId()),
  );

  protected readonly loading = signal(true);
  protected readonly catalog = signal<PermissionCatalogEntry[]>([]);
  protected readonly roles = signal<RolePermissions[]>([]);
  protected readonly presets = signal<PermissionPreset[]>([]);
  protected readonly historyVersion = signal(0);

  protected readonly selectedCode = signal<string | null>(null);
  protected readonly role = computed(
    () => this.roles().find((r) => r.role === this.selectedCode()) ?? null,
  );
  protected readonly base = computed<ReadonlySet<string>>(
    () => new Set(this.role()?.defaults ?? []),
  );
  protected readonly saved = computed<PermissionDraft>(() => {
    const r = this.role();
    return r ? draftOf(r.granted, r.revoked) : EMPTY_DRAFT;
  });
  protected readonly draft = signal<PermissionDraft>(EMPTY_DRAFT);
  protected readonly dirty = computed(() => !sameDraft(this.draft(), this.saved()));
  protected readonly reason = signal('');
  protected readonly saving = signal(false);

  protected readonly roleOptions = computed(() =>
    this.roles().map((r) => ({ code: r.role, name: r.roleName })),
  );

  constructor() {
    toObservable(this.societyId)
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap((id) =>
          id == null
            ? of(null)
            : forkJoin({
                catalog: this.api.catalog(id),
                roles: this.api.roles(id),
                presets: this.api.presets(id),
              }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        this.catalog.set(result?.catalog ?? []);
        this.roles.set(sortRoles(result?.roles ?? []));
        this.presets.set(result?.presets ?? []);
        const keep = this.roles().some((r) => r.role === this.selectedCode());
        const first = this.roles().find((r) => r.editable) ?? this.roles()[0];
        this.selectRole(keep ? this.selectedCode() : (first?.role ?? null));
      });
  }

  canLeave(): boolean | Observable<boolean> {
    return this.dirty() ? this.confirmDiscard() : true;
  }

  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  protected pickRole(code: string): void {
    if (code === this.selectedCode()) return;
    const go = () => this.selectRole(code);
    if (!this.dirty()) return go();
    this.confirmDiscard().pipe(filter(Boolean)).subscribe(go);
  }

  protected toggle(code: string): void {
    this.draft.set(toggle(this.draft(), this.base(), code));
  }

  protected discard(): void {
    this.draft.set(this.saved());
    this.reason.set('');
  }

  protected save(): void {
    const id = this.societyId();
    const role = this.role();
    if (id == null || !role || this.saving()) return;
    this.saving.set(true);
    this.api
      .saveRole(id, role.role, { ...changeOf(this.draft()), reason: this.reason().trim() || null })
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.replaceRole(updated);
          this.snack.open(`${role.roleName} permissions saved`, undefined, { duration: 3000 });
        },
        error: () => this.saving.set(false), // reported by the error interceptor
      });
  }

  protected reset(): void {
    const id = this.societyId();
    const role = this.role();
    if (id == null || !role) return;
    confirmDialog(this.dialog, {
      title: `Reset ${role.roleName}`,
      message: `Put the ${role.roleName} role back to the platform default in this society? Its ${
        role.granted.length + role.revoked.length
      } change(s) here are dropped.`,
      confirmText: 'Reset',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.resetRole(id, role.role, this.reason().trim() || null)),
      )
      .subscribe({
        next: (updated) => {
          this.replaceRole(updated);
          this.snack.open(`${role.roleName} is back to the default`, undefined, { duration: 3000 });
        },
        error: () => {},
      });
  }

  protected changeCount(r: RolePermissions): number {
    return r.granted.length + r.revoked.length;
  }

  // ---- Presets ----

  protected editPreset(preset?: PermissionPreset): void {
    const id = this.societyId();
    if (id == null) return;
    this.dialog
      .open<PresetDialog, PresetDialogData, PermissionPreset>(PresetDialog, {
        width: '960px',
        maxWidth: '96vw',
        data: { societyId: id, catalog: this.catalog(), preset },
      })
      .afterClosed()
      .pipe(filter((p): p is PermissionPreset => !!p))
      .subscribe((saved) => {
        this.presets.update((list) =>
          [...list.filter((p) => p.id !== saved.id), saved].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
        this.snack.open(`Preset ${saved.name} saved`, undefined, { duration: 3000 });
      });
  }

  protected deletePreset(preset: PermissionPreset): void {
    confirmDialog(this.dialog, {
      title: 'Delete preset',
      message: `Delete ${preset.name}? People it was applied to keep their permissions.`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.deletePreset(preset.id)),
      )
      .subscribe({
        next: () => this.presets.update((list) => list.filter((p) => p.id !== preset.id)),
        error: () => {},
      });
  }

  protected readonly label = codeLabel;

  private selectRole(code: string | null): void {
    this.selectedCode.set(code);
    this.draft.set(this.saved());
    this.reason.set('');
  }

  private replaceRole(updated: RolePermissions): void {
    this.roles.update((list) => list.map((r) => (r.role === updated.role ? updated : r)));
    this.draft.set(this.saved());
    this.reason.set('');
    this.historyVersion.update((v) => v + 1);
  }

  private confirmDiscard(): Observable<boolean> {
    return confirmDialog(this.dialog, {
      title: 'Discard changes?',
      message: `You have unsaved changes to the ${this.role()?.roleName ?? ''} role. Leave without saving them?`,
      confirmText: 'Discard',
    });
  }
}

function sortRoles(roles: RolePermissions[]): RolePermissions[] {
  const rank = (code: string) => {
    const i = ROLE_ORDER.indexOf(code);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  return [...roles].sort(
    (a, b) => rank(a.role) - rank(b.role) || a.roleName.localeCompare(b.roleName),
  );
}
