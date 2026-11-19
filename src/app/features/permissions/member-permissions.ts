import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { Observable, catchError, combineLatest, filter, forkJoin, of, switchMap, tap } from 'rxjs';

import { SocietyPermissionApi } from '../../core/api/society-permission.api';
import { UserApi } from '../../core/api/user.api';
import { AuthStore } from '../../core/auth/auth.store';
import {
  MemberPermissions,
  PermissionCatalogEntry,
  PermissionPreset,
  RolePermissions,
  User,
} from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { PermissionHistory } from './permission-history';
import {
  EMPTY_DRAFT,
  PermissionDraft,
  changeOf,
  draftOf,
  sameDraft,
  toggle,
} from './permission-draft';
import { PickMemberDialog, PickMemberDialogData } from './pick-member-dialog';
import { SocietyPermissionMatrix } from './society-permission-matrix';

/**
 * One person's permissions in the selected society: what their roles give, plus their own added and
 * removed permissions. Editors (secretary and above, for people ranked below them) can change them,
 * copy them from someone else, apply a preset or reset them to their roles.
 */
@Component({
  selector: 'app-member-permissions',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    EmptyState,
    PageHeader,
    PermissionHistory,
    Section,
    Skeleton,
    SocietyPermissionMatrix,
    StatusPill,
  ],
  templateUrl: './member-permissions.html',
  styleUrl: './society-permissions.scss',
  host: { '(window:beforeunload)': 'warnBeforeUnload($event)' },
})
export class MemberPermissionsPage implements HasUnsavedChanges {
  private readonly api = inject(SocietyPermissionApi);
  private readonly userApi = inject(UserApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  /** Bound from the `:id` route param. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly societyId = this.ctx.selectedSocietyId;
  protected readonly loading = signal(true);
  protected readonly user = signal<User | null>(null);
  protected readonly member = signal<MemberPermissions | null>(null);
  protected readonly catalog = signal<PermissionCatalogEntry[]>([]);
  protected readonly roles = signal<RolePermissions[]>([]);
  protected readonly presets = signal<PermissionPreset[]>([]);
  protected readonly historyVersion = signal(0);

  protected readonly base = computed<ReadonlySet<string>>(
    () => new Set(this.member()?.fromRole ?? []),
  );
  protected readonly saved = computed<PermissionDraft>(() => {
    const m = this.member();
    return m ? draftOf(m.added, m.removed) : EMPTY_DRAFT;
  });
  protected readonly draft = signal<PermissionDraft>(EMPTY_DRAFT);
  protected readonly dirty = computed(() => !sameDraft(this.draft(), this.saved()));
  protected readonly reason = signal('');
  protected readonly saving = signal(false);
  protected readonly hasChanges = computed(() => {
    const m = this.member();
    return !!m && m.added.length + m.removed.length > 0;
  });
  protected readonly isSelf = computed(() => this.auth.user()?.id === this.id());
  protected readonly roleOptions = computed(() =>
    this.roles().map((r) => ({ code: r.role, name: r.roleName })),
  );

  constructor() {
    combineLatest([toObservable(this.id), toObservable(this.societyId)])
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([id, societyId]) =>
          societyId == null
            ? of(null)
            : forkJoin({
                user: this.userApi.get(id),
                member: this.api.member(societyId, id),
                catalog: this.api.catalog(societyId),
                roles: this.api.roles(societyId).pipe(catchError(() => of([]))),
                presets: this.api.presets(societyId).pipe(catchError(() => of([]))),
              }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        this.user.set(result?.user ?? null);
        this.catalog.set(result?.catalog ?? []);
        this.roles.set(result?.roles ?? []);
        this.presets.set(result?.presets ?? []);
        this.setMember(result?.member ?? null);
      });
  }

  canLeave(): boolean | Observable<boolean> {
    if (!this.dirty()) return true;
    return confirmDialog(this.dialog, {
      title: 'Discard changes?',
      message: 'You have unsaved permission changes for this person. Leave without saving them?',
      confirmText: 'Discard',
    });
  }

  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  protected roleName(code: string): string {
    return this.roles().find((r) => r.role === code)?.roleName ?? code;
  }

  protected toggle(code: string): void {
    this.draft.set(toggle(this.draft(), this.base(), code));
  }

  protected discard(): void {
    this.draft.set(this.saved());
    this.reason.set('');
  }

  protected save(): void {
    const societyId = this.societyId();
    if (societyId == null || this.saving()) return;
    this.saving.set(true);
    this.api
      .saveMember(societyId, this.id(), {
        ...changeOf(this.draft()),
        reason: this.reason().trim() || null,
      })
      .subscribe({
        next: (m) => {
          this.saving.set(false);
          this.updated(m, 'Permissions saved');
        },
        error: () => this.saving.set(false), // reported by the error interceptor
      });
  }

  protected reset(): void {
    const societyId = this.societyId();
    const name = this.user()?.name ?? 'this person';
    if (societyId == null) return;
    confirmDialog(this.dialog, {
      title: 'Reset to their roles',
      message: `Drop every permission added or removed for ${name}? They keep what their roles give.`,
      confirmText: 'Reset',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.resetMember(societyId, this.id())),
      )
      .subscribe({
        next: (m) => this.updated(m, `${name} is back to their roles`),
        error: () => {},
      });
  }

  protected copyFrom(): void {
    const societyId = this.societyId();
    if (societyId == null) return;
    this.dialog
      .open<PickMemberDialog, PickMemberDialogData, number>(PickMemberDialog, {
        width: '440px',
        data: {
          societyId,
          title: 'Copy permissions from…',
          message: `${this.user()?.name ?? 'This person'} gets exactly the other person's added and removed permissions here (replacing their own).`,
          exclude: [this.id(), this.auth.user()?.id ?? -1],
        },
      })
      .afterClosed()
      .pipe(
        filter((other): other is number => other != null),
        switchMap((other) => this.api.copyFrom(societyId, this.id(), other)),
      )
      .subscribe({
        next: (m) => this.updated(m, 'Permissions copied'),
        error: () => {}, // e.g. they have something you don't: reported by the error interceptor
      });
  }

  protected applyPreset(preset: PermissionPreset): void {
    const societyId = this.societyId();
    if (societyId == null) return;
    this.api.applyPreset(societyId, this.id(), preset.id).subscribe({
      next: (m) => this.updated(m, `Preset ${preset.name} applied`),
      error: () => {},
    });
  }

  private updated(m: MemberPermissions, message: string): void {
    this.setMember(m);
    this.historyVersion.update((v) => v + 1);
    this.snack.open(message, undefined, { duration: 3000 });
  }

  private setMember(m: MemberPermissions | null): void {
    this.member.set(m);
    this.draft.set(this.saved());
    this.reason.set('');
  }
}
