import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  Observable,
  catchError,
  filter,
  firstValueFrom,
  forkJoin,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  ChargeCalcType,
  ChargeHead,
  ChargeHeadRequest,
  LateFeeType,
  MaintenanceSettings as Settings,
} from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import {
  FREQUENCIES,
  LATE_FEE_TYPES,
  MaintenanceAccess,
  MaintenanceTabs,
  inr,
} from './maintenance-ui';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
/** handle@provider, as the backend checks it; blank is allowed (no UPI). */
const UPI_ID = /^\s*([A-Za-z0-9._-]{2,200}@[A-Za-z][A-Za-z0-9]{1,50})?\s*$/;

/**
 * The society's billing rules (frequency, due days, rounding, late fees) and charge heads.
 * Changes apply to cycles issued afterwards; issued bills keep what they were issued with.
 */
@Component({
  selector: 'app-maintenance-settings',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatusPill,
    MaintenanceTabs,
  ],
  templateUrl: './maintenance-settings.html',
  styleUrl: './maintenance.scss',
})
export class MaintenanceSettings {
  private readonly api = inject(MaintenanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(MaintenanceAccess);

  protected readonly inr = inr;
  protected readonly frequencies = FREQUENCIES;
  protected readonly lateFeeTypes = LATE_FEE_TYPES;

  protected readonly form = inject(NonNullableFormBuilder).group({
    billingFrequency: ['MONTHLY' as Settings['billingFrequency'], Validators.required],
    dueDays: [15, [Validators.required, Validators.min(0), Validators.max(365)]],
    roundToRupee: [true],
    lateFeeType: ['NONE' as LateFeeType],
    lateFeeValue: [0 as number | null, [Validators.min(0), Validators.pattern(MONEY)]],
    graceDays: [0, [Validators.required, Validators.min(0), Validators.max(365)]],
    upiId: ['', Validators.pattern(UPI_ID)],
    upiPayeeName: ['', Validators.maxLength(100)],
  });
  protected readonly lateFeeType = toSignal(
    this.form.controls.lateFeeType.valueChanges.pipe(
      startWith(this.form.controls.lateFeeType.value),
    ),
    { requireSync: true },
  );
  protected readonly lateFeeHint = computed(
    () => LATE_FEE_TYPES.find((t) => t.value === this.lateFeeType())?.hint ?? '',
  );

  protected readonly settings = signal<Settings | null>(null);
  protected readonly heads = signal<ChargeHead[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly attempt = signal(0);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) =>
          societyId == null
            ? of(null)
            : forkJoin({
                settings: this.api.settings(societyId),
                heads: this.api.chargeHeads(societyId),
              }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loadError.set(result === null);
        if (result) {
          this.apply(result.settings);
          this.heads.set(result.heads);
        }
        this.loading.set(false);
      });
  }

  private apply(settings: Settings): void {
    this.settings.set(settings);
    this.form.reset({
      billingFrequency: settings.billingFrequency,
      dueDays: settings.dueDays,
      roundToRupee: settings.roundToRupee,
      lateFeeType: settings.lateFeeType,
      lateFeeValue: settings.lateFeeValue,
      graceDays: settings.graceDays,
      upiId: settings.upiId ?? '',
      upiPayeeName: settings.upiPayeeName ?? '',
    });
    if (this.access.canConfigure()) this.form.enable();
    else this.form.disable();
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected save(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || this.saving()) return;
    const v = this.form.getRawValue();
    const needsValue = v.lateFeeType !== 'NONE';
    if (this.form.invalid || (needsValue && !(Number(v.lateFeeValue) > 0))) {
      this.form.markAllAsTouched();
      this.error.set(needsValue ? 'Enter a late fee above zero.' : null);
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api
      .updateSettings(societyId, {
        billingFrequency: v.billingFrequency,
        dueDays: Number(v.dueDays),
        roundToRupee: v.roundToRupee,
        lateFeeType: v.lateFeeType,
        lateFeeValue: needsValue ? Number(v.lateFeeValue) : 0,
        graceDays: Number(v.graceDays),
        // Sent even when empty: an empty value removes the saved one.
        upiId: v.upiId.trim(),
        upiPayeeName: v.upiPayeeName.trim(),
      })
      .subscribe({
        next: (settings) => {
          this.saving.set(false);
          this.apply(settings);
          this.snack.open('Settings saved; they apply to the next billing cycle', undefined, {
            duration: 3000,
          });
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  protected describe(head: ChargeHead): string {
    return head.calcType === 'PER_SQFT'
      ? `${inr(head.amount)} per sq ft`
      : `${inr(head.amount)} per flat`;
  }

  protected addHead(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    chargeHeadDialog(this.dialog, {
      title: 'Add charge',
      sortOrder: (this.heads().at(-1)?.sortOrder ?? 0) + 10,
      save: (body) => this.api.addChargeHead(societyId, body),
    }).subscribe((head) => this.heads.update((list) => sortHeads([...list, head])));
  }

  protected editHead(head: ChargeHead): void {
    chargeHeadDialog(this.dialog, {
      title: 'Edit charge',
      head,
      sortOrder: head.sortOrder,
      save: (body) => this.api.updateChargeHead(head.id, body),
    }).subscribe((saved) => this.replace(saved));
  }

  protected toggleActive(head: ChargeHead): void {
    this.api.updateChargeHead(head.id, { active: !head.active }).subscribe({
      next: (saved) => this.replace(saved),
      error: (err: HttpErrorResponse) =>
        this.snack.open(errorMessage(err), 'Close', { duration: 4000 }),
    });
  }

  protected async deleteHead(head: ChargeHead): Promise<void> {
    const ok = await firstValueFrom(
      confirmDialog(this.dialog, {
        title: `Delete "${head.name}"`,
        message:
          'Bills already issued keep this charge. To stop billing it but keep it listed, turn it off instead.',
        confirmText: 'Delete',
      }),
    );
    if (!ok) return;
    this.api.deleteChargeHead(head.id).subscribe({
      next: () => this.heads.update((list) => list.filter((h) => h.id !== head.id)),
      error: () => {}, // reported by the error interceptor
    });
  }

  private replace(head: ChargeHead): void {
    this.heads.update((list) => sortHeads(list.map((h) => (h.id === head.id ? head : h))));
  }
}

function sortHeads(heads: ChargeHead[]): ChargeHead[] {
  return [...heads].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

// ---- Charge head dialog ----

interface ChargeHeadDialogData {
  title: string;
  head?: ChargeHead;
  sortOrder: number;
  save: (body: ChargeHeadRequest) => Observable<ChargeHead>;
}

@Component({
  selector: 'app-charge-head-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input
            matInput
            formControlName="name"
            maxlength="100"
            placeholder="e.g. Sinking fund"
            cdkFocusInitial
          />
          @if (form.controls.name.invalid) {
            <mat-error>Name is required</mat-error>
          }
        </mat-form-field>
        <mat-button-toggle-group
          formControlName="calcType"
          aria-label="Charged"
          [hideSingleSelectionIndicator]="true"
          style="margin-bottom: 20px"
        >
          <mat-button-toggle value="FIXED">Per flat</mat-button-toggle>
          <mat-button-toggle value="PER_SQFT">Per sq ft</mat-button-toggle>
        </mat-button-toggle-group>
        <mat-form-field appearance="outline">
          <mat-label>{{
            form.controls.calcType.value === 'PER_SQFT' ? 'Rate per sq ft' : 'Amount per flat'
          }}</mat-label>
          <span matTextPrefix>₹&nbsp;</span>
          <input
            matInput
            type="number"
            inputmode="decimal"
            min="0"
            step="0.01"
            formControlName="amount"
          />
          @if (form.controls.calcType.value === 'PER_SQFT') {
            <mat-hint>Every flat needs its area set</mat-hint>
          }
          @if (form.controls.amount.invalid) {
            <mat-error>Enter an amount, up to 2 decimals</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Order on the bill</mat-label>
          <input matInput type="number" step="1" formControlName="sortOrder" />
          <mat-hint>Lower numbers come first</mat-hint>
        </mat-form-field>
        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Save</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ChargeHeadDialog {
  protected readonly data = inject<ChargeHeadDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ChargeHeadDialog, ChargeHead>>(MatDialogRef);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.data.head?.name ?? '', [Validators.required, Validators.pattern(/\S/)]],
    calcType: [this.data.head?.calcType ?? ('FIXED' as ChargeCalcType)],
    amount: [
      this.data.head?.amount ?? (null as number | null),
      [Validators.required, Validators.min(0), Validators.pattern(MONEY)],
    ],
    sortOrder: [this.data.sortOrder, Validators.required],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.data
      .save({
        name: v.name.trim(),
        calcType: v.calcType,
        amount: Number(v.amount),
        sortOrder: Math.trunc(Number(v.sortOrder)),
      })
      .subscribe({
        next: (head) => this.ref.close(head),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

function chargeHeadDialog(dialog: MatDialog, data: ChargeHeadDialogData): Observable<ChargeHead> {
  return dialog
    .open<ChargeHeadDialog, ChargeHeadDialogData, ChargeHead>(ChargeHeadDialog, {
      data,
      width: '440px',
    })
    .afterClosed()
    .pipe(filter((h): h is ChargeHead => h !== undefined));
}
