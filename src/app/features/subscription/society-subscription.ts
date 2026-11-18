import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';

import { SubscriptionApi } from '../../core/api/subscription.api';
import { UserApi } from '../../core/api/user.api';
import { Notifier } from '../../core/notifier';
import { Plan, PlanRecommendation, PlatformInvoiceSummary, SocietySubscription } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { SubscriptionAccessStore } from '../../core/subscription/subscription-access.store';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import {
  BillingAccess,
  INVOICE_STATUS,
  RazorpayCheckout,
  SUBSCRIPTION_STATUS,
  billingContactDialog,
  chargeBreakdown,
  choosePlanDialog,
  cycleLabel,
  dayLabel,
  eventLabel,
  inr,
  modulesLabel,
  periodLabel,
} from './subscription-ui';

/**
 * The selected society's plan, invoices and receipts (SECRETARY and above, or the platform):
 * "Pay now" through Razorpay, the billing contact, asking for another plan, and the history.
 * `?invoice=<id>` (from an email link) opens that invoice.
 */
@Component({
  selector: 'app-society-subscription',
  imports: [RouterLink, MatButtonModule, MatIconModule, EmptyState, PageHeader, Section, Skeleton, StatusPill],
  templateUrl: './society-subscription.html',
  styleUrls: ['../maintenance/maintenance.scss', './subscription.scss'],
})
export class SocietySubscriptionPage {
  private readonly api = inject(SubscriptionApi);
  private readonly userApi = inject(UserApi);
  private readonly dialog = inject(MatDialog);
  private readonly notifier = inject(Notifier);
  private readonly checkout = inject(RazorpayCheckout);
  private readonly accessStore = inject(SubscriptionAccessStore);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(BillingAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly periodLabel = periodLabel;
  protected readonly cycleLabel = cycleLabel;
  protected readonly modulesLabel = modulesLabel;
  protected readonly eventLabel = eventLabel;
  protected readonly chargeBreakdown = chargeBreakdown;
  protected readonly invoiceStatus = INVOICE_STATUS;

  protected readonly subscription = signal<SocietySubscription | null>(null);
  protected readonly invoices = signal<PlatformInvoiceSummary[]>([]);
  protected readonly contactName = signal<string | null>(null);
  protected readonly contactEmail = signal<string | null>(null);
  protected readonly loading = signal(true);
  /** 'none': billing isn't on for this society. */
  protected readonly loadError = signal<'none' | 'failed' | null>(null);
  protected readonly paying = signal<number | null>(null);

  protected readonly status = computed(() => {
    const s = this.subscription();
    return s ? SUBSCRIPTION_STATUS[s.status] : null;
  });
  protected readonly canUpdate = computed(() => this.access.canUpdate(this.ctx.selectedSocietyId()));
  protected readonly unpaid = computed(() => this.invoices().filter((i) => i.balance > 0));
  protected readonly oldestOverdue = computed(
    () =>
      this.invoices()
        .filter((i) => i.overdue)
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null,
  );
  protected readonly history = computed(() => [...(this.subscription()?.events ?? [])].reverse());

  /** Every plan's cost at the society's flats today, and the recommended one (hidden if it fails). */
  protected readonly recommendation = signal<PlanRecommendation | null>(null);
  /** The plan the next invoice uses. */
  protected readonly nextPlan = computed(() => {
    const s = this.subscription();
    return s ? (s.pendingPlan ?? s.plan) : null;
  });
  /** The recommended plan, when it is a step up from the society's (or its plan no longer fits). */
  protected readonly suggested = computed(() => {
    const r = this.recommendation();
    const current = this.nextPlan();
    if (!r || !current) return null;
    const rec = r.quotes.find((q) => q.recommended);
    if (!rec || rec.plan.id === current.id) return null;
    const mine = r.quotes.find((q) => q.plan.id === current.id);
    return !mine || !mine.fits || rec.plan.sortOrder > current.sortOrder ? rec : null;
  });

  protected price(plan: Plan): number {
    return (this.subscription()?.pendingCycle ?? this.subscription()?.cycle) === 'YEARLY' ? plan.priceYearly : plan.priceMonthly;
  }

  protected extraRate(plan: Plan): number | null {
    return (this.subscription()?.pendingCycle ?? this.subscription()?.cycle) === 'YEARLY'
      ? plan.extraFlatYearly
      : plan.extraFlatMonthly;
  }

  constructor() {
    effect(() => {
      const societyId = this.ctx.selectedSocietyId();
      untracked(() => this.load(societyId));
    });

    const route = inject(ActivatedRoute);
    const router = inject(Router);
    const invoice = route.snapshot.queryParamMap.get('invoice');
    if (invoice) void router.navigate(['/subscription/invoices', invoice], { replaceUrl: true });
  }

  protected retry(): void {
    this.load(this.ctx.selectedSocietyId());
  }

  protected async pay(invoice: PlatformInvoiceSummary): Promise<void> {
    if (this.paying() !== null) return;
    this.paying.set(invoice.id);
    const outcome = await this.checkout.pay(invoice.id);
    this.paying.set(null);
    if (outcome.kind === 'paid') {
      this.notifier.show(`Paid — thank you. Receipt sent for ${invoice.number}.`, 'Close');
      this.accessStore.refresh();
      this.retry();
    } else if (outcome.kind === 'failed') {
      this.notifier.show(outcome.message, 'Close');
      // A payment may still arrive through Razorpay's webhook.
      this.retry();
    }
  }

  protected changeContact(): void {
    const societyId = this.ctx.selectedSocietyId();
    const s = this.subscription();
    if (societyId == null || !s) return;
    this.userApi
      .list(societyId)
      .pipe(
        map((users) =>
          users
            .filter((u) => u.isActive && u.roles.some((r) => r.societyId === societyId && r.flatId == null))
            .map((u) => ({
              id: u.id,
              label: `${u.name} · ${u.roles.find((r) => r.societyId === societyId && r.flatId == null)?.roleName ?? ''}`,
              hasEmail: !!u.email,
            })),
        ),
      )
      .subscribe((options) =>
        billingContactDialog(this.dialog, {
          options,
          current: s.billingContactId,
          save: (userId) => this.api.setBillingContact(societyId, userId),
        }).subscribe(() => this.retry()),
      );
  }

  /** Asks the platform for another plan, starting from `planId` (or the current one). */
  protected askForChange(planId: number | null): void {
    const societyId = this.ctx.selectedSocietyId();
    const s = this.subscription();
    if (societyId == null || !s) return;
    this.api.plans().subscribe((plans) =>
      choosePlanDialog(this.dialog, {
        title: 'Ask for another plan',
        intro: 'The platform will get in touch. Changes apply from the next billing period.',
        confirmText: 'Send request',
        plans: plans.filter((p) => p.active),
        planId: planId ?? s.pendingPlan?.id ?? s.plan.id,
        cycle: s.pendingCycle ?? s.cycle,
        withNote: true,
        save: (planId, cycle, note) => this.api.requestChange(societyId, planId, cycle, note),
      }).subscribe(() => {
        this.notifier.show('Request sent to the platform', 'Close');
        this.retry();
      }),
    );
  }

  private load(societyId: number | null): void {
    this.subscription.set(null);
    this.recommendation.set(null);
    this.invoices.set([]);
    this.contactName.set(null);
    this.contactEmail.set(null);
    if (societyId == null) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      subscription: this.api.get(societyId),
      invoices: this.api.invoicesOf(societyId).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ subscription, invoices }) => {
        if (this.ctx.selectedSocietyId() !== societyId) return;
        this.subscription.set(subscription);
        this.invoices.set(invoices);
        this.loading.set(false);
        this.api.recommendation(societyId).subscribe({
          next: (r) => {
            if (this.ctx.selectedSocietyId() === societyId) this.recommendation.set(r);
          },
          error: () => this.recommendation.set(null),
        });
        if (subscription.billingContactId != null) {
          this.userApi.get(subscription.billingContactId).subscribe({
            next: (u) => {
              this.contactName.set(u.name);
              this.contactEmail.set(u.email);
            },
            error: () => this.contactName.set(`User #${subscription.billingContactId}`),
          });
        }
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(err.status === 404 ? 'none' : 'failed');
      },
    });
  }
}
