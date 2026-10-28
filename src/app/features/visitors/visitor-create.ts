import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { catchError, of, switchMap, tap } from 'rxjs';

import { StructureApi } from '../../core/api/structure.api';
import { VisitorApi } from '../../core/api/visitor.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Flat, Wing } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { sortBy } from '../../shared/sort';
import { PageHeader, Section } from '../../shared/ui';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Guard desk form: log a visitor for a flat, optionally with a photo. */
@Component({
  selector: 'app-visitor-create',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    PageHeader,
    Section,
  ],
  templateUrl: './visitor-create.html',
  styleUrl: './visitor-create.scss',
})
export class VisitorCreate {
  private readonly api = inject(VisitorApi);
  private readonly structureApi = inject(StructureApi);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly photoAccept = PHOTO_TYPES.join(',');
  protected readonly form = this.fb.group({
    wingId: this.fb.control<number | null>(null, Validators.required),
    flatId: this.fb.control<number | null>(null, Validators.required),
    visitorName: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(255)]],
    visitorPhone: ['', Validators.maxLength(15)],
    purpose: ['', Validators.maxLength(100)],
  });
  protected readonly wings = signal<Wing[]>([]);
  protected readonly flats = signal<Flat[]>([]);
  protected readonly photo = signal<File | null>(null);
  protected readonly photoPreview = signal<string | null>(null);
  protected readonly photoError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /**
   * Picking a flat needs the flat directory (GUARD has it since backend V10; a custom gate role
   * might not), so say so instead of showing empty dropdowns.
   */
  protected readonly canListFlats = computed(() =>
    this.auth.can('FLAT.DIRECTORY.VIEW', this.ctx.selectedSocietyId()),
  );

  constructor() {
    toObservable(this.ctx.selectedSocietyId)
      .pipe(
        tap(() => {
          this.wings.set([]);
          this.form.controls.wingId.setValue(null);
        }),
        switchMap((societyId) =>
          societyId == null || !this.canListFlats()
            ? of([])
            : this.structureApi.wings(societyId).pipe(catchError(() => of([]))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((wings) => this.wings.set(sortBy(wings, (w) => w.name)));

    this.form.controls.wingId.valueChanges
      .pipe(
        tap(() => {
          this.flats.set([]);
          this.form.controls.flatId.setValue(null);
        }),
        switchMap((wingId) =>
          wingId == null ? of([]) : this.structureApi.flats(wingId).pipe(catchError(() => of([]))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((flats) => this.flats.set(sortBy(flats, (f) => f.flatNumber)));

    inject(DestroyRef).onDestroy(() => this.setPhoto(null));
  }

  protected onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = ''; // allow picking the same file again after removing it
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      this.photoError.set('Use a JPEG, PNG or WebP image');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      this.photoError.set('Photo must be 5 MB or smaller');
      return;
    }
    this.setPhoto(file);
  }

  protected removePhoto(): void {
    this.setPhoto(null);
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { flatId, visitorName, visitorPhone, purpose } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .log(
        {
          flatId: flatId!,
          visitorName: visitorName.trim(),
          visitorPhone: visitorPhone.trim() || undefined,
          purpose: purpose.trim() || undefined,
        },
        this.photo(),
      )
      .subscribe({
        next: (visitor) => {
          this.snack.open(`${visitor.visitorName} logged — waiting for approval`, undefined, {
            duration: 3000,
          });
          this.router.navigate(['/visitors']);
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          if (err.status === 413) this.photoError.set('Photo must be 5 MB or smaller');
          else this.error.set(errorMessage(err));
        },
      });
  }

  private setPhoto(file: File | null): void {
    const previous = this.photoPreview();
    if (previous) URL.revokeObjectURL(previous);
    this.photo.set(file);
    this.photoPreview.set(file ? URL.createObjectURL(file) : null);
    this.photoError.set(null);
  }
}
