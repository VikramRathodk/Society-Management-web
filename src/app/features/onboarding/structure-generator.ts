import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { startWith } from 'rxjs';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { PlannedWing, WingPattern } from '../../core/models';
import { listOf, sampleNumbers } from './onboarding-ui';

function wingGroup(fb: NonNullableFormBuilder, name = '') {
  return fb.group({
    wing: [name, [Validators.required, Validators.pattern(/\S/)]],
    floorsFrom: [1, [Validators.required, Validators.min(0), Validators.max(200)]],
    floorsTo: [4, [Validators.required, Validators.min(0), Validators.max(200)]],
    flatsPerFloor: [4, [Validators.required, Validators.min(0), Validators.max(50)]],
    numbering: ['{floor}{nn}'],
    skip: [''],
    extraUnits: [''],
  });
}

/**
 * Setup step 2: wings and flats from floors, flats per floor and a numbering, previewed before anything
 * is created. Whatever already exists is skipped, so it's safe to run again (e.g. to add a wing).
 */
@Component({
  selector: 'app-structure-generator',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="preview()">
      @for (wing of wings.controls; track wing; let i = $index) {
        <fieldset class="wing" [formGroup]="wing" [attr.aria-label]="'Wing ' + (i + 1)">
          <div class="wing-head">
            <mat-form-field appearance="outline" class="name">
              <mat-label>Wing</mat-label>
              <input matInput formControlName="wing" placeholder="A" />
            </mat-form-field>
            @if (wings.length > 1) {
              <button
                mat-icon-button
                type="button"
                (click)="removeWing(i)"
                matTooltip="Remove this wing"
                [attr.aria-label]="'Remove wing ' + (i + 1)"
              >
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>From floor</mat-label>
              <input matInput type="number" min="0" max="200" formControlName="floorsFrom" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>To floor</mat-label>
              <input matInput type="number" min="0" max="200" formControlName="floorsTo" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Flats per floor</mat-label>
              <input matInput type="number" min="0" max="50" formControlName="flatsPerFloor" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Numbering</mat-label>
              <input matInput formControlName="numbering" />
              <mat-hint>{{ '{floor} {nn} {n} {wing}' }}</mat-hint>
            </mat-form-field>
          </div>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Leave out</mat-label>
              <input matInput formControlName="skip" placeholder="e.g. 1301, 1302" />
              <mat-hint>Comma-separated flat numbers</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Also add</mat-label>
              <input matInput formControlName="extraUnits" placeholder="e.g. Shop 1, Shop 2" />
              <mat-hint>Shops or units outside the pattern</mat-hint>
            </mat-form-field>
          </div>
          <p class="sample" data-testid="sample">
            @if (samples()[i]; as sample) {
              {{ sample }}
            }
          </p>
        </fieldset>
      }

      <div class="actions">
        <button mat-button type="button" (click)="addWing()">
          <mat-icon>add</mat-icon> Another wing
        </button>
        <span class="spacer"></span>
        <button mat-stroked-button type="submit" [disabled]="busy()">Preview</button>
      </div>
    </form>

    @if (error(); as message) {
      <p class="form-error" role="alert">{{ message }}</p>
    }

    @if (plan(); as plan) {
      <div class="plan" aria-live="polite">
        <h3>
          @if (created()) {
            Created {{ newFlats() }} flats
          } @else {
            {{ newFlats() }} new flats{{
              existingFlats() ? ', ' + existingFlats() + ' already there' : ''
            }}
          }
        </h3>
        @for (w of plan; track w.name) {
          <div class="plan-wing">
            <p class="plan-name">
              Wing {{ w.name }}
              <span class="muted">
                · {{ w.exists ? 'already there' : 'new wing' }} · {{ w.newFlats }} new
                @if (w.existingFlats) {
                  , {{ w.existingFlats }} skipped
                }
              </span>
            </p>
            <div class="flats">
              @for (f of w.flats; track f.number) {
                <span
                  class="flat"
                  [class.exists]="f.exists"
                  [attr.title]="f.exists ? 'Already there' : null"
                >
                  {{ f.number }}
                </span>
              }
            </div>
          </div>
        }
        @if (!created()) {
          <div class="actions">
            <span class="spacer"></span>
            <button
              mat-flat-button
              type="button"
              (click)="generate()"
              [disabled]="busy() || newFlats() === 0"
            >
              Create {{ newFlats() }} flats
            </button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .wing {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      padding: 12px 16px 4px;
      margin: 0 0 12px;
    }
    .wing-head {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .wing-head .name {
      flex: 0 1 200px;
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .row mat-form-field {
      flex: 1 1 140px;
    }
    .sample {
      margin: 4px 0 8px;
      min-height: 1.2em;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .spacer {
      flex: 1;
    }
    .form-error {
      color: var(--mat-sys-error);
    }
    .plan {
      margin-top: 16px;
    }
    .plan h3 {
      font: var(--mat-sys-title-medium);
      margin: 0 0 8px;
    }
    .plan-name {
      margin: 12px 0 6px;
      font: var(--mat-sys-title-small);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .flats {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-height: 220px;
      overflow: auto;
    }
    .flat {
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      font: var(--mat-sys-label-medium);
    }
    .flat.exists {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
  `,
})
export class StructureGenerator {
  private readonly api = inject(OnboardingApi);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snack = inject(MatSnackBar);

  readonly societyId = input.required<number>();
  /** After flats were created. */
  readonly generated = output<PlannedWing[]>();

  protected readonly wings = this.fb.array([wingGroup(this.fb, 'A')]);
  protected readonly form = this.fb.group({ wings: this.wings });
  protected readonly plan = signal<PlannedWing[] | null>(null);
  protected readonly created = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly values = toSignal(this.form.valueChanges.pipe(startWith(null)));
  /** e.g. "101, 102, 103, 104 … 1204 · 48 flats", recomputed as the form changes. */
  protected readonly samples = computed(() => {
    this.values();
    return this.patterns().map((p) => {
      const first = sampleNumbers(p, 4);
      if (!first.length) return '';
      const floors = Math.max(0, p.floorsTo - p.floorsFrom + 1);
      const total =
        floors * Math.max(0, p.flatsPerFloor) - (p.skip?.length ?? 0) + (p.extraUnits?.length ?? 0);
      const last = sampleNumbers({ ...p, floorsFrom: p.floorsTo }, p.flatsPerFloor).at(-1);
      return `${first.join(', ')}${last && !first.includes(last) ? ' … ' + last : ''} · about ${total} flats`;
    });
  });
  protected readonly newFlats = computed(
    () => this.plan()?.reduce((n, w) => n + w.newFlats, 0) ?? 0,
  );
  protected readonly existingFlats = computed(
    () => this.plan()?.reduce((n, w) => n + w.existingFlats, 0) ?? 0,
  );

  constructor() {
    // Any change makes the preview stale.
    this.form.valueChanges.subscribe(() => {
      if (this.plan() && !this.busy()) {
        this.plan.set(null);
        this.created.set(false);
      }
    });
  }

  protected addWing(): void {
    const next = String.fromCharCode(65 + Math.min(this.wings.length, 25));
    const last = this.wings.at(this.wings.length - 1).getRawValue();
    const group = wingGroup(this.fb, next);
    group.patchValue({
      floorsFrom: last.floorsFrom,
      floorsTo: last.floorsTo,
      flatsPerFloor: last.flatsPerFloor,
      numbering: last.numbering,
    });
    this.wings.push(group);
  }

  protected removeWing(index: number): void {
    this.wings.removeAt(index);
  }

  protected preview(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    this.run(false);
  }

  protected generate(): void {
    this.run(true);
  }

  private run(create: boolean): void {
    const patterns = this.patterns();
    const request = create
      ? this.api.generateStructure(this.societyId(), patterns)
      : this.api.previewStructure(this.societyId(), patterns);
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (plan) => {
        this.busy.set(false);
        this.plan.set(plan);
        this.created.set(create);
        if (create) {
          const n = plan.reduce((sum, w) => sum + w.newFlats, 0);
          this.snack.open(`Created ${n} flats`, undefined, { duration: 3000 });
          this.generated.emit(plan);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.plan.set(null);
        this.error.set(errorMessage(err));
      },
    });
  }

  private patterns(): WingPattern[] {
    return this.wings.controls.map((g) => {
      const v = g.getRawValue();
      return {
        wing: v.wing.trim(),
        floorsFrom: Number(v.floorsFrom),
        floorsTo: Number(v.floorsTo),
        flatsPerFloor: Number(v.flatsPerFloor),
        numbering: v.numbering.trim() || undefined,
        skip: listOf(v.skip),
        extraUnits: listOf(v.extraUnits),
      };
    });
  }
}
