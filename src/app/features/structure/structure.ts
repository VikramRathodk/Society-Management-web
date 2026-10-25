import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, filter, finalize, of, switchMap, tap } from 'rxjs';

import { StructureApi } from '../../core/api/structure.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { Flat, Wing } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { nameDialog } from '../../shared/name-dialog';
import { sortBy } from '../../shared/sort';
import { EmptyState, PageHeader } from '../../shared/ui';

/** Wing → flat tree for the selected society. Flats load when a wing is first expanded. */
@Component({
  selector: 'app-structure',
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTooltipModule,
    HasPermission,
    EmptyState,
    PageHeader,
  ],
  templateUrl: './structure.html',
  styleUrl: './structure.scss',
})
export class Structure {
  private readonly api = inject(StructureApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly wings = signal<Wing[]>([]);
  protected readonly loading = signal(true);
  /** Flats per wing id; a wing has no entry until its panel is first opened. */
  protected readonly flats = signal<ReadonlyMap<number, Flat[]>>(new Map());
  protected readonly loadingFlats = signal<ReadonlySet<number>>(new Set());

  protected readonly subtitle = computed(() => {
    const society = this.ctx.selectedSociety()?.name;
    const n = this.wings().length;
    const count = this.loading() ? null : `${n} ${n === 1 ? 'wing' : 'wings'}`;
    return [count, society].filter(Boolean).join(' · ') || null;
  });

  protected readonly canEditFlats = computed(() => {
    const societyId = this.ctx.selectedSocietyId();
    return (
      this.auth.can('FLAT.STRUCTURE.UPDATE', societyId) ||
      this.auth.can('FLAT.STRUCTURE.DELETE', societyId)
    );
  });

  protected readonly loadError = signal(false);
  private readonly attempt = signal(0);

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.flats.set(new Map());
        }),
        switchMap(([societyId]) =>
          societyId == null ? of([]) : this.api.wings(societyId).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((wings) => {
        this.loadError.set(wings === null);
        this.wings.set(sortBy(wings ?? [], (w) => w.name));
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected loadFlats(wing: Wing): void {
    if (this.flats().has(wing.id) || this.loadingFlats().has(wing.id)) return;
    this.loadingFlats.update((ids) => new Set(ids).add(wing.id));
    this.api
      .flats(wing.id)
      .pipe(
        finalize(() =>
          this.loadingFlats.update((ids) => {
            const next = new Set(ids);
            next.delete(wing.id);
            return next;
          }),
        ),
      )
      .subscribe({
        next: (flats) => this.setFlats(wing.id, flats),
        error: () => {}, // reported by the error interceptor; reopening the panel retries
      });
  }

  protected addWing(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    nameDialog(this.dialog, {
      title: 'Add wing',
      label: 'Wing name',
      confirmText: 'Add',
      save: (name) => this.api.createWing(societyId, name),
    }).subscribe((wing) => {
      this.wings.update((list) => sortBy([...list, wing], (w) => w.name));
      this.setFlats(wing.id, []);
    });
  }

  protected renameWing(wing: Wing): void {
    nameDialog(this.dialog, {
      title: 'Rename wing',
      label: 'Wing name',
      value: wing.name,
      save: (name) => this.api.updateWing(wing.id, name),
    }).subscribe((updated) =>
      this.wings.update((list) =>
        sortBy(
          list.map((w) => (w.id === updated.id ? updated : w)),
          (w) => w.name,
        ),
      ),
    );
  }

  protected deleteWing(wing: Wing): void {
    confirmDialog(this.dialog, {
      title: 'Delete wing',
      message: `Delete wing "${wing.name}"?`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.deleteWing(wing.id)),
      )
      .subscribe({
        next: () => this.wings.update((list) => list.filter((w) => w.id !== wing.id)),
        error: () => {}, // reported by the error interceptor
      });
  }

  protected addFlat(wing: Wing): void {
    nameDialog(this.dialog, {
      title: `Add flat to ${wing.name}`,
      label: 'Flat number',
      confirmText: 'Add',
      save: (flatNumber) => this.api.createFlat(wing.id, flatNumber),
    }).subscribe((flat) => this.setFlats(wing.id, [...(this.flats().get(wing.id) ?? []), flat]));
  }

  protected renameFlat(wing: Wing, flat: Flat): void {
    nameDialog(this.dialog, {
      title: 'Rename flat',
      label: 'Flat number',
      value: flat.flatNumber,
      save: (flatNumber) => this.api.updateFlat(flat.id, flatNumber),
    }).subscribe((updated) =>
      this.setFlats(
        wing.id,
        (this.flats().get(wing.id) ?? []).map((f) => (f.id === updated.id ? updated : f)),
      ),
    );
  }

  protected deleteFlat(wing: Wing, flat: Flat): void {
    confirmDialog(this.dialog, {
      title: 'Delete flat',
      message: `Delete flat ${flat.flatNumber} from ${wing.name}?`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.deleteFlat(flat.id)),
      )
      .subscribe({
        next: () =>
          this.setFlats(
            wing.id,
            (this.flats().get(wing.id) ?? []).filter((f) => f.id !== flat.id),
          ),
        error: () => {}, // reported by the error interceptor
      });
  }

  private setFlats(wingId: number, flats: Flat[]): void {
    this.flats.update((map) =>
      new Map(map).set(
        wingId,
        sortBy(flats, (f) => f.flatNumber),
      ),
    );
  }
}
