import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { PaymentApi } from '../../core/api/payment.api';
import { SocietyApi } from '../../core/api/society.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { PaymentAccount, PaymentAccountRequest, Society } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { ACCOUNT_STATUS, BUSINESS_TYPES } from './payments-ui';

/**
 * "Online payments": the secretary sends the society's details once and Razorpay sets up the
 * society's own account (no platform step). The PAN and the bank account number go to Razorpay only;
 * this page shows them masked. COMMITTEE members see the status.
 */
@Component({
  selector: 'app-online-payment-setup',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatusPill,
  ],
  template: `
    <app-page-header title="Online payments" subtitle="Let residents pay maintenance by UPI, card or netbanking" />

    @if (loading()) {
      <app-skeleton variant="form" />
    } @else if (loadError()) {
      <app-empty-state icon="cloud_off" message="Couldn't load the online payments setup.">
        <button mat-stroked-button (click)="load()">Try again</button>
      </app-empty-state>
    } @else if (account(); as a) {
      <app-section title="Status" padded>
        @if (a.status; as status) {
          <p class="status">
            <app-status-pill [tone]="statusInfo(status).tone">{{ statusInfo(status).label }}</app-status-pill>
            @if (a.accepting) {
              <app-status-pill tone="success">Residents can pay online</app-status-pill>
            }
          </p>
          <p>{{ statusInfo(status).help }}</p>
          @if (a.reason) {
            <p class="danger-text">{{ a.reason }}</p>
          }
          @if (a.requirements.length) {
            <ul class="requirements">
              @for (r of a.requirements; track r) {
                <li>{{ r }}</li>
              }
            </ul>
          }
          @if (status === 'ACTIVATED' && !a.enabled) {
            <p>
              Switch on <strong>Residents can pay online</strong> in the
              <a [routerLink]="['/societies', a.societyId, 'settings']">society settings</a> (Online payments) to
              start. There you also choose who pays the gateway fee.
            </p>
          }
          <dl class="facts">
            <dt>Account holder</dt>
            <dd>{{ a.beneficiaryName }} · bank account ending {{ a.bankLast4 }} · {{ a.ifsc }}</dd>
            <dt>Society</dt>
            <dd>{{ a.legalName }} · PAN {{ a.panMasked }}</dd>
            <dt>Contact</dt>
            <dd>{{ a.contactName }} · {{ a.email }} · {{ a.phone }}</dd>
          </dl>
        } @else {
          <p>
            Online payments aren't set up yet. Send the society's details below. Razorpay checks them and the bank
            account (from minutes to a few days), then the money residents pay goes to this bank account.
          </p>
        }
      </app-section>

      @if (canManage() && a.status !== 'SUSPENDED') {
        <app-section [title]="a.status ? 'Correct and send again' : 'Society details'" padded>
          <form [formGroup]="form" (ngSubmit)="submit()" class="form">
            <div class="row">
              <mat-form-field appearance="outline">
                <mat-label>Legal name (as on the PAN)</mat-label>
                <input matInput formControlName="legalName" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Type</mat-label>
                <mat-select formControlName="businessType">
                  @for (t of businessTypes; track t.value) {
                    <mat-option [value]="t.value">{{ t.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <div class="row">
              <mat-form-field appearance="outline">
                <mat-label>Society's PAN</mat-label>
                <input matInput formControlName="pan" maxlength="10" autocomplete="off" />
                <mat-hint>Sent to Razorpay only</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Signatory's PAN (optional)</mat-label>
                <input matInput formControlName="signatoryPan" maxlength="10" autocomplete="off" />
              </mat-form-field>
            </div>
            <div class="row">
              <mat-form-field appearance="outline">
                <mat-label>Contact person</mat-label>
                <input matInput formControlName="contactName" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Email</mat-label>
                <input matInput type="email" formControlName="email" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Phone</mat-label>
                <input matInput formControlName="phone" />
              </mat-form-field>
            </div>
            <mat-form-field appearance="outline" class="wide">
              <mat-label>Registered address</mat-label>
              <input matInput formControlName="street1" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="wide">
              <mat-label>Address line 2 (optional)</mat-label>
              <input matInput formControlName="street2" />
            </mat-form-field>
            <div class="row">
              <mat-form-field appearance="outline">
                <mat-label>City</mat-label>
                <input matInput formControlName="city" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>State</mat-label>
                <input matInput formControlName="state" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>PIN code</mat-label>
                <input matInput formControlName="postalCode" maxlength="6" />
              </mat-form-field>
            </div>
            <h3>Bank account the money goes to</h3>
            <div class="row">
              <mat-form-field appearance="outline">
                <mat-label>Account number</mat-label>
                <input matInput formControlName="accountNumber" autocomplete="off" />
                <mat-hint>Sent to Razorpay only</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>IFSC</mat-label>
                <input matInput formControlName="ifsc" maxlength="11" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Account holder's name</mat-label>
                <input matInput formControlName="beneficiaryName" />
              </mat-form-field>
            </div>
            @if (error(); as message) {
              <p class="danger-text" role="alert">{{ message }}</p>
            }
            <div class="actions">
              <button mat-flat-button type="submit" [disabled]="saving()">
                <mat-icon>send</mat-icon>
                {{ saving() ? 'Sending…' : a.status ? 'Send again' : 'Enable online payments' }}
              </button>
            </div>
          </form>
        </app-section>
      }
    }
  `,
  styles: `
    .status {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 16px;
    }
    .facts dd {
      margin: 0;
    }
    .requirements {
      margin: 0 0 12px;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0 12px;
    }
    .wide {
      width: 100%;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
    }
    .danger-text {
      color: var(--mat-sys-error);
    }
    h3 {
      margin: 12px 0 4px;
      font-size: 1rem;
    }
  `,
})
export class OnlinePaymentSetup {
  private readonly api = inject(PaymentApi);
  private readonly societies = inject(SocietyApi);
  private readonly auth = inject(AuthStore);
  private readonly snack = inject(MatSnackBar);
  private readonly ctx = inject(SocietyContextStore);

