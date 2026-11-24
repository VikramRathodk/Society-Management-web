import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { catchError, forkJoin, of } from 'rxjs';

import { PaymentApi } from '../../core/api/payment.api';
import { AuthStore } from '../../core/auth/auth.store';
import { OnlinePaymentRow, PaymentAccount } from '../../core/models';
import { EmptyState, PageHeader, Skeleton, StatCard, StatusPill } from '../../shared/ui';
import { ACCOUNT_STATUS, TRANSFER_STATUS, reasonDialog, rupees } from './payments-ui';

/**
 * The platform's view of online payments (PLATFORM.BILLING.VIEW / UPDATE): every society's linked
 * account (set up by the societies themselves; suspend or resume one), payments that couldn't be
 * recorded (refund them), and transfers to societies that failed (retry them).
 */
@Component({
  selector: 'app-platform-payments',
  imports: [MatButtonModule, MatIconModule, MatTabsModule, EmptyState, PageHeader, Skeleton, StatCard, StatusPill],
  template: `
    <app-page-header title="Online payments" subtitle="Societies' linked accounts, transfers and problems" />

    @if (loading()) {
      <app-skeleton variant="list" />
    } @else if (loadError()) {
      <app-empty-state icon="cloud_off" message="Couldn't load online payments.">
        <button mat-stroked-button (click)="load()">Try again</button>
      </app-empty-state>
    } @else {
      <div class="stats">
        <app-stat-card icon="verified" label="Active societies" [value]="'' + activeCount()" tone="success" />
        <app-stat-card icon="hourglass_top" label="In review" [value]="'' + reviewCount()" />
        <app-stat-card icon="sync_problem" label="Transfers to fix" [value]="'' + transfers().length" tone="warning" />
        <app-stat-card icon="report" label="Unrecorded payments" [value]="'' + problems().length" tone="danger" />
      </div>

      <mat-tab-group mat-stretch-tabs="false" animationDuration="0ms">
        <mat-tab label="Linked accounts">
          @if (accounts().length === 0) {
            <app-empty-state icon="account_balance" message="No society has set up online payments yet." />
          } @else {
            <div class="list">
              @for (a of accounts(); track a.societyId) {
                <div class="row">
                  <div class="main">
                    <span class="title">
                      {{ a.societyName ?? 'Society ' + a.societyId }}
                      @if (a.status; as s) {
                        <app-status-pill [tone]="accountStatus[s].tone">{{ accountStatus[s].label }}</app-status-pill>
                      }
                      @if (a.accepting) {
                        <app-status-pill tone="success">Taking payments</app-status-pill>
                      }
                    </span>
                    <span class="meta">
                      {{ a.legalName }} · {{ a.razorpayAccountId ?? 'no Razorpay account yet' }} · bank ending {{ a.bankLast4 }}
                    </span>
                    @if (a.reason) {
                      <span class="meta danger-text">{{ a.reason }}</span>
                    }
                  </div>
                  @if (canUpdate()) {
                    @if (a.status === 'SUSPENDED') {
                      <button mat-stroked-button (click)="resume(a)">Resume</button>
                    } @else {
                      <button mat-stroked-button (click)="suspend(a)">Suspend</button>
                    }
                  }
                </div>
              }
            </div>
          }
        </mat-tab>
        <mat-tab [label]="'Transfers' + (transfers().length ? ' (' + transfers().length + ')' : '')">
          @if (transfers().length === 0) {
            <app-empty-state icon="task_alt" message="Every transfer went through." />
          } @else {
            <div class="list">
              @for (r of transfers(); track r.orderId) {
                <div class="row">
                  <div class="main">
                    <span class="title">
                      {{ rupees(r.dues) }} · flat {{ r.flatLabel }} (society {{ r.societyId }})
                      @if (r.transferStatus; as t) {
                        <app-status-pill [tone]="transferStatus[t].tone">{{ transferStatus[t].label }}</app-status-pill>
                      }
                    </span>
                    <span class="meta">{{ r.gatewayPaymentId }} · {{ r.transferError ?? 'waiting for the next attempt' }}</span>
                  </div>
                  @if (canUpdate() && r.transferStatus === 'FAILED' && r.transferId) {
                    <button mat-stroked-button (click)="retry(r)" [disabled]="busy()">
                      <mat-icon>replay</mat-icon>
                      Retry
                    </button>
                  }
                </div>
              }
            </div>
          }
        </mat-tab>
        <mat-tab [label]="'Unrecorded' + (problems().length ? ' (' + problems().length + ')' : '')">
          @if (problems().length === 0) {
            <app-empty-state icon="task_alt" message="Every payment was recorded." />
          } @else {
            <div class="list">
              @for (r of problems(); track r.orderId) {
                <div class="row">
                  <div class="main">
                    <span class="title">{{ rupees(r.dues) }} · flat {{ r.flatLabel }} (society {{ r.societyId }})</span>
                    <span class="meta danger-text">{{ r.problem }}</span>
                  </div>
                  @if (canUpdate() && !r.refundStatus) {
                    <button mat-stroked-button (click)="refund(r)">
                      <mat-icon>undo</mat-icon>
                      Refund
                    </button>
                  }
                </div>
              }
            </div>
          }
        </mat-tab>
      </mat-tab-group>
    }
  `,
  styles: `
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 0;
    }
    .row {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
    }
    .main {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .title {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      font-weight: 500;
    }
    .meta {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
      overflow-wrap: anywhere;
    }
    .danger-text {
      color: var(--mat-sys-error);
    }
  `,
})
export class PlatformPayments {
  private readonly api = inject(PaymentApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly rupees = rupees;
  protected readonly accountStatus = ACCOUNT_STATUS;
  protected readonly transferStatus = TRANSFER_STATUS;

  protected readonly accounts = signal<PaymentAccount[]>([]);
  protected readonly transfers = signal<OnlinePaymentRow[]>([]);
  protected readonly problems = signal<OnlinePaymentRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly busy = signal(false);

  protected readonly canUpdate = computed(() => this.auth.canOnPlatform('PLATFORM.BILLING.UPDATE'));
  protected readonly activeCount = computed(() => this.accounts().filter((a) => a.status === 'ACTIVATED').length);
  protected readonly reviewCount = computed(
    () => this.accounts().filter((a) => a.status === 'UNDER_REVIEW' || a.status === 'NEEDS_CLARIFICATION').length,
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    forkJoin([this.api.platformAccounts(), this.api.stuckTransfers(), this.api.problems()])
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        this.loading.set(false);
        this.loadError.set(result === null);
        if (result) {
          this.accounts.set(result[0]);
          this.transfers.set(result[1]);
          this.problems.set(result[2]);
        }
      });
  }

  protected suspend(a: PaymentAccount): void {
    reasonDialog(this.dialog, {
      title: `Suspend online payments of ${a.societyName ?? 'the society'}`,
      message: 'Residents can\'t pay online until you resume it. Payments already made are not affected.',
      label: 'Reason (the society sees it)',
      confirmText: 'Suspend',
      danger: true,
      save: (reason) => this.api.suspendAccount(a.societyId, reason),
    }).subscribe(() => this.load());
  }

  protected resume(a: PaymentAccount): void {
    this.api.resumeAccount(a.societyId).subscribe(() => {
      this.snack.open('Online payments resumed', undefined, { duration: 3000 });
      this.load();
    });
  }

  protected retry(r: OnlinePaymentRow): void {
    if (r.transferId == null) return;
    this.busy.set(true);
    this.api.retryTransfer(r.transferId).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.snack.open(res.status === 'CREATED' ? 'Transferred' : 'Still failing; see the error', undefined, { duration: 4000 });
        this.load();
      },
      error: () => this.busy.set(false),
    });
  }

  protected refund(r: OnlinePaymentRow): void {
    reasonDialog(this.dialog, {
      title: `Refund ${rupees(r.dues)}`,
      message: 'The whole amount the resident paid goes back to them.',
      label: 'Reason',
      confirmText: 'Refund',
      danger: true,
      save: (reason) => this.api.platformRefundOrder(r.orderId, reason),
    }).subscribe(() => {
      this.snack.open('Refund sent to Razorpay', undefined, { duration: 4000 });
      this.load();
    });
  }
}
