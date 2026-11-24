import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { PaymentApi } from '../../core/api/payment.api';
import { AuthStore } from '../../core/auth/auth.store';
import { GatewayRefund, OnlinePaymentRow } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { exportDialog } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton, StatCard, StatusPill } from '../../shared/ui';
import { ORDER_STATUS, REFUND_STATUS, TRANSFER_STATUS, feeModeLabel, reasonDialog, rupees } from './payments-ui';

/**
 * The society's online payments (COMMITTEE and above): what each resident paid, the gateway fee and
 * commission, what reached the society, and refunds through the gateway (the SECRETARY refunds and,
 * above the approval limit, someone else approves).
 */
@Component({
  selector: 'app-online-payments',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatCard,
    StatusPill,
  ],
  template: `
    <app-page-header title="Online payments" subtitle="Paid by residents through Razorpay">
      <a mat-stroked-button routerLink="/online-payments/setup">
        <mat-icon>tune</mat-icon>
        Setup
      </a>
      @if (canExport()) {
        <button mat-stroked-button (click)="export()">
          <mat-icon>download</mat-icon>
          Export
        </button>
      }
    </app-page-header>

    @if (loading()) {
      <app-skeleton variant="list" />
    } @else if (loadError()) {
      <app-empty-state icon="cloud_off" message="Couldn't load the online payments.">
        <button mat-stroked-button (click)="load()">Try again</button>
      </app-empty-state>
    } @else {
      <div class="stats">
        <app-stat-card icon="payments" label="Paid online (30 days)" [value]="rupees(stats().paid)" tone="success" />
        <app-stat-card icon="account_balance" label="Reached the society" [value]="rupees(stats().transferred)" />
        <app-stat-card icon="receipt_long" label="Fees & commission" [value]="rupees(stats().charges)" />
        <app-stat-card icon="warning" label="Need a hand" [value]="'' + stats().attention" tone="warning" />
      </div>

      <mat-tab-group mat-stretch-tabs="false" animationDuration="0ms">
        <mat-tab label="Payments">
          @if (rows().length === 0) {
            <app-empty-state icon="bolt" message="No online payments in the last 30 days." />
          } @else {
            <div class="list">
              @for (r of rows(); track r.orderId) {
                <div class="row">
                  <div class="main">
                    <span class="title">
                      Flat {{ r.flatLabel }} · {{ rupees(r.dues) }}
                      <app-status-pill [tone]="orderStatus[r.status].tone">{{ orderStatus[r.status].label }}</app-status-pill>
                      @if (r.transferStatus; as t) {
                        <app-status-pill [tone]="transferStatus[t].tone">{{ transferStatus[t].label }}</app-status-pill>
                      }
                      @if (r.refundStatus; as rs) {
                        <app-status-pill [tone]="refundStatus[rs].tone">{{ refundStatus[rs].label }}</app-status-pill>
                      }
                    </span>
                    <span class="meta">
                      {{ day(r.paidAt) }} · {{ r.payerName ?? 'A resident' }}
                      @if (r.receiptNumber) {
                        · receipt {{ r.receiptNumber }}
                      }
                      · {{ feeModeLabel(r.feeMode) }}
                      @if (r.convenienceFee > 0) {
                        (+{{ rupees(r.convenienceFee) }} paid by the resident)
                      }
                    </span>
                    <span class="meta">
                      Gateway fee {{ rupees(r.gatewayFee) }} · commission {{ rupees(r.commission) }} · to the
                      society {{ rupees(r.transferAmount) }}
                    </span>
                    @if (r.problem) {
                      <span class="meta danger-text">{{ r.problem }}</span>
                    }
                    @if (r.transferError && r.transferStatus !== 'CREATED' && r.transferStatus !== 'PROCESSED') {
                      <span class="meta danger-text">{{ r.transferError }}</span>
                    }
                  </div>
                  @if (canRefund() && canRefundRow(r)) {
                    <button mat-stroked-button (click)="refund(r)" [matTooltip]="r.status === 'PROBLEM' ? 'Give the money back' : 'Refund the whole payment'">
                      <mat-icon>undo</mat-icon>
                      Refund
                    </button>
                  }
                </div>
              }
            </div>
          }
        </mat-tab>
        <mat-tab [label]="'Refunds' + (waiting() ? ' (' + waiting() + ')' : '')">
          @if (refunds().length === 0) {
            <app-empty-state icon="undo" message="No refunds through the gateway yet." />
          } @else {
            <div class="list">
              @for (f of refunds(); track f.id) {
                <div class="row">
                  <div class="main">
                    <span class="title">
                      {{ rupees(f.amount) }}
                      <app-status-pill [tone]="refundStatus[f.status].tone">{{ refundStatus[f.status].label }}</app-status-pill>
                    </span>
                    <span class="meta">{{ day(f.requestedAt) }} · {{ f.kind === 'ORDER' ? 'Unrecorded payment' : 'Recorded payment' }} · {{ f.reason }}</span>
                    @if (f.error) {
                      <span class="meta danger-text">{{ f.error }}</span>
                    }
                    @if (f.decisionReason) {
                      <span class="meta">Rejected: {{ f.decisionReason }}</span>
                    }
                  </div>
                  @if (canRefund() && f.status === 'PENDING_APPROVAL' && f.requestedBy !== userId()) {
                    <span class="actions">
                      <button mat-stroked-button (click)="reject(f)">Reject</button>
                      <button mat-flat-button (click)="approve(f)" [disabled]="busy()">Approve</button>
                    </span>
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
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .danger-text {
      color: var(--mat-sys-error);
    }
  `,
})
export class OnlinePayments {
  private readonly api = inject(PaymentApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly ctx = inject(SocietyContextStore);

  protected readonly rupees = rupees;
  protected readonly feeModeLabel = feeModeLabel;
  protected readonly orderStatus = ORDER_STATUS;
  protected readonly transferStatus = TRANSFER_STATUS;
  protected readonly refundStatus = REFUND_STATUS;

  protected readonly rows = signal<OnlinePaymentRow[]>([]);
  protected readonly refunds = signal<GatewayRefund[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly busy = signal(false);

  protected readonly userId = computed(() => this.auth.user()?.id ?? null);
  protected readonly canRefund = computed(() => this.auth.can('PAYMENT.REFUND.CREATE', this.ctx.selectedSocietyId()));
  protected readonly canExport = computed(() => this.auth.can('PAYMENT.ONLINE.EXPORT', this.ctx.selectedSocietyId()));
  protected readonly waiting = computed(() => this.refunds().filter((r) => r.status === 'PENDING_APPROVAL').length);
  protected readonly stats = computed(() => {
    const paid = this.rows().filter((r) => r.status === 'PAID');
    const total = (f: (r: OnlinePaymentRow) => number | null) => paid.reduce((s, r) => s + (f(r) ?? 0), 0);
    return {
      paid: total((r) => r.dues),
      transferred: total((r) => (r.transferStatus === 'CREATED' || r.transferStatus === 'PROCESSED' ? r.transferAmount : 0)),
      charges: total((r) => (r.transferAmount == null ? 0 : r.dues - r.transferAmount)),
      attention:
        this.rows().filter((r) => r.status === 'PROBLEM' || r.transferStatus === 'FAILED').length + this.waiting(),
    };
  });

  constructor() {
    effect(() => {
      if (this.ctx.selectedSocietyId() != null) this.load();
    });
  }

  protected day(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected canRefundRow(r: OnlinePaymentRow): boolean {
    const live = r.refundStatus === 'PENDING_APPROVAL' || r.refundStatus === 'REQUESTED' || r.refundStatus === 'PROCESSED';
    return !live && (r.status === 'PROBLEM' || (r.status === 'PAID' && r.maintenancePaymentId != null));
  }

  protected load(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    this.loading.set(true);
    forkJoin([this.api.payments(societyId, null, null), this.api.refunds(societyId)])
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        this.loading.set(false);
        this.loadError.set(result === null);
        if (result) {
          this.rows.set(result[0]);
          this.refunds.set(result[1]);
        }
      });
  }

  protected refund(r: OnlinePaymentRow): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    const problem = r.status === 'PROBLEM';
    reasonDialog(this.dialog, {
      title: problem ? 'Give the money back' : `Refund ${rupees(r.dues)} to flat ${r.flatLabel}`,
      message: problem
        ? 'This payment couldn\'t be recorded. The whole amount goes back to the resident.'
        : `Receipt ${r.receiptNumber} is voided, so the bills are owed again. ${rupees(r.dues)} goes back to the ` +
          'resident, and Razorpay takes the society\'s share back from its account.',
      label: 'Reason',
      confirmText: 'Refund',
      danger: true,
      save: (reason) =>
        problem
          ? this.api.refundOrder(societyId, r.orderId, reason)
          : this.api.refundPayment(societyId, r.maintenancePaymentId!, reason),
    }).subscribe((refund) => {
      this.snack.open(
        refund.status === 'PENDING_APPROVAL' ? 'The refund is waiting for approval' : 'Refund sent to Razorpay',
        undefined,
        { duration: 4000 },
      );
      this.load();
    });
  }

  protected approve(f: GatewayRefund): void {
    this.busy.set(true);
    this.api.approveRefund(f.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.snack.open('Refund sent to Razorpay', undefined, { duration: 4000 });
        this.load();
      },
      error: () => this.busy.set(false),
    });
  }

  protected reject(f: GatewayRefund): void {
    reasonDialog(this.dialog, {
      title: 'Reject the refund',
      label: 'Why',
      confirmText: 'Reject',
      save: (reason) => this.api.rejectRefund(f.id, reason),
    }).subscribe(() => this.load());
  }

  protected export(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    exportDialog(this.dialog, {
      title: 'Export online payments',
      download: (range) => this.api.exportPayments(societyId, range.from, range.to),
    }).subscribe();
  }
}