  protected readonly businessTypes = BUSINESS_TYPES;
  protected readonly account = signal<PaymentAccount | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly canManage = computed(() => this.auth.can('PAYMENT.ACCOUNT.MANAGE', this.ctx.selectedSocietyId()));

  protected readonly form = inject(NonNullableFormBuilder).group({
    legalName: ['', Validators.required],
    businessType: ['society', Validators.required],
    pan: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/)]],
    signatoryPan: ['', Validators.pattern(/^([A-Za-z]{5}[0-9]{4}[A-Za-z])?$/)],
    contactName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, Validators.pattern(/^(\+?91)?[\s-]?[0-9][0-9\s-]{8,11}$/)]],
    street1: ['', Validators.required],
    street2: [''],
    city: ['', Validators.required],
    state: ['', Validators.required],
    postalCode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    accountNumber: ['', [Validators.required, Validators.pattern(/^[0-9\s]{9,22}$/)]],
    ifsc: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/)]],
    beneficiaryName: ['', Validators.required],
  });

  constructor() {
    effect(() => {
      if (this.ctx.selectedSocietyId() != null) this.load();
    });
  }

  protected statusInfo(status: keyof typeof ACCOUNT_STATUS) {
    return ACCOUNT_STATUS[status];
  }

  protected load(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    this.loading.set(true);
    forkJoin([this.api.account(societyId), this.societies.get(societyId).pipe(catchError(() => of(null)))])
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        this.loading.set(false);
        this.loadError.set(result === null);
        this.account.set(result?.[0] ?? null);
        if (result) this.prefill(result[0], result[1]);
      });
  }

  // What was sent before (minus the PAN and the account number), else the society's profile.
  private prefill(a: PaymentAccount, s: Society | null): void {
    this.form.patchValue({
      legalName: a.legalName ?? s?.name ?? '',
      businessType: a.businessType ?? 'society',
      contactName: a.contactName ?? this.auth.user()?.name ?? '',
      email: a.email ?? s?.contactEmail ?? this.auth.user()?.email ?? '',
      phone: a.phone ?? s?.contactPhone ?? this.auth.user()?.phone ?? '',
      street1: a.street1 ?? s?.address ?? '',
      street2: a.street2 ?? '',
      city: a.city ?? s?.city ?? '',
      state: a.state ?? s?.state ?? '',
      postalCode: a.postalCode ?? s?.pincode ?? '',
      ifsc: a.ifsc ?? '',
      beneficiaryName: a.beneficiaryName ?? '',
    });
  }

  protected submit(): void {
    const societyId = this.ctx.selectedSocietyId();
    const current = this.account();
    if (societyId == null || this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Check the highlighted fields.');
      return;
    }
    const v = this.form.getRawValue();
    const body: PaymentAccountRequest = {
      ...v,
      pan: v.pan.toUpperCase(),
      signatoryPan: v.signatoryPan ? v.signatoryPan.toUpperCase() : null,
      street2: v.street2 || null,
      ifsc: v.ifsc.toUpperCase(),
      accountNumber: v.accountNumber.replace(/\s/g, ''),
    };
    this.saving.set(true);
    this.error.set(null);
    this.api.submitAccount(societyId, body, current?.status != null).subscribe({
      next: (a) => {
        this.saving.set(false);
        this.account.set(a);
        this.form.patchValue({ pan: '', signatoryPan: '', accountNumber: '' });
        this.form.markAsUntouched();
        this.snack.open(
          a.status === 'FAILED' ? "Razorpay didn't accept the details; see the status" : 'Sent to Razorpay',
          undefined,
          { duration: 4000 },
        );
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}
