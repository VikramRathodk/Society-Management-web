import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { SubscriptionApi } from '../../core/api/subscription.api';
import { Plan, PlanQuote, PlanRecommendation } from '../../core/models';
import { Avatar, CountUp, Logo, Reveal, StatusPill, motionAllowed } from '../../shared/ui';

/**
 * Sales details. Sections that need them stay hidden until they're filled in, so the page never
 * shows a dead contact link. Prices come from the plans the platform offers (Billing → Plans).
 */
export const LANDING = {
  /** e.g. 'hello@yourdomain.in' — shows "Request a demo" in the hero and the closing section. */
  contactEmail: null as string | null,
  /** e.g. '+91 98xxx xxxxx' — shown next to the email. */
  contactPhone: null as string | null,
  /** Links in the footer's Legal column; each one shows once it is filled in. */
  privacyUrl: null as string | null,
  termsUrl: null as string | null,
  /**
   * Real social proof only, never made up. The section stays hidden until a quote or a figure is
   * filled in, e.g. quote: '…', name: 'R. Sharma', role: 'Secretary, Green Acres CHS, Pune',
   * figures: [{ value: '1,200', label: 'flats on Sahvasa' }].
   */
  proof: {
    quote: null as string | null,
    name: null as string | null,
    role: null as string | null,
    figures: [] as { value: string; label: string }[],
  },
};

/** One pricing card. */
export interface PricingCard {
  id: number;
  name: string;
  /** "₹699", or "Free". */
  price: string;
  /** "/ month", "/ year", or '' for a free plan. */
  per: string;
  blurb: string;
  points: string[];
  /** "Most popular". */
  featured: boolean;
}

export type PricingCycle = 'MONTHLY' | 'YEARLY';

const PAID_MODULE_POINTS: Record<string, string> = {
  MAINTENANCE: 'Maintenance billing, receipts and dues',
  FINANCE: 'Accounts, approvals, reports and bank reconciliation',
  POLICIES: 'Rules and policies with acceptance tracking',
  GOVERNANCE: 'Meetings, e-voting and minutes',
  PARKING: 'Parking slots, vehicles and stickers',
  ONLINE_PAYMENTS: 'Online maintenance payments to the society’s account',
};

