import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { ComplaintApi } from '../../core/api/complaint.api';
import { StructureApi } from '../../core/api/structure.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { ComplaintCategory, Flat, Wing } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { sortBy } from '../../shared/sort';
import { PageHeader, Section } from '../../shared/ui';
import { COMPLAINT_CATEGORIES } from './complaint-ui';

interface FlatOption {
  id: number;
  label: string;
}

/**
 * Raise a complaint. Residents pick one of their own flats (preselected when they have one);
 * someone without a flat here (e.g. the committee, on a resident's behalf) picks wing and flat.
 */
@Component({
  selector: 'app-complaint-create',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    PageHeader,
    Section,
  ],
  templateUrl: './complaint-create.html',
  styleUrl: './complaint-create.scss',
})
export class ComplaintCreate {
  private readonly api = inject(ComplaintApi);
  private readonly structureApi = inject(StructureApi);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly categories = COMPLAINT_CATEGORIES;
  protected readonly form = inject(NonNullableFormBuilder).group({
    wingId: [null as number | null],
    flatId: [null as number | null, Validators.required],
    category: [null as ComplaintCategory | null, Validators.required],
    description: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(5000)]],
  });

  /** The user's own flats in the selected society (resident role assignments). */
  private readonly ownFlatIds = computed(() => {
    const societyId = this.ctx.selectedSocietyId();
    return (this.auth.user()?.roles ?? [])
      .filter((r) => r.societyId === societyId && r.flatId != null)
      .map((r) => r.flatId!);
  });
  protected readonly ownFlats = signal<FlatOption[]>([]);
  protected readonly pickAny = computed(() => this.ownFlatIds().length === 0);
  protected readonly wings = signal<Wing[]>([]);
  protected readonly flats = signal<Flat[]>([]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.ownFlatIds()] as const))
      .pipe(
        tap(() => {
          this.form.controls.flatId.setValue(null);
          this.form.controls.wingId.setValue(null);
        }),
        switchMap(([societyId, flatIds]) => {
          if (societyId == null) return of({ own: [], wings: [] });
          if (flatIds.length) return this.labelFlats(flatIds).pipe(map((own) => ({ own, wings: [] })));
          return this.structureApi.wings(societyId).pipe(
            catchError(() => of([])),
            map((wings) => ({ own: [], wings })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ own, wings }) => {
        this.ownFlats.set(own);
        this.wings.set(sortBy(wings, (w) => w.name));
        if (own.length === 1) this.form.controls.flatId.setValue(own[0].id);
      });

    this.form.controls.wingId.valueChanges
      .pipe(
        tap(() => {
          this.flats.set([]);
          if (this.pickAny()) this.form.controls.flatId.setValue(null);
        }),
        switchMap((wingId) =>
          wingId == null ? of([]) : this.structureApi.flats(wingId).pipe(catchError(() => of([]))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((flats) => this.flats.set(sortBy(flats, (f) => f.flatNumber)));
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { flatId, category, description } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api.raise({ flatId: flatId!, category: category!, description: description.trim() }).subscribe({
      next: (complaint) => {
        this.snack.open('Complaint raised — the committee has been notified', undefined, {
          duration: 3000,
        });
        this.router.navigate(['/complaints', complaint.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  /** "A-101" labels for the user's flats; falls back to "Flat #id" if a lookup fails. */
  private labelFlats(flatIds: number[]) {
    return forkJoin(
      flatIds.map((id) =>
        this.structureApi.getFlat(id).pipe(
          switchMap((flat) =>
            this.structureApi.getWing(flat.wingId).pipe(
              map((wing) => ({ id, label: `${wing.name}-${flat.flatNumber}` })),
              catchError(() => of({ id, label: flat.flatNumber })),
            ),
          ),
          catchError(() => of({ id, label: `Flat #${id}` })),
        ),
      ),
    );
  }
}
