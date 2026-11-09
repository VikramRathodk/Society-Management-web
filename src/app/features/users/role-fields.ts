import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { RoleApi } from '../../core/api/role.api';
import { StructureApi } from '../../core/api/structure.api';
import { InvitationApi } from '../../core/api/invitation.api';
import { AssignRoleRequest, AssignableRole, Flat, ResidentType, Wing } from '../../core/models';
import { sortBy } from '../../shared/sort';

/** A flat to start the role fields on. */
export interface FlatPreset {
  wingId: number;
  flatId: number;
}

/**
 * Role picker shared by "create user" and "assign role". Offers only roles the caller may assign
 * (GET /api/roles/assignable) and asks for wing → flat + resident type when the role needs a flat.
 */
@Component({
  selector: 'app-role-fields',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './role-fields.html',
  styleUrl: './role-fields.scss',
})
export class RoleFields {
  private readonly roleApi = inject(RoleApi);
  private readonly structureApi = inject(StructureApi);
  private readonly invitationApi = inject(InvitationApi);
  private readonly fb = inject(NonNullableFormBuilder);

  /** Society the role is for; null when only platform roles apply. */
  readonly societyId = input<number | null>(null);
  /** Also offer platform-wide roles; the caller decides from its own permissions. */
  readonly includePlatform = input(false);
  /**
   * Starts on a resident role for this flat ("Add resident" on the Structure page). The fields stay
   * editable.
   */
  readonly preset = input<FlatPreset | null>(null);

  readonly form = this.fb.group({
    role: ['', Validators.required],
    wingId: this.fb.control<number | null>(null),
    flatId: this.fb.control<number | null>(null),
    residentType: this.fb.control<ResidentType | null>(null),
  });

  protected readonly roles = signal<AssignableRole[]>([]);
  protected readonly rolesLoaded = signal(false);
  protected readonly societyRoles = computed(() =>
    this.roles().filter((r) => r.scopeLevel === 'SOCIETY'),
  );
  protected readonly platformRoles = computed(() =>
    this.roles().filter((r) => r.scopeLevel === 'PLATFORM'),
  );
  protected readonly wings = signal<Wing[]>([]);
  protected readonly flats = signal<Flat[]>([]);
  protected readonly residentTypes: ResidentType[] = ['OWNER', 'FAMILY', 'TENANT'];

  /**
   * Which society roles to offer: those the caller may assign (default), or those they may invite
   * people to (GET /api/societies/{id}/invitations/roles), which COMMITTEE members also get.
   */
  readonly source = input<'assign' | 'invite'>('assign');

  private readonly roleCode = toSignal(this.form.controls.role.valueChanges, {
    initialValue: this.form.controls.role.value,
  });
  private readonly selectedRole = computed(
    () => this.roles().find((r) => r.code === this.roleCode()) ?? null,
  );
  protected readonly requiresFlat = computed(() => this.selectedRole()?.requiresFlat ?? false);

  constructor() {
    toObservable(
      computed(() => ({ societyId: this.societyId(), includePlatform: this.includePlatform() })),
    )
      .pipe(
        tap(() => this.rolesLoaded.set(false)),
        switchMap(({ societyId, includePlatform }) =>
          forkJoin([
            societyId != null
              ? (untracked(this.source) === 'invite'
                  ? this.invitationApi.roles(societyId)
                  : this.roleApi.assignable(societyId)
                ).pipe(catchError(() => of([])))
              : of([]),
            includePlatform ? this.roleApi.assignable().pipe(catchError(() => of([]))) : of([]),
          ]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(([society, platform]) => {
        const byCode = new Map([...platform, ...society].map((r) => [r.code, r]));
        this.roles.set(sortBy([...byCode.values()], (r) => r.name));
        this.rolesLoaded.set(true);
        if (!byCode.has(this.form.controls.role.value)) this.form.controls.role.setValue('');
        if (this.preset() && !this.form.controls.role.value) {
          const flatRoles = this.roles().filter((r) => r.requiresFlat);
          const role = flatRoles.find((r) => r.code === 'RESIDENT') ?? flatRoles[0];
          if (role) this.form.controls.role.setValue(role.code);
        }
      });

    effect(() => {
      const needed = this.requiresFlat();
      const societyId = this.societyId();
      untracked(() => this.toggleFlatFields(needed, societyId));
    });

    this.form.controls.wingId.valueChanges
      .pipe(
        tap(() => {
          this.flats.set([]);
          this.form.controls.flatId.setValue(null);
        }),
        switchMap((wingId) =>
          wingId == null
            ? of({ wingId, flats: [] as Flat[] })
            : this.structureApi.flats(wingId).pipe(
                catchError(() => of([] as Flat[])),
                map((flats) => ({ wingId, flats })),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ wingId, flats }) => {
        this.flats.set(sortBy(flats, (f) => f.flatNumber));
        const preset = this.preset();
        if (preset && preset.wingId === wingId && flats.some((f) => f.id === preset.flatId)) {
          this.form.controls.flatId.setValue(preset.flatId);
        }
      });
  }

  /** The chosen role as a request body; societyId is only sent for society-scoped roles. */
  request(): AssignRoleRequest {
    const { role, flatId, residentType } = this.form.getRawValue();
    const needsFlat = this.requiresFlat();
    return {
      role,
      societyId:
        this.selectedRole()?.scopeLevel === 'SOCIETY' ? (this.societyId() ?? undefined) : undefined,
      flatId: needsFlat ? (flatId ?? undefined) : undefined,
      residentType: needsFlat ? (residentType ?? undefined) : undefined,
    };
  }

  protected residentTypeLabel(type: ResidentType): string {
    return type.charAt(0) + type.slice(1).toLowerCase();
  }

  private toggleFlatFields(needed: boolean, societyId: number | null): void {
    const { wingId, flatId, residentType } = this.form.controls;
    for (const control of [wingId, flatId, residentType]) {
      control.setValidators(needed ? Validators.required : null);
      if (!needed) control.setValue(null, { emitEvent: false });
      control.updateValueAndValidity({ emitEvent: false });
    }
    this.wings.set([]);
    this.flats.set([]);
    if (needed && societyId != null) {
      this.structureApi.wings(societyId).subscribe({
        next: (wings) => {
          this.wings.set(sortBy(wings, (w) => w.name));
          const preset = this.preset();
          const { wingId } = this.form.controls;
          if (preset && wingId.value == null && wings.some((w) => w.id === preset.wingId)) {
            wingId.setValue(preset.wingId);
          }
        },
        error: () => {}, // reported by the error interceptor
      });
    }
  }
}