/** "₹20" for whole rupees, "₹12.50" otherwise. */
function rupees(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * A plan as the landing page shows it: the society's price a month (or a year), the flats it covers
 * and what each one beyond costs, what's included, and the fine print.
 */
export function pricingCard(plan: Plan, cycle: PricingCycle = 'MONTHLY'): PricingCard {
  const yearly = cycle === 'YEARLY';
  const price = yearly ? plan.priceYearly : plan.priceMonthly;
  const extra = yearly ? plan.extraFlatYearly : plan.extraFlatMonthly;
  const free = plan.priceMonthly === 0 && plan.priceYearly === 0;
  const modules = plan.modules.includes('ALL')
    ? [...Object.values(PAID_MODULE_POINTS), 'Every module we add later']
    : Object.entries(PAID_MODULE_POINTS)
        .filter(([m]) => plan.modules.includes(m as Plan['modules'][number]))
        .map(([, label]) => label);

  const points: string[] = [];
  const stopsAtIncluded =
    plan.maxFlats != null && plan.includedFlats != null && plan.maxFlats <= plan.includedFlats;
  if (plan.maxFlats && (free || stopsAtIncluded)) {
    points.push(`Up to ${plan.maxFlats} flats`);
  } else if (plan.includedFlats) {
    points.push(`Up to ${plan.includedFlats} flats included`);
    if (extra != null && extra > 0) {
      points.push(`${rupees(extra)} ${yearly ? 'a year' : 'a month'} for each extra flat`);
    }
    if (plan.maxFlats) points.push(`At most ${plan.maxFlats} flats`);
  } else {
    points.push('Any number of flats');
  }
  points.push('Visitors, notices, complaints and residents', ...modules);
  if (!free && !yearly && plan.priceMonthly > 0) {
    const saved = 12 - plan.priceYearly / plan.priceMonthly;
    points.push(
      saved >= 1 && Number.isInteger(saved)
        ? `Yearly: ${rupees(plan.priceYearly)} (${saved} month${saved === 1 ? '' : 's'} free)`
        : `Yearly: ${rupees(plan.priceYearly)}`,
    );
  }

  const fine = [free ? 'Free for good' : '+ 18% GST'];
  return {
    id: plan.id,
    name: plan.name,
    price: free ? 'Free' : rupees(price),
    per: free ? '' : yearly ? '/ year' : '/ month',
    blurb: [plan.description, fine.join(' · ')].filter((x) => !!x).join(' — '),
    points,
    featured: plan.featured,
  };
}

/** What a plan costs a society of the size typed in, as its card shows it. */
export interface CardQuote {
  /** "₹795 / month for your 58 flats" */
  total: string;
  /** "₹699 + 8 extra flats × ₹12" when there are extra flats. */
  breakdown: string | null;
  fits: boolean;
  recommended: boolean;
}

export function cardQuote(q: PlanQuote, cycle: PricingCycle): CardQuote {
  const yearly = cycle === 'YEARLY';
  const total = yearly ? q.yearly : q.monthly;
  const price = yearly ? q.plan.priceYearly : q.plan.priceMonthly;
  const extra = yearly ? q.plan.extraFlatYearly : q.plan.extraFlatMonthly;
  const flats = `${q.flats} flat${q.flats === 1 ? '' : 's'}`;
  return {
    total: !q.fits
      ? `Too small for ${flats}`
      : total === 0
        ? `Free for your ${flats}`
        : `${rupees(total)} ${yearly ? '/ year' : '/ month'} for your ${flats}`,
    breakdown:
      q.fits && q.extraFlats > 0 && extra != null
        ? `${rupees(price)} + ${q.extraFlats} extra flat${q.extraFlats === 1 ? '' : 's'} × ${rupees(extra)}`
        : null,
    fits: q.fits,
    recommended: q.recommended,
  };
}

/**
 * Runs `tick` every `ms` once the page has rendered, unless motion is reduced or the tab is hidden;
 * stops on destroy. Call from a constructor or field initializer (it injects).
 */
function liveTicker(ms: number, tick: () => void): void {
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    if (!motionAllowed()) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, ms);
    destroyRef.onDestroy(() => clearInterval(id));
  });
}

/**
 * Frosted-glass product moments floating over the hero photo, playing like the real thing: a visitor
 * arrives and the flat approves, collections count up, and the society's activity streams in.
 * Illustrative sample data, hidden from assistive tech.
 */
