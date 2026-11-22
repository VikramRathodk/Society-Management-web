import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, forkJoin, of } from 'rxjs';

import { SubscriptionApi } from '../../core/api/subscription.api';
import { Notifier } from '../../core/notifier';
import { Plan, PlatformInvoiceSummary, SocietySubscription } from '../../core/models';
import { confirmDialog } from '../../shared/confirm-dialog';
import { nameDialog } from '../../shared/name-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatCard, StatusPill } from '../../shared/ui';
import {
  BillingAccess,
  INVOICE_STATUS,
  SUBSCRIPTION_STATUS,
  amountDialog,
  choosePlanDialog,
  cycleLabel,
  dayLabel,
  inr,
  isFreePlan,
  modulesLabel,
  periodLabel,
  planDialog,
  priceLabel,
} from './subscription-ui';

/**
 * The platform's billing desk (super admin): every society's subscription, every invoice (overdue
 * first), the plans on offer, and the billing run on demand.
 */
@Component({
  selector: 'app-platform-billing',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatTabsModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatCard,
    StatusPill,
  ],
  templateUrl: './platform-billing.html',
  styleUrls: ['../maintenance/maintenance.scss', './subscription.scss'],
})
export class PlatformBilling {
  private readonly api = inject(SubscriptionApi);
  private readonly dialog = inject(MatDialog);
  private readonly notifier = inject(Notifier);
  protected readonly access = inject(BillingAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly periodLabel = periodLabel;
  protected readonly cycleLabel = cycleLabel;
  protected readonly modulesLabel = modulesLabel;
  protected readonly priceLabel = priceLabel;
  protected readonly subscriptionStatus = SUBSCRIPTION_STATUS;
  protected readonly invoiceStatus = INVOICE_STATUS;

  protected readonly subscriptions = signal<SocietySubscription[]>([]);
  protected readonly invoices = signal<PlatformInvoiceSummary[]>([]);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly overdueOnly = signal(false);
  protected readonly busy = signal(false);

  protected readonly shownInvoices = computed(() =>
    this.overdueOnly() ? this.invoices().filter((i) => i.overdue) : this.invoices(),
  );
  protected readonly stats = computed(() => {
    const subs = this.subscriptions();
    const invoices = this.invoices();
    return {
      paying: subs.filter((s) => (s.status === 'ACTIVE' || s.status === 'PAST_DUE') && !isFreePlan(s.plan)).length,
      free: subs.filter((s) => s.status === 'ACTIVE' && isFreePlan(s.plan)).length,
      suspended: subs.filter((s) => s.status === 'SUSPENDED').length,
      outstanding: invoices.reduce((sum, i) => sum + i.balance, 0),
      overdue: invoices.filter((i) => i.overdue).reduce((sum, i) => sum + i.balance, 0),
      collected: invoices.reduce((sum, i) => sum + (i.total - i.balance), 0),
    };
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    forkJoin({
      subscriptions: this.api.subscriptions(),
      invoices: this.api.allInvoices(),
      plans: this.api.plans(),
    }).subscribe({
      next: ({ subscriptions, invoices, plans }) => {
        this.subscriptions.set([...subscriptions].sort((a, b) => (a.societyName ?? '').localeCompare(b.societyName ?? '')));
        this.invoices.set(invoices);
        this.plans.set(plans);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(true);
      },
    });
  }

  // ---- Platform-wide ----

  protected async runBilling(): Promise<void> {
    const ok = await firstValueFrom(
      confirmDialog(this.dialog, {
        title: 'Run billing now',
        message:
          'Issues the invoices that are due, sends reminders and moves overdue societies to payment overdue or suspended — the same pass the 06:00 job makes. Nothing is done twice.',
        confirmText: 'Run billing',
      }),
    );
    if (!ok) return;
    this.busy.set(true);
    this.api.run().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.notifier.show(
          `${r.invoiced} invoiced · ${r.reminded} reminded · ${r.pastDue} overdue · ${r.suspended} suspended`,
          'Close',
        );
        this.load();
      },
      error: () => this.busy.set(false),
    });
  }

  protected async startAll(): Promise<void> {
    const ok = await firstValueFrom(
      confirmDialog(this.dialog, {
        title: 'Start subscriptions',
        message:
          'Every live society without a subscription starts today: on Free when it fits, otherwise on the plan for its number of flats (invoiced at once).',
        confirmText: 'Start subscriptions',
      }),
    );
    if (!ok) return;
    this.api.startAll().subscribe((r) => {
      this.notifier.show(`${r.started} subscription(s) started`, 'Close');
      this.load();
    });
  }

  // ---- One subscription ----

  protected changePlan(s: SocietySubscription): void {
    choosePlanDialog(this.dialog, {
      title: `Plan for ${s.societyName}`,
      intro:
        isFreePlan(s.plan)
          ? 'Leaving the free plan applies at once; the first period is invoiced today.'
          : 'Applies from the next billing period; the next invoice uses it.',
      confirmText: 'Change plan',
      plans: this.plans().filter((p) => p.active),
      planId: s.pendingPlan?.id ?? s.plan.id,
      cycle: s.pendingCycle ?? s.cycle,
      save: (planId, cycle) => this.api.changePlan(s.societyId, planId, cycle),
    }).subscribe(() => this.load());
  }

  protected discount(s: SocietySubscription): void {
    amountDialog(this.dialog, {
      title: `Discount for ${s.societyName}`,
      intro: 'A percentage off the next invoices. 0% or 0 periods removes it.',
      amountLabel: 'Percent off',
      amount: s.discountPercent || null,
      max: 100,
      whole: true,
      countLabel: 'For how many periods',
      count: s.discountPeriodsLeft || 3,
      textLabel: 'Note (optional)',
      confirmText: 'Save discount',
      save: (percent, note, periods) => this.api.setDiscount(s.societyId, Math.round(percent), periods, note),
    }).subscribe(() => this.load());
  }

  protected issueDue(s: SocietySubscription): void {
    this.api.issueDue(s.societyId).subscribe((invoice) => {
      this.notifier.show(
        invoice ? `Issued ${invoice.summary.number}` : `Nothing is due yet (next invoice ${dayLabel(s.nextInvoiceOn)})`,
        'Close',
      );
      if (invoice) this.load();
    });
  }

  protected cancel(s: SocietySubscription): void {
    nameDialog(this.dialog, {
      title: `Cancel ${s.societyName}'s subscription`,
      label: 'Why is the society leaving?',
      confirmText: 'Cancel subscription',
      save: (note) => this.api.cancel(s.societyId, note),
    }).subscribe(() => this.load());
  }

  // ---- Plans ----

  protected editPlan(plan: Plan | null): void {
    planDialog(this.dialog, plan).subscribe(() =>
      this.api
        .plans()
        .pipe(catchError(() => of(this.plans())))
        .subscribe((plans) => this.plans.set(plans)),
    );
  }

  protected trackInvoice(i: PlatformInvoiceSummary): number {
    return i.id;
  }
}
