import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
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
import { Observable, filter } from 'rxjs';

import { StaffApi } from '../../core/api/staff.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  AddSocietyStaffRequest,
  DayOfWeek,
  IdType,
  LinkRequest,
  Staff,
  StaffLink,
  StaffLookup,
  StaffType,
} from '../../core/models';
import { DAYS, ID_TYPES, STAFF_TYPES, StaffPhoto, StaffPhotos, hhmm, typeLabel } from './staff-ui';

// ---- Work details (shared by adding, linking and editing) ----

export type LinkForm = FormGroup<{
  work: FormControl<string>;
  days: FormControl<DayOfWeek[]>;
  timeFrom: FormControl<string>;
  timeTo: FormControl<string>;
  notify: FormControl<boolean>;
}>;

export function linkForm(fb: NonNullableFormBuilder, link?: StaffLink | null, notify = true): LinkForm {
  return fb.group({
    work: [link?.work ?? '', Validators.maxLength(100)],
    days: [link?.days ?? ([] as DayOfWeek[])],
    timeFrom: [hhmm(link?.timeFrom ?? null)],
    timeTo: [hhmm(link?.timeTo ?? null)],
    notify: [link?.notify ?? notify],
  });
}

export function linkRequest(form: LinkForm): LinkRequest {
  const v = form.getRawValue();
  return {
    work: v.work.trim() || null,
    days: v.days,
    timeFrom: v.timeFrom || null,
    timeTo: v.timeTo || null,
    notify: v.notify,
  };
}

@Component({
  selector: 'app-link-fields',
  imports: [ReactiveFormsModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule],
  template: `
    <div [formGroup]="form()" class="fields">
      <mat-form-field appearance="outline">
        <mat-label>Work for this flat</mat-label>
        <input matInput formControlName="work" placeholder="Cleaning, cooking, car wash…" />
      </mat-form-field>
      <div class="days">
        <span class="label">Usual days</span>
        <mat-button-toggle-group formControlName="days" multiple aria-label="Usual days">
          @for (d of days; track d.value) {
            <mat-button-toggle [value]="d.value">{{ d.short }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
      <div class="times">
        <mat-form-field appearance="outline">
          <mat-label>From</mat-label>
          <input matInput type="time" formControlName="timeFrom" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>To</mat-label>
          <input matInput type="time" formControlName="timeTo" />
        </mat-form-field>
      </div>
      <mat-slide-toggle formControlName="notify">Notify me when they come and go</mat-slide-toggle>
    </div>
  `,
  styles: `
    .fields {
      display: grid;
      gap: 8px;
    }
    .days {
      display: grid;
      gap: 6px;
      margin-bottom: 12px;
    }
    .label {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    mat-button-toggle-group {
      flex-wrap: wrap;
    }
    .times {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
  `,
})
export class LinkFields {
  readonly form = input.required<LinkForm>();
  protected readonly days = DAYS;
}

// ---- Add help to a flat ----

export interface AddStaffData {
  societyId: number;
  flatId: number;
  flatLabel: string;
}

/**
 * Add help to a flat in two steps: the phone number first, which finds someone already registered
 * (then they are linked, with no new verification if verified); otherwise their details, photo and ID.
 */