@Component({
  selector: 'app-landing-hero-cards',
  imports: [MatIconModule, Avatar, CountUp],
  template: `
    <div class="glass visitor">
      <span class="glass-label"
        ><span class="live-dot"></span>Visitor at the gate<span class="when">just now</span></span
      >
      @for (v of [visitor()]; track v.name) {
        <div class="visitor-row enter">
          <app-avatar [name]="v.name" [size]="40" />
          <span class="who"
            ><strong>{{ v.name }}</strong
            ><small>{{ v.meta }}</small></span
          >
        </div>
      }
      @if (approved()) {
        <div class="approved-row enter">
          <mat-icon>check_circle</mat-icon>Approved by the flat · gate notified
        </div>
      } @else {
        <div class="actions">
          <span class="btn approve"><mat-icon>check</mat-icon>Approve</span>
          <span class="btn">Reject</span>
        </div>
      }
    </div>

    <div class="glass collect">
      <span class="glass-label"><mat-icon>receipt_long</mat-icon>November collections</span>
      <span class="big-num"><app-count-up value="86%" /></span>
      <span class="meter"><span></span></span>
      <small>31 of 36 flats paid</small>
    </div>

    <div class="glass activity">
      @for (a of [activity()]; track a.title) {
        <div class="activity-row enter">
          <span class="tick"
            ><mat-icon>{{ a.icon }}</mat-icon></span
          >
          <span class="who"
            ><strong>{{ a.title }}</strong
            ><small>{{ a.meta }}</small></span
          >
        </div>
      }
    </div>
  `,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host {
      position: relative;
      display: block;
      min-height: 460px;
    }

    .glass {
      position: absolute;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 18px 20px;
      border: 1px solid rgb(255 255 255 / 0.28);
      border-radius: 20px;
      background: rgb(255 255 255 / 0.14);
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.25),
        0 24px 48px -20px rgb(4 30 28 / 0.55);
      color: #fff;
      backdrop-filter: blur(16px) saturate(140%);
      -webkit-backdrop-filter: blur(16px) saturate(140%);
      animation:
        float-in 900ms var(--app-ease-out) both,
        bob 7s ease-in-out 1.5s infinite;
    }

    .glass-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: rgb(255 255 255 / 0.82);
      font: var(--mat-sys-label-medium);

      mat-icon {
        width: 16px;
        height: 16px;
        color: var(--app-accent);
        font-size: 16px;
      }
    }

    .when {
      margin-left: auto;
      color: rgb(255 255 255 / 0.6);
    }

    .live-dot {
      position: relative;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--app-accent);

      &::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 50%;
        background: var(--app-accent);
        opacity: 0.5;
        animation: ping 1.6s ease-out infinite;
      }
    }

    .visitor {
      top: 0;
      right: 6%;
      width: 310px;
      animation-delay: 350ms, 1.5s;
    }

    .visitor-row,
    .activity-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .who {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font: var(--mat-sys-body-medium);

      small {
        color: rgb(255 255 255 / 0.75);
        font: var(--mat-sys-body-small);
      }
    }

    .actions {
      display: flex;
      gap: 8px;
    }

    .btn {
      display: inline-flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 36px;
      border: 1px solid rgb(255 255 255 / 0.35);
      border-radius: 10px;
      font: var(--mat-sys-label-large);

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }

      &.approve {
        border-color: transparent;
        background: var(--app-accent);
        color: var(--app-on-accent);
      }
    }

    .approved-row {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 12px;
      border-radius: 10px;
      background: rgb(255 255 255 / 0.9);
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);

      mat-icon {
        width: 20px;
        height: 20px;
        font-size: 20px;
      }
    }

    .collect {
      top: 200px;
      left: 0;
      width: 240px;
      animation-delay: 500ms, 2.5s;
    }

    .big-num {
      font-family: var(--app-font-display);
      font-size: 2.4rem;
      line-height: 1;
      letter-spacing: -0.02em;
    }

    .meter {
      display: block;
      height: 8px;
      overflow: hidden;
      border-radius: 4px;
      background: rgb(255 255 255 / 0.2);

      span {
        display: block;
        width: 86%;
        height: 100%;
        border-radius: inherit;
        background: var(--app-accent);
        animation: fill 1.2s var(--app-ease-out) 900ms both;
      }
    }

    .collect small {
      color: rgb(255 255 255 / 0.8);
      font: var(--mat-sys-body-small);
    }

    .activity {
      right: 0;
      bottom: 0;
      width: 300px;
      animation-delay: 650ms, 3.5s;
    }

    .tick {
      display: grid;
      flex: none;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: rgb(255 255 255 / 0.9);
      color: var(--mat-sys-primary);
    }

    .enter {
      animation: enter 500ms var(--app-ease-out) both;
    }

    @keyframes float-in {
      from {
        opacity: 0;
        transform: translateY(16px) scale(0.98);
      }
    }

    @keyframes bob {
      50% {
        transform: translateY(-6px);
      }
    }

    @keyframes enter {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }

    @keyframes ping {
      to {
        opacity: 0;
        transform: scale(2.2);
      }
    }

    @keyframes fill {
      from {
        width: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .glass,
      .meter span,
      .enter,
      .live-dot::after {
        animation: none;
      }
    }
  `,
})
export class LandingHeroCards {
  private readonly visitors = [
    { name: 'Ravi Kumar', meta: 'Delivery · Flat A-101' },
    { name: 'Meera Iyer', meta: 'Guest · Flat B-204' },
    { name: 'Anil Shah', meta: 'Plumber · Flat C-302' },
    { name: 'Farah Khan', meta: 'Cab · Flat A-404' },
  ];
  private readonly activities = [
    { icon: 'task_alt', title: 'Expense approved', meta: 'Lift maintenance · ₹12,000' },
    { icon: 'payments', title: 'Payment received', meta: 'Flat B-204 · ₹2,800 by UPI' },
    { icon: 'build_circle', title: 'Complaint resolved', meta: 'Water leakage · Flat C-302' },
    { icon: 'sync_alt', title: 'Bank line matched', meta: 'NEFT · ₹45,000 · Nov collections' },
  ];

  private readonly step = signal(0);
  protected readonly visitor = computed(
    () => this.visitors[Math.floor(this.step() / 3) % this.visitors.length],
  );
  protected readonly approved = computed(() => this.step() % 3 === 2);
  protected readonly activity = computed(
    () => this.activities[Math.floor(this.step() / 2) % this.activities.length],
  );

  constructor() {
    liveTicker(1500, () => this.step.update((s) => s + 1));
  }
}

interface GateRow {
  id: number;
  name: string;
  meta: string;
  status: 'Waiting' | 'Approved' | 'Inside';
  tone: 'warning' | 'success' | 'primary';
}

interface WhyRow {
  id: 'books' | 'gate' | 'vote';
  kicker: string;
  title: string;
  text: string;
  points: string[];
}

/**
 * "Why Sahvasa": the three things that set it apart, each next to a live miniature of the real screen
 * (sample data, hidden from assistive tech). Rows alternate sides on wide screens.
 */
@Component({
  selector: 'app-landing-why',
  imports: [MatIconModule, Avatar, StatusPill, Reveal],
  template: `
    @for (r of rows; track r.id; let i = $index) {
      <article class="row" [class.flip]="i % 2 === 1" appReveal>
        <div class="text">
          <span class="num" aria-hidden="true">0{{ i + 1 }}</span>
          <p class="kicker">{{ r.kicker }}</p>
          <h3>{{ r.title }}</h3>
          <p class="body">{{ r.text }}</p>
          <ul>
            @for (point of r.points; track point) {
              <li><mat-icon aria-hidden="true">check_circle</mat-icon>{{ point }}</li>
            }
          </ul>
        </div>

        <div class="stage" aria-hidden="true">
          @switch (r.id) {
            @case ('books') {
              <div class="card">
                <div class="card-head">
                  <span>Bank reconciliation · November</span>
                  <app-status-pill tone="success">Matched</app-status-pill>
                </div>
                <div class="match">
                  <span class="side"><small>Bank</small>NEFT · 18 Nov<strong>₹12,000</strong></span>
                  <span class="link"><mat-icon>link</mat-icon></span>
                  <span class="side"><small>Books</small>Lift maintenance<strong>₹12,000</strong></span>
                </div>
                <ol class="trail">
                  @for (t of trail; track t.text) {
                    <li>
                      <mat-icon>{{ t.icon }}</mat-icon>
                      <span
                        ><strong>{{ t.who }}</strong> {{ t.text }}</span
                      >
                      <small>{{ t.at }}</small>
                    </li>
                  }
                </ol>
                <div class="card-foot"><mat-icon>lock</mat-icon>Books locked up to 30 Nov</div>
              </div>
            }
            @case ('gate') {
              <div class="card">
                <div class="card-head">
                  <span class="live"><span class="live-dot"></span>Live gate board</span>
                  <span>{{ insideCount() }} inside</span>
                </div>
                @for (v of gateRows(); track v.id) {
                  <div class="gate-row enter">
                    <app-avatar [name]="v.name" [size]="32" />
                    <span class="who"
                      ><strong>{{ v.name }}</strong
                      ><small>{{ v.meta }}</small></span
                    >
                    <app-status-pill [tone]="v.tone">{{ v.status }}</app-status-pill>
                  </div>
                }
              </div>
            }
            @case ('vote') {
              <div class="card">
                <div class="card-head">
                  <span>Resolution 4 · AGM 2026</span>
                  <app-status-pill tone="primary">Voting open</app-status-pill>
                </div>
                <p class="motion">Repaint the building exterior, ₹18.5 lakh from the sinking fund</p>
                @for (o of ballot; track o.label) {
                  <div class="bar">
                    <span class="label">{{ o.label }}</span>
                    <span class="track"><span class="fill" [class]="o.tone" [style.width.%]="o.pct"></span></span>
                    <strong>{{ o.pct }}%</strong>
                  </div>
                }
                <div class="card-foot"><mat-icon>how_to_vote</mat-icon>Secret ballot · 142 of 180 flats voted</div>
              </div>
            }
          }
        </div>
      </article>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 72px;
    }

    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      align-items: center;
      gap: 56px;

      &.flip .text {
        order: 2;
      }
    }

    .num {
      display: block;
      margin-bottom: 4px;
      color: var(--app-accent);
      font-family: var(--app-font-display);
      font-size: 2.5rem;
      font-weight: 600;
      line-height: 1;
    }

    .kicker {
      margin: 0 0 6px;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    h3 {
      margin: 0 0 12px;
      color: var(--app-heading);
      font-family: var(--app-font-display);
      font-size: clamp(1.5rem, 1.1rem + 1.4vw, 2.1rem);
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.15;
      text-wrap: balance;
    }

    .body {
      margin: 0 0 18px;
      max-width: 52ch;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-large);
      line-height: 1.6;
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font: var(--mat-sys-body-large);

      mat-icon {
        flex: none;
        color: var(--app-success);
      }
    }

    // The miniature sits on a soft teal stage, like a product shot.
    .stage {
      display: grid;
      place-items: center;
      padding: clamp(20px, 4vw, 44px);
      border-radius: 28px;
      background:
        radial-gradient(70% 90% at 100% 0%, color-mix(in srgb, var(--app-accent) 22%, transparent), transparent 70%),
        radial-gradient(80% 100% at 0% 100%, color-mix(in srgb, var(--mat-sys-primary) 26%, transparent), transparent 70%),
        var(--mat-sys-surface-container);
    }

    .card {
      width: min(100%, 440px);
      overflow: hidden;
      border: 1px solid var(--app-card-border);
      border-radius: 18px;
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: 0 24px 48px -24px rgb(8 30 28 / 0.35);
    }

    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }

    .card-foot {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
      background: var(--mat-sys-surface-container-low);
      color: var(--app-heading);
      font: var(--mat-sys-label-large);

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
    }

    // Books
    .match {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      font: var(--mat-sys-body-small);

      small {
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-label-small);
      }

      strong {
        font: var(--mat-sys-title-medium);
        font-variant-numeric: tabular-nums;
      }
    }

    .link {
      color: var(--app-success);
    }

    .trail {
      margin: 0;
      padding: 0 16px 8px;
      list-style: none;

      li {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
        font: var(--mat-sys-body-medium);

        & + li {
          border-top: 1px dashed var(--mat-sys-outline-variant);
        }

        mat-icon {
          width: 18px;
          height: 18px;
          font-size: 18px;
          color: var(--mat-sys-primary);
        }

        small {
          color: var(--mat-sys-on-surface-variant);
          font: var(--mat-sys-label-small);
          white-space: nowrap;
        }
      }
    }

    // Gate
    .live {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--app-heading);
    }

    .live-dot {
      position: relative;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--app-success);

      &::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 50%;
        background: var(--app-success);
        opacity: 0.45;
        animation: ping 1.6s ease-out infinite;
      }
    }

    .gate-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;

      & + .gate-row {
        border-top: 1px solid var(--mat-sys-surface-container-high);
      }
    }

    .who {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      font: var(--mat-sys-body-medium);

      small {
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-body-small);
      }
    }

    .enter {
      animation: row-in 500ms var(--app-ease-out) both;
    }

    @keyframes row-in {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
    }

    @keyframes ping {
      to {
        opacity: 0;
        transform: scale(2.2);
      }
    }

    // Vote
    .motion {
      margin: 0;
      padding: 14px 16px 6px;
      font: var(--mat-sys-title-small);
    }

    .bar {
      display: grid;
      grid-template-columns: 64px 1fr 40px;
      align-items: center;
      gap: 10px;
      padding: 7px 16px;
      font: var(--mat-sys-body-medium);
      font-variant-numeric: tabular-nums;

      strong {
        text-align: right;
      }
    }

    .track {
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
    }

    .fill {
      display: block;
      height: 100%;
      border-radius: inherit;

      &.for {
        background: var(--app-success);
      }

      &.against {
        background: var(--app-warning);
      }

      &.abstain {
        background: var(--mat-sys-outline);
      }
    }

    .bar:last-of-type {
      padding-bottom: 14px;
    }

    @media (max-width: 959.98px) {
      :host {
        gap: 56px;
      }

      .row {
        grid-template-columns: 1fr;
        gap: 28px;

        &.flip .text {
          order: 0;
        }
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .enter,
      .live-dot::after {
        animation: none;
      }
    }
  `,
})
export class LandingWhy {
  protected readonly rows: WhyRow[] = [
    {
      id: 'books',
      kicker: 'Accounts',
      title: 'Books your auditor will sign off.',
      text: 'Real double-entry accounts, not a spreadsheet. Maintenance posts itself, a second person approves every entry, and the bank statement is matched line by line.',
      points: [
        'Maker–checker approval on every entry',
        'Bank reconciliation and lock dates for closed periods',
        'Trial balance, I&E and balance sheet in one click',
      ],
    },
    {
      id: 'gate',
      kicker: 'Gate & security',
      title: 'A gate without the intercom.',
      text: 'The guard logs the visitor with a photo; the resident approves on their phone in seconds. Domestic help check in with their own code.',
      points: [
        'Approve or turn away visitors from anywhere',
        'Maids, cooks and drivers verified by the committee',
        'Visitor parking with overstay alerts',
      ],
    },
    {
      id: 'vote',
      kicker: 'Meetings',
      title: 'AGMs members can vote in from home.',
      text: 'Send the notice, track RSVPs and quorum, and let every flat vote by secret ballot. The minutes and the resolutions register follow on their own.',
      points: [
        'One secret vote per flat',
        'Quorum and attendance worked out for you',
        'Minutes approved by someone other than the drafter',
      ],
    },
  ];

  protected readonly trail = [
    { icon: 'add_circle', who: 'Treasurer', text: 'recorded ₹12,000 for lift maintenance', at: '18 Nov' },
    { icon: 'task_alt', who: 'Secretary', text: 'approved the entry', at: '18 Nov' },
    { icon: 'sync_alt', who: 'Treasurer', text: 'matched it to the bank', at: '2 Dec' },
  ];

  protected readonly ballot = [
    { label: 'For', pct: 68, tone: 'for' },
    { label: 'Against', pct: 22, tone: 'against' },
    { label: 'Abstain', pct: 10, tone: 'abstain' },
  ];

  /** Visitors who walk up to the gate in turn on the live board. */
  private readonly arrivals = [
    { name: 'Sanjay Patil', meta: 'Courier · B-101' },
    { name: 'Lakshmi Nair', meta: 'Guest · A-603' },
    { name: 'Imran Shaikh', meta: 'Electrician · C-204' },
    { name: 'Priya Desai', meta: 'Tutor · B-502' },
    { name: 'Ravi Kumar', meta: 'Delivery · A-101' },
    { name: 'Meera Iyer', meta: 'Guest · B-204' },
  ];
  private nextId = 4;
  private nextArrival = 0;

  protected readonly gateRows = signal<GateRow[]>([
    { id: 3, name: 'Anil Shah', meta: 'Plumber · C-302', status: 'Waiting', tone: 'warning' },
    { id: 2, name: 'Meera Iyer', meta: 'Guest · B-204', status: 'Approved', tone: 'success' },
    { id: 1, name: 'Ravi Kumar', meta: 'Delivery · A-101', status: 'Inside', tone: 'primary' },
    { id: 0, name: 'Farah Khan', meta: 'Cab · A-404', status: 'Inside', tone: 'primary' },
  ]);
  protected readonly insideCount = computed(
    () => 12 + this.gateRows().filter((r) => r.status === 'Inside').length,
  );

  constructor() {
    // Every beat the board moves on: waiting → approved → inside, and the next visitor arrives.
    liveTicker(1800, () => {
      this.gateRows.update((rows) => {
        const moved = rows.map((r): GateRow =>
          r.status === 'Waiting'
            ? { ...r, status: 'Approved', tone: 'success' }
            : r.status === 'Approved'
              ? { ...r, status: 'Inside', tone: 'primary' }
              : r,
        );
        const a = this.arrivals[this.nextArrival++ % this.arrivals.length];
        const fresh: GateRow = { id: this.nextId++, ...a, status: 'Waiting', tone: 'warning' };
        return [fresh, ...moved].slice(0, 4);
      });
    });
  }
}

/**
 * Public home page for signed-out visitors, built to convert: the outcome and one action first, the
 * pain it removes, three differentiators, everything included at a glance, pricing, objections, and the
 * action again (sticky on phones).
 */
@Component({
  selector: 'app-landing',
  imports: [
    RouterLink,
    NgTemplateOutlet,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    LandingHeroCards,
    LandingWhy,
    Logo,
    Reveal,
  ],
  templateUrl: './landing.html',
  styleUrls: ['./landing.scss', './landing-sections.scss'],
})
export class Landing {
  private readonly document = inject(DOCUMENT);

  /** "Register your society" shows only while self-signup is open. */
  protected readonly registerOpen = toSignal(
    inject(OnboardingApi)
      .selfSignupEnabled()
      .pipe(catchError(() => of(false))),
    { initialValue: false },
  );

  private readonly subscriptionApi = inject(SubscriptionApi);

  /** The plans on offer; the pricing section and its nav link show once there is one. */
  private readonly offered = toSignal(
    this.subscriptionApi.publicPlans().pipe(catchError(() => of([] as Plan[]))),
    { initialValue: [] as Plan[] },
  );
  /** Prices a month or a year. */
  protected readonly cycle = signal<PricingCycle>('MONTHLY');
  protected readonly plans = computed(() => this.offered().map((p) => pricingCard(p, this.cycle())));

  /** "How many flats?": what each plan costs for that many, and the one recommended. */
  protected readonly flats = signal<number | null>(null);
  private readonly recommendation = toSignal(
    toObservable(this.flats).pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((flats) =>
        flats == null
          ? of(null)
          : this.subscriptionApi.quote(flats).pipe(catchError(() => of(null as PlanRecommendation | null))),
      ),
    ),
    { initialValue: null as PlanRecommendation | null },
  );
  /** Each card's quote, by plan id (empty until a flat count is typed). */
  protected readonly quotes = computed(() => {
    const r = this.recommendation();
    const byPlan = new Map<number, CardQuote>();
    if (r && r.flats === this.flats()) {
      r.quotes.forEach((q) => byPlan.set(q.plan.id, cardQuote(q, this.cycle())));
    }
    return byPlan;
  });
  /** A plan is recommended for the flats entered, so it (not the featured one) gets the filled button. */
  protected readonly anyRecommended = computed(() =>
    [...this.quotes().values()].some((q) => q.recommended),
  );

  protected setFlats(value: string): void {
    const n = Math.floor(Number(value));
    this.flats.set(value.trim() !== '' && Number.isFinite(n) && n >= 1 && n <= 100_000 ? n : null);
  }

  protected readonly config = LANDING;
  protected readonly year = new Date().getFullYear();
  protected readonly demoLink = LANDING.contactEmail
    ? `mailto:${LANDING.contactEmail}?subject=${encodeURIComponent('Demo request')}`
    : null;

  /** A plan that costs nothing is on offer: the page can honestly say "Start free". */
  protected readonly hasFreePlan = computed(() =>
    this.offered().some((p) => p.priceMonthly === 0 && p.priceYearly === 0),
  );

  /**
   * The one main action, the same everywhere on the page: sign up while self-signup is open, else ask
   * for a demo, else log in.
   */
  protected readonly cta = computed(() => {
    if (this.registerOpen()) {
      return { label: this.hasFreePlan() ? 'Start free' : 'Register your society', link: '/register-society', href: null };
    }
    if (this.demoLink) return { label: 'Request a demo', link: null, href: this.demoLink };
    return { label: 'Log in', link: '/login', href: null };
  });

  /** Real social proof only; the section stays hidden until something is filled in. */
  protected readonly proof = LANDING.proof;
  protected readonly showProof = !!LANDING.proof.quote || LANDING.proof.figures.length > 0;

  protected readonly navLinks = [
    { id: 'why', label: 'Why Sahvasa' },
    { id: 'included', label: 'What’s included' },
    { id: 'faq', label: 'FAQ' },
  ];

  /** The everyday pain the committee knows, and what replaces it. */
  protected readonly beforeAfter = [
    {
      icon: 'campaign',
      before: 'Notices lost in WhatsApp groups',
      after: 'One notice board every flat sees, with push alerts',
    },
    {
      icon: 'receipt_long',
      before: 'Dues tracked in Excel and chased by phone',
      after: 'Bills for every flat, paid online, with reminders sent for you',
    },
    {
      icon: 'door_front',
      before: 'Intercom calls and a paper register at the gate',
      after: 'Visitors approved from the resident’s phone, logged with a photo',
    },
  ];

  /** Every module, names only: the detail lives in the app. */
  protected readonly included = [
    { icon: 'door_front', name: 'Visitor gate' },
    { icon: 'cleaning_services', name: 'Staff & domestic help' },
    { icon: 'campaign', name: 'Notices' },
    { icon: 'report_problem', name: 'Complaints' },
    { icon: 'receipt_long', name: 'Maintenance billing' },
    { icon: 'bolt', name: 'Online payments' },
    { icon: 'account_balance', name: 'Double-entry accounts' },
    { icon: 'sync_alt', name: 'Bank reconciliation' },
    { icon: 'insights', name: 'Reports & graphs' },
    { icon: 'gavel', name: 'Rules & policies' },
    { icon: 'how_to_vote', name: 'Meetings & e-voting' },
    { icon: 'local_parking', name: 'Parking' },
    { icon: 'admin_panel_settings', name: 'Roles & permissions' },
    { icon: 'auto_fix_high', name: 'Guided setup & invitations' },
  ];

  /** The objections a committee raises before signing up. */
  protected readonly faqs = [
    {
      q: 'Do residents need to install an app?',
      a: 'No. Sahvasa runs in the browser on any phone or computer. Residents who allow notifications get visitor and approval alerts.',
    },
    {
      q: 'What does the Free plan include?',
      a: 'The gate, visitors, staff and domestic help, notices, complaints and your residents, for good. Billing, accounts, meetings and parking come with the paid plans; upgrade whenever you are ready.',
    },
    {
      q: 'Does online payment money go to the society?',
      a: 'Yes. Payments are collected by the gateway and transferred to the society’s own bank account; each one is recorded against the flat and in the books.',
    },
    {
      q: 'Can a resident see other flats’ dues?',
      a: 'No. Residents see only their own flat’s bills and payments. What each person can see and do is set by their role.',
    },
    {
      q: 'Can we start in the middle of the financial year?',
      a: 'Yes. Enter opening balances for each flat’s dues and for the books, and continue from there.',
    },
  ];

  /** In-page links without touching the router's URL. */
  protected scrollTo(id: string, event: Event): void {
    event.preventDefault();
    this.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Footer facts: only what the product does today. */
  protected readonly footerFacts = [
    { icon: 'verified_user', label: 'Role-based access' },
    { icon: 'fact_check', label: 'Maker–checker approvals' },
    { icon: 'history', label: 'Complete audit trail' },
    { icon: 'receipt', label: 'GST invoices' },
  ];

  /** The contact number as a tel: link (spaces dropped). */
  protected readonly phoneLink = LANDING.contactPhone ? 'tel:' + LANDING.contactPhone.replace(/\s+/g, '') : null;

  /** Back to top: scroll up and move keyboard focus to the start of the page. */
  protected toTop(): void {
    this.document.defaultView?.scrollTo({ top: 0, behavior: 'smooth' });
    this.document.getElementById('main')?.focus({ preventScroll: true });
  }

  /** Skip link: move keyboard focus to the page content, past the header. */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.document.getElementById('main')?.focus();
  }
}
