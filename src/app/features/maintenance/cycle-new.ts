import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { catchError, filter, firstValueFrom, of, switchMap } from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { BillingPeriod, BillingPreview, PreviewBill } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { PageHeader, Section } from '../../shared/ui';
import {
  MaintenanceAccess,
  areaDialog,
  dayLabel,
  flatLabel,
  inr,
  periodLabel,
} from './maintenance-ui';

/**
 * Issue a billing cycle: the period is suggested from the society's frequency, the preview shows
 * every flat's bill and anything that blocks issuing (e.g. a flat with no area for a per-sq-ft
 * charge), and issuing creates the bills and notifies residents.
 */
@Component({
  selector: 'app-cycle-new',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    PageHeader,
    Section,
  ],
  templateUrl: './cycle-new.html',
  styleUrl: './maintenance.scss',
})
export class CycleNew {
  private readonly api = inject(MaintenanceApi);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(MaintenanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly flatLabel = flatLabel;

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      periodStart: ['', Validators.required],
      periodEnd: ['', Validators.required],
      dueDate: ['', Validators.required],
    },
    { validators: validPeriod },
  );
  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly preview = signal<BillingPreview | null>(null);
  /** The period the preview is for; issuing needs it to still match the form. */
  private readonly previewed = signal<BillingPeriod | null>(null);
  protected readonly stale = computed(() => {
    const p = this.previewed();
    const v = this.value();
    return (
      !p ||
      p.periodStart !== v.periodStart ||
      p.periodEnd !== v.periodEnd ||
      p.dueDate !== v.dueDate
    );
  });
  protected readonly loadingPreview = signal(false);
  protected readonly issuing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<number | null>(null);
  protected readonly periodName = computed(() => {
    const p = this.preview();
    return p ? periodLabel(p.periodStart, p.periodEnd) : '';
  });

  constructor() {
    // Suggest the next period whenever the society changes.
    toObservable(this.ctx.selectedSocietyId)
      .pipe(
        filter((id): id is number => id != null),
        switchMap((id) => this.api.nextPeriod(id).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((period) => {
        this.preview.set(null);
        this.previewed.set(null);
        if (period) this.form.setValue(period);
      });
  }

  protected runPreview(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || this.form.invalid || this.loadingPreview()) {
      this.form.markAllAsTouched();
      return;
    }
    const period = this.form.getRawValue();
    this.loadingPreview.set(true);
    this.error.set(null);
    this.api.preview(societyId, period).subscribe({
      next: (preview) => {
        this.loadingPreview.set(false);
        this.preview.set(preview);
        this.previewed.set(period);
      },
      error: (err: HttpErrorResponse) => {
        this.loadingPreview.set(false);
        this.preview.set(null);
        this.previewed.set(null);
        this.error.set(errorMessage(err));
      },
    });
  }

  protected setArea(flatId: number, label: string): void {
    areaDialog(this.dialog, { flatId, label }).subscribe((saved) => saved && this.runPreview());
  }

  protected toggle(bill: PreviewBill): void {
    this.expanded.update((id) => (id === bill.flatId ? null : bill.flatId));
  }

  protected async issue(): Promise<void> {
    const societyId = this.ctx.selectedSocietyId();
    const preview = this.preview();
    const period = this.previewed();
    if (societyId == null || !preview || !period || this.stale() || preview.problems.length) return;
    const ok = await firstValueFrom(
      confirmDialog(this.dialog, {
        title: `Issue bills for ${this.periodName()}`,
        message: `${preview.billCount} bills totalling ${inr(preview.total)}, due ${dayLabel(preview.dueDate)}. Residents are notified.`,
        confirmText: 'Issue bills',
      }),
    );
    if (!ok) return;
    this.issuing.set(true);
    this.error.set(null);
    this.api.issue(societyId, period).subscribe({
      next: (cycle) => {
        this.snack.open(`${cycle.billCount} bills issued`, undefined, { duration: 3000 });
        this.router.navigate(['/maintenance/cycles', cycle.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.issuing.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

function validPeriod(group: AbstractControl): ValidationErrors | null {
  const { periodStart, periodEnd, dueDate } = group.value as BillingPeriod;
  if (!periodStart || !periodEnd || !dueDate) return null;
  if (periodEnd < periodStart) return { order: true };
  if (dueDate < periodStart) return { due: true };
  return null;
}