@Component({
  selector: 'app-add-staff-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    LinkFields,
    StaffPhoto,
  ],
  providers: [StaffPhotos],
  template: `
    <h2 mat-dialog-title>Add staff to {{ data.flatLabel }}</h2>
    <mat-dialog-content>
      @switch (step()) {
        @case ('phone') {
          <p class="hint">Start with their mobile number: if they already work in the society, you only link them.</p>
          <form (ngSubmit)="find()">
            <mat-form-field appearance="outline">
              <mat-label>Mobile number</mat-label>
              <input matInput [formControl]="phone" inputmode="tel" autocomplete="off" cdkFocusInitial />
              @if (phone.invalid && phone.touched) {
                <mat-error>Enter a 10-digit mobile number</mat-error>
              }
            </mat-form-field>
          </form>
        }
        @case ('found') {
          @if (found(); as person) {
            <div class="person">
              <app-staff-photo [staffId]="person.id" [name]="person.name" [hasPhoto]="!!person.photoUrl" [size]="56" />
              <div>
                <strong>{{ person.name }}</strong>
                <span>{{ typeLabel(person.staffType) }} · {{ person.verified ? 'Verified' : 'Not verified yet' }}</span>
              </div>
            </div>
            @if (person.blocked) {
              <p class="warn" role="alert">The committee has blocked this person; they can't be added.</p>
            } @else if (person.linkedToFlat) {
              <p class="warn" role="alert">They already work for {{ data.flatLabel }}.</p>
            } @else {
              <p class="hint">Already registered in the society. Link them to {{ data.flatLabel }}:</p>
              <app-link-fields [form]="link" />
            }
          }
        }
        @case ('new') {
          <form [formGroup]="details" class="grid">
            <mat-form-field appearance="outline">
              <mat-label>Name</mat-label>
              <input matInput formControlName="name" cdkFocusInitial />
              @if (details.controls.name.invalid) {
                <mat-error>Name is required</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Works as</mat-label>
              <mat-select formControlName="staffType">
                @for (t of types; track t.value) {
                  <mat-option [value]="t.value">{{ t.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>ID type</mat-label>
              <mat-select formControlName="idType">
                <mat-option [value]="null">None</mat-option>
                @for (t of idTypes; track t.value) {
                  <mat-option [value]="t.value">{{ t.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>ID number</mat-label>
              <input matInput formControlName="idNumber" autocomplete="off" />
              <mat-hint>Only the last 4 characters are kept</mat-hint>
            </mat-form-field>
          </form>
          <div class="files">
            <label class="file">
              <mat-icon>photo_camera</mat-icon>
              <span>{{ photo()?.name ?? 'Photo (optional)' }}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" capture="user" (change)="pick($event, 'photo')" />
            </label>
            <label class="file">
              <mat-icon>badge</mat-icon>
              <span>{{ idProof()?.name ?? 'ID proof scan (optional)' }}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" (change)="pick($event, 'idProof')" />
            </label>
          </div>
          <app-link-fields [form]="link" />
        }
      }
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (step() !== 'phone') {
        <button mat-button type="button" (click)="back()">Back</button>
      }
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      @switch (step()) {
        @case ('phone') {
          <button mat-flat-button type="button" (click)="find()" [disabled]="busy()">Next</button>
        }
        @case ('found') {
          @if (found(); as person) {
            @if (!person.blocked && !person.linkedToFlat) {
              <button mat-flat-button type="button" (click)="linkExisting()" [disabled]="busy()">Link to {{ data.flatLabel }}</button>
            }
          }
        }
        @case ('new') {
          <button mat-flat-button type="button" (click)="create()" [disabled]="busy()">Add</button>
        }
      }
    </mat-dialog-actions>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .hint {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
    }
    .person {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .person div {
      display: grid;
    }
    .person span {
      color: var(--mat-sys-on-surface-variant);
    }
    .files {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 4px 0 16px;
    }
    .file {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px dashed var(--mat-sys-outline-variant);
      border-radius: 8px;
      cursor: pointer;
      overflow: hidden;
    }
    .file span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file input {
      display: none;
    }
    .warn,
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
    @media (max-width: 599.98px) {
      .grid,
      .files {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AddStaffDialog {
  private readonly api = inject(StaffApi);
  private readonly ref = inject<MatDialogRef<AddStaffDialog, Staff>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly data = inject<AddStaffData>(MAT_DIALOG_DATA);

  protected readonly types = STAFF_TYPES;
  protected readonly idTypes = ID_TYPES;
  protected readonly typeLabel = typeLabel;

  protected readonly step = signal<'phone' | 'found' | 'new'>('phone');
  protected readonly found = signal<StaffLookup | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly photo = signal<File | null>(null);
  protected readonly idProof = signal<File | null>(null);

  protected readonly phone = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^\s*(\+?91[\s-]?)?0?[6-9](\s?-?\d){9}\s*$/)],
  });
  protected readonly details = this.fb.group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(100)]],
    staffType: ['MAID' as StaffType, Validators.required],
    idType: [null as IdType | null],
    idNumber: [''],
  });
  protected readonly link = linkForm(this.fb);

  protected find(): void {
    if (this.phone.invalid || this.busy()) {
      this.phone.markAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.api.lookup(this.data.societyId, this.phone.value, this.data.flatId).subscribe({
      next: (person) => {
        this.busy.set(false);
        this.found.set(person);
        this.step.set('found');
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        if (err.status === 404) this.step.set('new');
        else this.error.set(errorMessage(err));
      },
    });
  }

  protected back(): void {
    this.error.set(null);
    this.step.set('phone');
  }

  protected pick(event: Event, which: 'photo' | 'idProof'): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    (which === 'photo' ? this.photo : this.idProof).set(file);
  }

  protected linkExisting(): void {
    const person = this.found();
    if (!person) return;
    this.submit(this.api.link(this.data.flatId, person.id, linkRequest(this.link)));
  }

  protected create(): void {
    if (this.details.invalid) {
      this.details.markAllAsTouched();
      return;
    }
    const d = this.details.getRawValue();
    if (d.idNumber.trim() && !d.idType) {
      this.error.set('Choose which ID the number is from');
      return;
    }
    this.submit(
      this.api.addHelp(
        this.data.flatId,
        {
          name: d.name.trim(),
          phone: this.phone.value,
          staffType: d.staffType,
          idType: d.idType,
          idNumber: d.idNumber.trim() || null,
          ...linkRequest(this.link),
        },
        this.photo(),
        this.idProof(),
      ),
    );
  }

  private submit(request: Observable<Staff>): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (staff) => this.ref.close(staff),
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function addStaffDialog(dialog: MatDialog, data: AddStaffData): Observable<Staff> {
  return dialog
    .open<AddStaffDialog, AddStaffData, Staff>(AddStaffDialog, { data, width: '560px', maxWidth: '95vw' })
    .afterClosed()
    .pipe(filter((s): s is Staff => !!s));
}

// ---- Change a flat's link ----

export interface EditLinkData {
  staff: Staff;
  link: StaffLink;
}

@Component({
  selector: 'app-edit-link-dialog',
  imports: [MatButtonModule, MatDialogModule, LinkFields],
  template: `
    <h2 mat-dialog-title>{{ data.staff.name }} at {{ data.link.flat }}</h2>
    <mat-dialog-content>
      <app-link-fields [form]="form" />
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" (click)="save()" [disabled]="saving()">Save</button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class EditLinkDialog {
  private readonly api = inject(StaffApi);
  private readonly ref = inject<MatDialogRef<EditLinkDialog, Staff>>(MatDialogRef);
  protected readonly data = inject<EditLinkData>(MAT_DIALOG_DATA);
  protected readonly form = linkForm(inject(NonNullableFormBuilder), this.data.link);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.api.updateLink(this.data.link.flatId, this.data.staff.id, linkRequest(this.form)).subscribe({
      next: (staff) => this.ref.close(staff),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function editLinkDialog(dialog: MatDialog, data: EditLinkData): Observable<Staff> {
  return dialog
    .open<EditLinkDialog, EditLinkData, Staff>(EditLinkDialog, { data, width: '520px', maxWidth: '95vw' })
    .afterClosed()
    .pipe(filter((s): s is Staff => !!s));
}

// ---- A person's details ----

export interface EditStaffData {
  /** Absent: a new society staff member in this society. */
  staff?: Staff;
  societyId: number;
  /** Secretary and above: shift, salary and dates. */
  manager: boolean;
}

/** Name, type and ID for anyone; employment details for society staff (secretary). */
@Component({
  selector: 'app-edit-staff-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ data.staff ? 'Edit ' + data.staff.name : 'Add society staff' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="grid">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Mobile number</mat-label>
          <input matInput formControlName="phone" inputmode="tel" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Works as</mat-label>
          <mat-select formControlName="staffType">
            @for (t of types; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>ID type</mat-label>
          <mat-select formControlName="idType">
            <mat-option [value]="null">None</mat-option>
            @for (t of idTypes; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="wide">
          <mat-label>{{ data.staff?.idLast4 ? 'New ID number (now ends ' + data.staff?.idLast4 + ')' : 'ID number' }}</mat-label>
          <input matInput formControlName="idNumber" autocomplete="off" />
          <mat-hint>Only the last 4 characters are kept</mat-hint>
        </mat-form-field>
        @if (society) {
          <mat-form-field appearance="outline" class="wide">
            <mat-label>Designation</mat-label>
            <input matInput formControlName="designation" placeholder="Night guard, estate manager…" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Shift starts</mat-label>
            <input matInput type="time" formControlName="shiftStart" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Shift ends</mat-label>
            <input matInput type="time" formControlName="shiftEnd" />
          </mat-form-field>
          @if (data.manager) {
            <mat-form-field appearance="outline">
              <mat-label>Monthly salary (₹)</mat-label>
              <input matInput type="number" min="0" step="0.01" formControlName="monthlySalary" />
              <mat-hint>Paid through Finance</mat-hint>
            </mat-form-field>
          }
          <mat-form-field appearance="outline">
            <mat-label>Joined on</mat-label>
            <input matInput type="date" formControlName="joinedOn" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Left on</mat-label>
            <input matInput type="date" formControlName="leftOn" />
            <mat-hint>They can't check in after this day</mat-hint>
          </mat-form-field>
        }
      </form>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" (click)="save()" [disabled]="saving()">
        {{ data.staff ? 'Save' : 'Add' }}
      </button>
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
    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
    }
    @media (max-width: 599.98px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class EditStaffDialog {
  private readonly api = inject(StaffApi);
  private readonly ref = inject<MatDialogRef<EditStaffDialog, Staff>>(MatDialogRef);
  protected readonly data = inject<EditStaffData>(MAT_DIALOG_DATA);
  protected readonly types = STAFF_TYPES;
  protected readonly idTypes = ID_TYPES;
  /** Employment details are shown for society staff, to whoever manages them. */
  protected readonly society = (!this.data.staff || this.data.staff.kind === 'SOCIETY') && this.data.manager;

  private readonly s = this.data.staff;
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.s?.name ?? '', [Validators.required, Validators.pattern(/\S/)]],
    phone: [this.s?.phone ?? '', Validators.required],
    staffType: [this.s?.staffType ?? ('GUARD' as StaffType)],
    idType: [this.s?.idType ?? (null as IdType | null)],
    idNumber: [''],
    designation: [this.s?.society?.designation ?? ''],
    shiftStart: [hhmm(this.s?.society?.shiftStart ?? null)],
    shiftEnd: [hhmm(this.s?.society?.shiftEnd ?? null)],
    monthlySalary: [this.s?.society?.monthlySalary ?? (null as number | null)],
    joinedOn: [this.s?.society?.joinedOn ?? ''],
    leftOn: [this.s?.society?.leftOn ?? ''],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const employment = {
      designation: v.designation.trim() || null,
      shiftStart: v.shiftStart || null,
      shiftEnd: v.shiftEnd || null,
      // The salary is kept as it was when the editor can't see it.
      monthlySalary: this.data.manager ? (v.monthlySalary ?? null) : (this.s?.society?.monthlySalary ?? null),
      joinedOn: v.joinedOn || null,
      leftOn: v.leftOn || null,
      userId: this.s?.society?.userId ?? null,
    };
    const idNumber = v.idNumber.trim() || null;
    let request: Observable<Staff>;
    if (this.s) {
      request = this.api.update(this.s.id, {
        name: v.name.trim(),
        phone: v.phone,
        staffType: v.staffType,
        idType: v.idType,
        idNumber,
        society: this.society ? employment : undefined,
      });
    } else {
      const body: AddSocietyStaffRequest = {
        name: v.name.trim(),
        phone: v.phone,
        staffType: v.staffType,
        idType: v.idType,
        idNumber,
        ...employment,
      };
      request = this.api.addSocietyStaff(this.data.societyId, body);
    }
    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: (staff) => this.ref.close(staff),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

export function editStaffDialog(dialog: MatDialog, data: EditStaffData): Observable<Staff> {
  return dialog
    .open<EditStaffDialog, EditStaffData, Staff>(EditStaffDialog, { data, width: '600px', maxWidth: '95vw' })
    .afterClosed()
    .pipe(filter((s): s is Staff => !!s));
}

// ---- A reason (reject, block, unblock) ----

export interface ReasonData {
  title: string;
  message: string;
  label: string;
  confirmText: string;
  required: boolean;
  danger?: boolean;
  save: (reason: string) => Observable<Staff>;
}

@Component({
  selector: 'app-staff-reason-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
      <mat-form-field appearance="outline">
        <mat-label>{{ data.label }}</mat-label>
        <textarea matInput [formControl]="reason" rows="3" maxlength="500" cdkFocusInitial></textarea>
        @if (reason.invalid && reason.touched) {
          <mat-error>Say why</mat-error>
        }
      </mat-form-field>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [class.danger]="data.danger" (click)="save()" [disabled]="saving()">
        {{ data.confirmText }}
      </button>
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
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class StaffReasonDialog {
  private readonly ref = inject<MatDialogRef<StaffReasonDialog, Staff>>(MatDialogRef);
  protected readonly data = inject<ReasonData>(MAT_DIALOG_DATA);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: this.data.required ? [Validators.required, Validators.pattern(/\S/)] : [],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(): void {
    if (this.reason.invalid || this.saving()) {
      this.reason.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.data.save(this.reason.value.trim()).subscribe({
      next: (staff) => this.ref.close(staff),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 400 || err.status === 409) this.error.set(errorMessage(err));
      },
    });
  }
}

export function reasonDialog(dialog: MatDialog, data: ReasonData): Observable<Staff> {
  return dialog
    .open<StaffReasonDialog, ReasonData, Staff>(StaffReasonDialog, { data, width: '440px' })
    .afterClosed()
    .pipe(filter((s): s is Staff => !!s));
}
