import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Observable, catchError, filter, of } from 'rxjs';

import { ParkingApi } from '../../core/api/parking.api';
import { StructureApi } from '../../core/api/structure.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  Flat,
  ParkingRequest,
  ParkingSlot,
  ParkingRequestStatus,
  SlotPurpose,
  Vehicle,
  VehicleStatus,
  VehicleType,
  Violation,
  ViolationKind,
  ViolationOutcome,
  ViolationStatus,
  Wing,
} from '../../core/models';
import { Tone } from '../../shared/ui';
import { sortBy } from '../../shared/sort';

// ---- Labels ----

export const VEHICLE_TYPES: { value: VehicleType; label: string; icon: string }[] = [
  { value: 'CAR', label: 'Car', icon: 'directions_car' },
  { value: 'BIKE', label: 'Two-wheeler', icon: 'two_wheeler' },
  { value: 'OTHER', label: 'Other', icon: 'local_shipping' },
];

export const VIOLATION_KINDS: { value: ViolationKind; label: string }[] = [
  { value: 'WRONG_SLOT', label: "In someone else's slot" },
  { value: 'NO_PARKING_ZONE', label: 'No-parking zone' },
  { value: 'DOUBLE_PARKING', label: 'Double parking' },
  { value: 'UNREGISTERED', label: 'Unregistered vehicle' },
  { value: 'OTHER', label: 'Other' },
];

