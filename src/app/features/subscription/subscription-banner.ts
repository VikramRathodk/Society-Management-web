import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { SubscriptionAccessStore } from '../../core/subscription/subscription-access.store';
import { dayLabel, inr } from './subscription-ui';

/**
 * On every page while the selected society's subscription is suspended (or cancelled): paid work is
 * read-only. Those who may pay get a link to the invoice; others are told whom to ask.
 */
@Component({
  selector: 'app-subscription-banner',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    @if (state(); as s) {
      <aside class="banner" role="alert">
        <mat-icon aria-hidden="true">block</mat-icon>
        <p>
          @if (s.status === 'CANCELLED') {
            <strong>The subscription is cancelled.</strong>
            <span> The society's records are read-only.</span>
          } @else {
            <strong>Your subscription is suspended.</strong>
            <span>
              Bills, vouchers, policies and meetings are read-only until
              @if (s.overdueInvoiceNumber) {
                invoice {{ s.overdueInvoiceNumber }} ({{ inr(s.overdueBalance) }}, due
                {{ dayLabel(s.overdueSince) }}) is paid.
              } @else {
                the overdue invoice is paid.
              }
              Visitors, complaints and notices keep working.
            </span>
            @if (!canPay()) {
              <span> Ask the secretary to pay it.</span>
            }
          }
        </p>
        @if (canPay() && s.overdueInvoiceId && s.status !== 'CANCELLED') {
          <a mat-flat-button [routerLink]="['/subscription/invoices', s.overdueInvoiceId]">Pay now</a>
        }
      </aside>
    }
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding: 10px 16px;
      border-radius: 12px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    p {
      flex: 1 1 240px;
      margin: 0;
    }
  `,
})
export class SubscriptionBanner {
  private readonly store = inject(SubscriptionAccessStore);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;

  protected readonly state = computed(() => {
    const s = this.store.state();
    return s?.billing && s.readOnly ? s : null;
  });
  protected readonly canPay = computed(() =>
    this.auth.can('SOCIETY.SUBSCRIPTION.UPDATE', this.ctx.selectedSocietyId()),
  );
}