export function vehicleTypeLabel(type: VehicleType): string {
  return VEHICLE_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function vehicleTypeIcon(type: VehicleType): string {
  return VEHICLE_TYPES.find((t) => t.value === type)?.icon ?? 'directions_car';
}

export function kindLabel(kind: ViolationKind): string {
  return VIOLATION_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** "Covered car · Basement 1". */
export function slotLabel(slot: Pick<ParkingSlot, 'vehicleType' | 'covered' | 'area' | 'purpose'>): string {
  const kind = slot.purpose === 'VISITOR' ? 'Visitor' : vehicleTypeLabel(slot.vehicleType);
  const cover = slot.vehicleType === 'CAR' ? (slot.covered ? 'covered' : 'open') : '';
  return [[kind, cover].filter(Boolean).join(', '), slot.area].filter(Boolean).join(' · ');
}

export function requestState(status: ParkingRequestStatus): { label: string; tone: Tone } {
  switch (status) {
    case 'WAITING':
      return { label: 'Waiting', tone: 'warning' };
    case 'ALLOTTED':
      return { label: 'Allotted', tone: 'success' };
    case 'REJECTED':
      return { label: 'Not accepted', tone: 'danger' };
    case 'WITHDRAWN':
      return { label: 'Withdrawn', tone: 'neutral' };
  }
}

export function vehicleState(status: VehicleStatus): { label: string; tone: Tone } {
  switch (status) {
    case 'APPROVED':
      return { label: 'Approved', tone: 'success' };
    case 'PENDING':
      return { label: 'Awaiting approval', tone: 'warning' };
    case 'REJECTED':
      return { label: 'Not approved', tone: 'danger' };
    case 'REMOVED':
      return { label: 'Removed', tone: 'neutral' };
  }
}

export function violationState(status: ViolationStatus): { label: string; tone: Tone } {
  switch (status) {
    case 'OPEN':
      return { label: 'Open', tone: 'warning' };
    case 'DISMISSED':
      return { label: 'Dismissed', tone: 'neutral' };
    case 'WARNED':
      return { label: 'Warned', tone: 'primary' };
    case 'FINED':
      return { label: 'Fined', tone: 'danger' };
  }
}

export function inr(amount: number | null | undefined): string {
  return amount == null ? '' : '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// ---- A flat picker (wing, then flat) ----

/** Loads the society's wings and a wing's flats, for picking a flat in a dialog. */
export class FlatPicker {
  readonly wings = signal<Wing[]>([]);
  readonly flats = signal<Flat[]>([]);

  constructor(private readonly structure: StructureApi) {}

  load(societyId: number): void {
    this.structure.wings(societyId).pipe(catchError(() => of([]))).subscribe((w) => this.wings.set(sortBy(w, (x) => x.name)));
  }

  pickWing(wingId: number | null): void {
    this.flats.set([]);
    if (wingId == null) return;
    this.structure.flats(wingId).pipe(catchError(() => of([]))).subscribe((f) => this.flats.set(sortBy(f, (x) => x.flatNumber)));
  }
}

// ---- Adding and changing slots ----

export interface SlotDialogData {
  societyId: number;
  /** Absent: add (one, or many from a pattern). */
  slot?: ParkingSlot;
}

@Component({
  selector: 'app-slot-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.slot ? 'Slot ' + data.slot.slotNumber : 'Add parking slots' }}</h2>
    <mat-dialog-content>
      @if (!data.slot) {
        <mat-button-toggle-group [value]="mode()" (change)="mode.set($event.value)" aria-label="How many">
          <mat-button-toggle value="one">One slot</mat-button-toggle>
          <mat-button-toggle value="many">A numbered range</mat-button-toggle>
        </mat-button-toggle-group>
      }
      <form [formGroup]="form" class="grid">
        @if (mode() === 'one') {
          <mat-form-field appearance="outline" class="wide">
            <mat-label>Slot number</mat-label>
            <input matInput formControlName="slotNumber" maxlength="20" />
          </mat-form-field>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Prefix</mat-label>
            <input matInput formControlName="prefix" placeholder="B1-" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Digits</mat-label>
            <input matInput type="number" min="1" max="6" formControlName="digits" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>From</mat-label>
            <input matInput type="number" min="0" formControlName="from" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>To</mat-label>
            <input matInput type="number" min="0" formControlName="to" />
          </mat-form-field>
          <p class="hint wide">Makes {{ preview() }}</p>
        }
        <mat-form-field appearance="outline">
          <mat-label>For</mat-label>
          <mat-select formControlName="vehicleType">
            @for (t of types; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Used by</mat-label>
          <mat-select formControlName="purpose">
            <mat-option value="RESIDENT">Residents (allotted to flats)</mat-option>
            <mat-option value="VISITOR">Visitors</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Area</mat-label>
          <input matInput formControlName="area" placeholder="Basement 1, Open — Wing A" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Monthly charge (₹)</mat-label>
          <input matInput type="number" min="0" step="0.01" formControlName="monthlyCharge" />
          <mat-hint>Empty: the society's default</mat-hint>
        </mat-form-field>
        <mat-slide-toggle formControlName="covered" class="wide">Covered</mat-slide-toggle>
      </form>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">{{ data.slot ? 'Save' : 'Add' }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
      margin-top: 16px;
    }
    .wide {
      grid-column: 1 / -1;
    }
    mat-form-field {
      width: 100%;
    }
    .hint {
      margin: -8px 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class SlotDialog {
  private readonly api = inject(ParkingApi);
  private readonly ref = inject<MatDialogRef<SlotDialog, true>>(MatDialogRef);
  protected readonly data = inject<SlotDialogData>(MAT_DIALOG_DATA);
  protected readonly types = VEHICLE_TYPES;
  protected readonly mode = signal<'one' | 'many'>('one');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly s = this.data.slot;
  protected readonly form = inject(NonNullableFormBuilder).group({
    slotNumber: [this.s?.slotNumber ?? ''],
    prefix: [''],
    digits: [3],
    from: [1],
    to: [20],
    vehicleType: [this.s?.vehicleType ?? ('CAR' as VehicleType)],
    purpose: [this.s?.purpose ?? ('RESIDENT' as SlotPurpose)],
    area: [this.s?.area ?? ''],
    monthlyCharge: [this.s?.monthlyCharge ?? (null as number | null)],
    covered: [this.s?.covered ?? false],
  });

  protected preview(): string {
    const v = this.form.getRawValue();
    const pad = (n: number) => v.prefix + String(n).padStart(v.digits || 1, '0');
    if (v.to < v.from) return 'nothing yet';
    return `${v.to - v.from + 1} slots: ${pad(v.from)} … ${pad(v.to)}`;
  }

  protected save(): void {
    if (this.saving()) return;
    const v = this.form.getRawValue();
    const common = {
      vehicleType: v.vehicleType,
      purpose: v.purpose,
      area: v.area.trim() || null,
      covered: v.covered,
      monthlyCharge: v.monthlyCharge === null || (v.monthlyCharge as unknown) === '' ? null : Number(v.monthlyCharge),
    };
    let request: Observable<unknown>;
    if (this.s) request = this.api.updateSlot(this.s.id, { slotNumber: v.slotNumber, ...common });
    else if (this.mode() === 'one') request = this.api.createSlot(this.data.societyId, { slotNumber: v.slotNumber, ...common });
    else request = this.api.createSlots(this.data.societyId, { prefix: v.prefix, from: v.from, to: v.to, digits: v.digits, ...common });
    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => this.ref.close(true),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function slotDialog(dialog: MatDialog, data: SlotDialogData): Observable<true> {
  return dialog
    .open<SlotDialog, SlotDialogData, true>(SlotDialog, { data, width: '560px', maxWidth: '95vw' })
    .afterClosed()
    .pipe(filter((x): x is true => x === true));
}

// ---- Allotting a slot ----

export interface AllotDialogData {
  societyId: number;
  slot: ParkingSlot;
  /** The waitlist, to allot from a request (the head of the slot's type first). */
  waiting: ParkingRequest[];
  /** Start with this request instead of the head of the queue. */
  requestId?: number;
}

@Component({
  selector: 'app-allot-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Allot slot {{ data.slot.slotNumber }}</h2>
    <mat-dialog-content>
      <p class="hint">{{ slotLabel(data.slot) }}</p>
      <form [formGroup]="form" class="grid">
        @if (queue().length) {
          <mat-form-field appearance="outline" class="wide">
            <mat-label>From the waitlist</mat-label>
            <mat-select formControlName="requestId" (selectionChange)="pickRequest($event.value)">
              <mat-option [value]="null">Not from the waitlist</mat-option>
              @for (r of queue(); track r.id) {
                <mat-option [value]="r.id">
                  #{{ r.position }} · {{ r.flat }}{{ r.coveredPreferred ? ' (wants covered)' : '' }}
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        @if (form.controls.requestId.value == null) {
          <mat-form-field appearance="outline">
            <mat-label>Wing</mat-label>
            <mat-select [value]="wingId()" (selectionChange)="pickWing($event.value)">
              @for (w of picker.wings(); track w.id) {
                <mat-option [value]="w.id">{{ w.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Flat</mat-label>
            <mat-select formControlName="flatId">
              @for (f of picker.flats(); track f.id) {
                <mat-option [value]="f.id">{{ f.flatNumber }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>From</mat-label>
          <input matInput type="date" formControlName="from" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="wide">
          <mat-label>{{ skipping() ? 'Why this goes ahead of the queue' : 'Note (optional)' }}</mat-label>
          <textarea matInput rows="2" formControlName="note" maxlength="500"></textarea>
          @if (skipping()) {
            <mat-hint>Flats are waiting ahead of this one; say why</mat-hint>
          }
        </mat-form-field>
      </form>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">Allot</button>
    </mat-dialog-actions>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
    }
    .wide {
      grid-column: 1 / -1;
    }
    mat-form-field {
      width: 100%;
    }
    .hint {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class AllotDialog {
  private readonly api = inject(ParkingApi);
  private readonly ref = inject<MatDialogRef<AllotDialog, true>>(MatDialogRef);
  protected readonly data = inject<AllotDialogData>(MAT_DIALOG_DATA);
  protected readonly picker = new FlatPicker(inject(StructureApi));
  protected readonly slotLabel = slotLabel;
  protected readonly wingId = signal<number | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Requests for this slot's vehicle type, in queue order. */
  protected readonly queue = signal(
    this.data.waiting.filter((r) => r.vehicleType === this.data.slot.vehicleType).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  );

  private readonly start: ParkingRequest | undefined = this.queue().find((r) => r.id === this.data.requestId) ?? this.queue()[0];
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    requestId: this.fb.control<number | null>(this.start?.id ?? null),
    flatId: this.fb.control<number | null>(this.start?.flatId ?? null),
    from: [''],
    note: [''],
  });

  /** Anyone waiting ahead of the chosen request (or any at all, allotting outside the queue). */
  protected readonly skipping = computed(() => {
    const head = this.queue()[0];
    return !!head && this.requestId() !== head.id;
  });
  private readonly requestId = signal(this.form.controls.requestId.value);

  constructor() {
    this.picker.load(this.data.societyId);
    this.form.controls.requestId.valueChanges.subscribe((v) => this.requestId.set(v));
  }

  protected pickRequest(id: number | null): void {
    const r = this.queue().find((x) => x.id === id);
    this.form.controls.flatId.setValue(r?.flatId ?? null);
  }

  protected pickWing(id: number): void {
    this.wingId.set(id);
    this.form.controls.flatId.setValue(null);
    this.picker.pickWing(id);
  }

  protected save(): void {
    const v = this.form.getRawValue();
    if (v.flatId == null) {
      this.error.set('Choose the flat');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api
      .allot(this.data.slot.id, { flatId: v.flatId, from: v.from || null, note: v.note.trim() || null, requestId: v.requestId })
      .subscribe({
        next: () => this.ref.close(true),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

export function allotDialog(dialog: MatDialog, data: AllotDialogData): Observable<true> {
  return dialog
    .open<AllotDialog, AllotDialogData, true>(AllotDialog, { data, width: '520px', maxWidth: '95vw' })
    .afterClosed()
    .pipe(filter((x): x is true => x === true));
}

// ---- Asking for a slot ----

@Component({
  selector: 'app-ask-slot-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule],
  template: `
    <h2 mat-dialog-title>Ask for a parking slot</h2>
    <mat-dialog-content>
      <p class="hint">Requests are answered first come, first served for each kind of vehicle.</p>
      <form [formGroup]="form" class="grid">
        <mat-form-field appearance="outline">
          <mat-label>For</mat-label>
          <mat-select formControlName="vehicleType">
            @for (t of types; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-slide-toggle formControlName="coveredPreferred">Covered if possible</mat-slide-toggle>
        <mat-form-field appearance="outline" class="wide">
          <mat-label>Note (optional)</mat-label>
          <textarea matInput rows="2" formControlName="note" maxlength="500"></textarea>
        </mat-form-field>
      </form>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">Ask</button>
    </mat-dialog-actions>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
      align-items: center;
    }
    .wide {
      grid-column: 1 / -1;
    }
    mat-form-field {
      width: 100%;
    }
    .hint {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class AskSlotDialog {
  private readonly api = inject(ParkingApi);
  private readonly ref = inject<MatDialogRef<AskSlotDialog, ParkingRequest>>(MatDialogRef);
  private readonly flatId = inject<{ flatId: number }>(MAT_DIALOG_DATA).flatId;
  protected readonly types = VEHICLE_TYPES;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    vehicleType: ['CAR' as VehicleType],
    coveredPreferred: [false],
    note: [''],
  });

  protected save(): void {
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.api.ask(this.flatId, { vehicleType: v.vehicleType, coveredPreferred: v.coveredPreferred, note: v.note.trim() || null }).subscribe({
      next: (r) => this.ref.close(r),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function askSlotDialog(dialog: MatDialog, flatId: number): Observable<ParkingRequest> {
  return dialog
    .open<AskSlotDialog, { flatId: number }, ParkingRequest>(AskSlotDialog, { data: { flatId }, width: '480px', maxWidth: '95vw' })
    .afterClosed()
    .pipe(filter((r): r is ParkingRequest => !!r));
}

// ---- A vehicle ----

export interface VehicleDialogData {
  flatId: number;
  /** The flat's slots, to link the vehicle to one. */
  slots: ParkingSlot[];
  /** Absent: register a new one. */
  vehicle?: Vehicle;
}

@Component({
  selector: 'app-vehicle-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ v ? v.registrationNumber : 'Register a vehicle' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="grid">
        <mat-form-field appearance="outline">
          <mat-label>Registration number</mat-label>
          <input matInput formControlName="registrationNumber" placeholder="MH12AB1234" autocomplete="off" />
          @if (locked) {
            <mat-hint>Approved: ask the committee to change it</mat-hint>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Type</mat-label>
          <mat-select formControlName="vehicleType">
            @for (t of types; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Make</mat-label>
          <input matInput formControlName="make" placeholder="Maruti" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Model</mat-label>
          <input matInput formControlName="model" placeholder="Swift" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Colour</mat-label>
          <input matInput formControlName="colour" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Parks in</mat-label>
          <mat-select formControlName="slotId">
            <mat-option [value]="null">No slot</mat-option>
            @for (s of data.slots; track s.id) {
              <mat-option [value]="s.id">{{ s.slotNumber }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </form>
      @if (!v) {
        <label class="file">
          <mat-icon>upload_file</mat-icon>
          <span>{{ rc()?.name ?? 'RC scan (optional, PDF or photo)' }}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" (change)="pick($event)" />
        </label>
      }
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">{{ v ? 'Save' : 'Register' }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
    }
    mat-form-field {
      width: 100%;
    }
    .file {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px dashed var(--mat-sys-outline-variant);
      border-radius: 8px;
      cursor: pointer;
    }
    .file input {
      display: none;
    }
    .dialog-error {
      margin: 8px 0 0;
      color: var(--mat-sys-error);
    }
    @media (max-width: 599.98px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class VehicleDialog {
  private readonly api = inject(ParkingApi);
  private readonly ref = inject<MatDialogRef<VehicleDialog, Vehicle>>(MatDialogRef);
  protected readonly data = inject<VehicleDialogData>(MAT_DIALOG_DATA);
  protected readonly types = VEHICLE_TYPES;
  protected readonly v = this.data.vehicle;
  /** The flat can't change an approved vehicle's number or type. */
  protected readonly locked = this.v?.status === 'APPROVED' && this.v.view !== 'FULL';
  protected readonly rc = signal<File | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    registrationNumber: [{ value: this.v?.registrationNumber ?? '', disabled: this.locked }, Validators.required],
    vehicleType: [{ value: this.v?.vehicleType ?? ('CAR' as VehicleType), disabled: this.locked }],
    make: [this.v?.make ?? ''],
    model: [this.v?.model ?? ''],
    colour: [this.v?.colour ?? ''],
    slotId: [this.v?.slotId ?? (null as number | null)],
  });

  protected pick(event: Event): void {
    this.rc.set((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const f = this.form.getRawValue();
    const details = { make: f.make.trim(), model: f.model.trim(), colour: f.colour.trim() };
    const request: Observable<Vehicle> = this.v
      ? this.api.updateVehicle(this.v.id, {
          ...(this.locked ? {} : { registrationNumber: f.registrationNumber, vehicleType: f.vehicleType }),
          ...details,
          ...(f.slotId == null ? { clearSlot: true } : { slotId: f.slotId }),
        })
      : this.api.registerVehicle(
          this.data.flatId,
          { registrationNumber: f.registrationNumber, vehicleType: f.vehicleType, ...details, slotId: f.slotId },
          this.rc(),
        );
    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: (vehicle) => this.ref.close(vehicle),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function vehicleDialog(dialog: MatDialog, data: VehicleDialogData): Observable<Vehicle> {
  return dialog
    .open<VehicleDialog, VehicleDialogData, Vehicle>(VehicleDialog, { data, width: '560px', maxWidth: '95vw' })
    .afterClosed()
    .pipe(filter((v): v is Vehicle => !!v));
}

// ---- Reporting wrong parking ----

@Component({
  selector: 'app-report-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Report wrong parking</h2>
    <mat-dialog-content>
      <p class="hint">If the vehicle is registered, its flat is told and may explain. They won't see who reported it.</p>
      <form [formGroup]="form" class="grid">
        <mat-form-field appearance="outline">
          <mat-label>Vehicle number</mat-label>
          <input matInput formControlName="vehicleNumber" autocomplete="off" cdkFocusInitial />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>What's wrong</mat-label>
          <mat-select formControlName="kind">
            @for (k of kinds; track k.value) {
              <mat-option [value]="k.value">{{ k.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="wide">
          <mat-label>Where</mat-label>
          <input matInput formControlName="place" placeholder="In slot B1-014, near gate 2…" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="wide">
          <mat-label>Note (optional)</mat-label>
          <textarea matInput rows="2" formControlName="note" maxlength="500"></textarea>
        </mat-form-field>
      </form>
      <label class="file">
        <mat-icon>photo_camera</mat-icon>
        <span>{{ photo()?.name ?? 'Photo (optional)' }}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" (change)="pick($event)" />
      </label>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">Report</button>
    </mat-dialog-actions>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
    }
    .wide {
      grid-column: 1 / -1;
    }
    mat-form-field {
      width: 100%;
    }
    .hint {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .file {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px dashed var(--mat-sys-outline-variant);
      border-radius: 8px;
      cursor: pointer;
    }
    .file input {
      display: none;
    }
    .dialog-error {
      margin: 8px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ReportDialog {
  private readonly api = inject(ParkingApi);
  private readonly ref = inject<MatDialogRef<ReportDialog, Violation>>(MatDialogRef);
  private readonly data = inject<{ societyId: number; vehicleNumber?: string }>(MAT_DIALOG_DATA);
  protected readonly kinds = VIOLATION_KINDS;
  protected readonly photo = signal<File | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    vehicleNumber: [this.data.vehicleNumber ?? '', Validators.required],
    kind: ['WRONG_SLOT' as ViolationKind],
    place: ['', Validators.required],
    note: [''],
  });

  protected pick(event: Event): void {
    this.photo.set((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Give the number and where it is parked');
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .report(this.data.societyId, { vehicleNumber: v.vehicleNumber, kind: v.kind, place: v.place.trim(), note: v.note.trim() || null }, this.photo())
      .subscribe({
        next: (violation) => this.ref.close(violation),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

export function reportDialog(dialog: MatDialog, societyId: number, vehicleNumber?: string): Observable<Violation> {
  return dialog
    .open<ReportDialog, { societyId: number; vehicleNumber?: string }, Violation>(ReportDialog, {
      data: { societyId, vehicleNumber },
      width: '520px',
      maxWidth: '95vw',
    })
    .afterClosed()
    .pipe(filter((v): v is Violation => !!v));
}

// ---- Deciding a report ----

@Component({
  selector: 'app-decide-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.violation.vehicleNumber }} · {{ kindLabel(data.violation.kind) }}</h2>
    <mat-dialog-content>
      <p class="hint">
        {{ data.violation.flat ? 'Flat ' + data.violation.flat : 'Not a registered vehicle' }}
        @if (data.violation.flatOffences) {
          · {{ data.violation.flatOffences }} warning(s) or fine(s) in the last 12 months
        }
      </p>
      @if (data.violation.reply) {
        <blockquote>{{ data.violation.reply }}</blockquote>
      }
      <mat-button-toggle-group [formControl]="outcome" aria-label="Decision">
        <mat-button-toggle value="DISMISS">Dismiss</mat-button-toggle>
        <mat-button-toggle value="WARN" [disabled]="!data.violation.registered">Warn</mat-button-toggle>
        <mat-button-toggle value="FINE" [disabled]="!data.violation.registered">Fine</mat-button-toggle>
      </mat-button-toggle-group>
      @if (outcome.value === 'FINE') {
        <mat-form-field appearance="outline">
          <mat-label>Fine (₹)</mat-label>
          <input matInput type="number" min="1" [formControl]="amount" />
          <mat-hint>Goes on the flat's next maintenance bill</mat-hint>
        </mat-form-field>
      }
      <mat-form-field appearance="outline">
        <mat-label>Note (optional)</mat-label>
        <textarea matInput rows="2" [formControl]="note" maxlength="500"></textarea>
      </mat-form-field>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">Decide</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-form-field {
      width: 100%;
      margin-top: 12px;
    }
    .hint {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    blockquote {
      margin: 0 0 12px;
      padding: 8px 12px;
      border-left: 3px solid var(--mat-sys-outline-variant);
    }
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class DecideDialog {
  private readonly api = inject(ParkingApi);
  private readonly ref = inject<MatDialogRef<DecideDialog, Violation>>(MatDialogRef);
  protected readonly data = inject<{ violation: Violation; suggestedFine: number }>(MAT_DIALOG_DATA);
  protected readonly kindLabel = kindLabel;
  protected readonly outcome = new FormControl<ViolationOutcome>(this.data.violation.registered ? 'WARN' : 'DISMISS', { nonNullable: true });
  protected readonly amount = new FormControl<number>(this.data.suggestedFine, { nonNullable: true });
  protected readonly note = new FormControl('', { nonNullable: true });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(): void {
    this.saving.set(true);
    this.error.set(null);
    const amount = this.outcome.value === 'FINE' ? Number(this.amount.value) : null;
    this.api.decide(this.data.violation.id, this.outcome.value, amount, this.note.value.trim()).subscribe({
      next: (v) => this.ref.close(v),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function decideDialog(dialog: MatDialog, violation: Violation, suggestedFine = 500): Observable<Violation> {
  return dialog
    .open<DecideDialog, { violation: Violation; suggestedFine: number }, Violation>(DecideDialog, {
      data: { violation, suggestedFine },
      width: '480px',
      maxWidth: '95vw',
    })
    .afterClosed()
    .pipe(filter((v): v is Violation => !!v));
}

// ---- A line of text (reasons, replies) ----

export interface TextDialogData<T> {
  title: string;
  message?: string;
  label: string;
  confirmText: string;
  required?: boolean;
  save: (text: string) => Observable<T>;
}

@Component({
  selector: 'app-parking-text-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (data.message) {
        <p>{{ data.message }}</p>
      }
      <mat-form-field appearance="outline">
        <mat-label>{{ data.label }}</mat-label>
        <textarea matInput rows="3" [formControl]="text" maxlength="1000" cdkFocusInitial></textarea>
      </mat-form-field>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">{{ data.confirmText }}</button>
    </mat-dialog-actions>
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
export class ParkingTextDialog<T> {
  private readonly ref = inject<MatDialogRef<ParkingTextDialog<T>, T>>(MatDialogRef);
  protected readonly data = inject<TextDialogData<T>>(MAT_DIALOG_DATA);
  protected readonly text = new FormControl('', { nonNullable: true });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(): void {
    const value = this.text.value.trim();
    if (this.data.required !== false && !value) {
      this.error.set('Write something first');
      return;
    }
    this.saving.set(true);
    this.data.save(value).subscribe({
      next: (r) => this.ref.close(r),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function textDialog<T>(dialog: MatDialog, data: TextDialogData<T>): Observable<T> {
  return dialog
    .open<ParkingTextDialog<T>, TextDialogData<T>, T>(ParkingTextDialog, { data, width: '440px' })
    .afterClosed()
    .pipe(filter((r): r is T => r !== undefined));
}
