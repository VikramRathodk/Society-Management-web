import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { Avatar, CountUp, Logo, Reveal, StatusPill, motionAllowed } from '../../shared/ui';

/**
 * Sales details. Sections that need them stay hidden until they're filled in, so the page never
 * shows made-up prices or a dead contact link.
 */
export const LANDING = {
  /** e.g. 'hello@yourdomain.in' — shows "Request a demo" in the hero and the closing section. */
  contactEmail: null as string | null,
  /** e.g. '+91 98xxx xxxxx' — shown next to the email. */
  contactPhone: null as string | null,
  /** Public plans; the pricing section appears once there is at least one. */
  plans: [] as { name: string; price: string; per: string; blurb: string; points: string[] }[],
};

/** The hero's product picture: the dashboard and gate board in miniature, with sample data. */
@Component({
  selector: 'app-landing-preview',
  imports: [MatIconModule, Avatar, StatusPill],
  template: `
    <figure class="preview" aria-label="Preview of the dashboard with sample data">
      <figcaption>Sample data</figcaption>
      <div class="p-head">
        <span class="p-date">Thursday, 12 November · Sai Sagar Residency</span>
        <span class="p-hello">Good morning, Sunita</span>
      </div>
      <div class="p-tiles">
        <div class="p-tile">
          <span class="p-label"><mat-icon aria-hidden="true">south_west</mat-icon>Income</span>
          <span class="p-value">₹1,86,000</span>
          <span class="p-delta good"
            ><mat-icon aria-hidden="true">trending_up</mat-icon>+12% vs Oct</span
          >
        </div>
        <div class="p-tile">
          <span class="p-label"><mat-icon aria-hidden="true">north_east</mat-icon>Spent</span>
          <span class="p-value">₹1,42,350</span>
          <span class="p-delta good"
            ><mat-icon aria-hidden="true">trending_down</mat-icon>−4% vs Oct</span
          >
        </div>
        <div class="p-tile">
          <span class="p-label"><mat-icon aria-hidden="true">balance</mat-icon>Surplus</span>
          <span class="p-value positive">₹43,650</span>
          <span class="p-delta">November 2026</span>
        </div>
      </div>
      <div class="p-collect">
        <span><strong>31 of 36</strong> flats paid · Nov 2026 bills</span>
        <span class="p-meter"><span style="width: 86%"></span></span>
      </div>
      <div class="p-lane">
        <div class="p-lane-head"><mat-icon aria-hidden="true">how_to_reg</mat-icon>Let in</div>
        <div class="p-row">
          <app-avatar name="Ravi Kumar" [size]="34" />
          <span class="p-who"><strong>Ravi Kumar</strong><small>Flat A-101 · Delivery</small></span>
          <app-status-pill tone="success">Approved</app-status-pill>
        </div>
        <div class="p-row">
          <app-avatar name="Meera Iyer" [size]="34" />
          <span class="p-who"><strong>Meera Iyer</strong><small>Flat B-204 · Guest</small></span>
          <app-status-pill tone="warning">Pending</app-status-pill>
        </div>
      </div>
    </figure>
  `,
  styles: `
    :host {
      display: block;
    }

    .preview {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 20px;
      border: 1px solid var(--app-card-border);
      border-radius: 24px;
      background: var(--mat-sys-surface-container-low);
      box-shadow:
        var(--app-card-shadow),
        0 30px 60px -30px light-dark(rgb(12 40 37 / 0.3), rgb(0 0 0 / 0.6));

      figcaption {
        position: absolute;
        top: -12px;
        right: 20px;
        padding: 3px 10px;
        border: 1px solid var(--app-card-border);
        border-radius: 999px;
        background: var(--mat-sys-surface-container-lowest);
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-label-small);
        letter-spacing: 0.04em;
      }
    }

    .p-head {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .p-date {
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-small);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .p-hello {
      font-family: var(--app-font-display);
      font-size: 1.4rem;
    }

    .p-tiles {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .p-tile,
    .p-collect,
    .p-lane {
      border: 1px solid var(--app-card-border);
      border-radius: 14px;
      background: var(--mat-sys-surface-container-lowest);
    }

    .p-tile {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      padding: 12px;
    }

    .p-label,
    .p-delta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }

    .p-delta.good {
      color: var(--app-success);
    }

    .p-value {
      overflow: hidden;
      font-family: var(--app-font-display);
      font-size: 1.25rem;
      font-variant-numeric: lining-nums tabular-nums;
      text-overflow: ellipsis;
      white-space: nowrap;

      &.positive {
        color: var(--app-success);
      }
    }

    .p-collect {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      font: var(--mat-sys-body-medium);
    }

    .p-meter {
      display: block;
      height: 8px;
      overflow: hidden;
      border-radius: 4px;
      background: var(--mat-sys-surface-container-high);

      span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--app-success);
        animation: meter-fill 1.1s var(--app-ease-out) 600ms both;
      }
    }

    @keyframes meter-fill {
      from {
        width: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .p-meter span {
        animation: none;
      }
    }

    .p-lane-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      font-family: var(--app-font-display);

      mat-icon {
        width: 20px;
        height: 20px;
        color: var(--app-success);
        font-size: 20px;
      }
    }

    .p-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }

    .p-who {
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

    @media (max-width: 599.98px) {
      .p-tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));

        .p-tile:last-child {
          display: none;
        }
      }
    }
  `,
})
export class LandingPreview {}

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

interface Module {
  icon: string;
  title: string;
  text: string;
  points: string[];
  /** Tile size in the bento grid: 1×1, 2 wide, or 2×2. */
  size: 'sm' | 'wide' | 'lg';
  /** A miniature of the real screen, drawn inside the tile. */
  visual?: 'gate' | 'bill' | 'match';
}

/**
 * The modules as a bento grid: big tiles carry a miniature of the real screen, small ones the
 * essentials. A call-to-action tile is projected in last: <app-landing-modules><div moduleCta>…
 */
@Component({
  selector: 'app-landing-modules',
  imports: [MatIconModule, Avatar, StatusPill, Reveal],
  template: `
    @for (m of modules; track m.title; let i = $index) {
      <article class="tile" [class]="m.size" [appReveal]="(i % 4) * 70">
        <span class="tile-icon"
          ><mat-icon aria-hidden="true">{{ m.icon }}</mat-icon></span
        >
        <h3>{{ m.title }}</h3>
        <p>{{ m.text }}</p>

        @switch (m.visual) {
          @case ('gate') {
            <div class="mini gate" aria-hidden="true">
              <div class="mini-head">
                <span class="live"><span class="live-dot"></span>Live gate board</span>
                <span>{{ insideCount() }} inside</span>
              </div>
              @for (v of gateRows(); track v.id) {
                <div class="mini-row enter">
                  <app-avatar [name]="v.name" [size]="32" />
                  <span class="mini-who"
                    ><strong>{{ v.name }}</strong
                    ><small>{{ v.meta }}</small></span
                  >
                  <app-status-pill [tone]="v.tone">{{ v.status }}</app-status-pill>
                </div>
              }
            </div>
          }
          @case ('bill') {
            <div class="mini bill" aria-hidden="true">
              <div class="bill-lines">
                <span class="bill-head">Bill · Nov 2026 · A-101</span>
                <span class="line"><span>Maintenance</span><span>₹2,500</span></span>
                <span class="line"><span>Sinking fund</span><span>₹300</span></span>
                <span class="line total"><span>Total</span><span>₹2,800</span></span>
              </div>
              <span class="qr"><mat-icon>qr_code_2</mat-icon><small>Pay by UPI</small></span>
            </div>
          }
          @case ('match') {
            <div class="mini match" aria-hidden="true">
              <span class="side"><small>Bank</small>NEFT · 18 Nov<strong>₹12,000</strong></span>
              <span class="link"><mat-icon>link</mat-icon></span>
              <span class="side"><small>Books</small>Lift maintenance<strong>₹12,000</strong></span>
              <app-status-pill tone="success">Matched</app-status-pill>
            </div>
          }
        }

        <ul>
          @for (point of m.points; track point) {
            <li>{{ point }}</li>
          }
        </ul>
      </article>
    }
    <div class="tile wide cta" [appReveal]="210"><ng-content select="[moduleCta]" /></div>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-auto-flow: dense;
      gap: 16px;
    }

    .tile {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 24px;
      border: 1px solid var(--app-card-border);
      border-radius: 24px;
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      transition:
        translate 200ms var(--app-ease-out),
        box-shadow 200ms ease,
        opacity 600ms var(--app-ease-out) var(--reveal-delay, 0ms),
        transform 600ms var(--app-ease-out) var(--reveal-delay, 0ms);

      &.reveal-pending {
        transition: none;
      }

      @media (hover: hover) {
        &:hover {
          translate: 0 -3px;
          box-shadow: var(--app-card-shadow-hover);
        }
      }

      > p {
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.5;
      }
    }

    .wide {
      grid-column: span 2;
    }

    .lg {
      grid-column: span 2;
      grid-row: span 2;
    }

    h3 {
      margin: 0;
      color: var(--app-heading);
      font-family: var(--app-font-display);
      font-size: 1.1rem;
      font-weight: 500;
    }

    p {
      margin: 0;
    }

    .tile-icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      margin-bottom: 6px;
      border-radius: 12px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: 7px;
      margin: auto 0 0;
      padding: 14px 0 0;
      list-style: none;
    }

    li {
      position: relative;
      padding-left: 16px;
      font: var(--mat-sys-body-medium);
      line-height: 1.45;

      &::before {
        content: '';
        position: absolute;
        top: 0.55em;
        left: 0;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--app-accent);
      }
    }

    // ---- Miniatures ----

    .mini {
      margin-top: 10px;
      border: 1px solid var(--app-card-border);
      border-radius: 16px;
      background: var(--mat-sys-surface-container-low);
    }

    // The big tile's board fills the tile, so there's no gap above its points.
    .gate {
      flex: 1;
      overflow: hidden;
    }

    .mini-head {
      display: flex;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }

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

    .mini-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;

      & + .mini-row {
        border-top: 1px solid var(--mat-sys-surface-container-high);
      }
    }

    .mini-who {
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

    .bill {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 14px 16px;
    }

    .bill-lines {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 6px;
      font: var(--mat-sys-body-medium);
      font-variant-numeric: tabular-nums;
    }

    .bill-head {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }

    .line {
      display: flex;
      justify-content: space-between;

      &.total {
        padding-top: 6px;
        border-top: 1px dashed var(--mat-sys-outline-variant);
        font-weight: 600;
      }
    }

    .qr {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 8px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-lowest);
      color: var(--app-heading);

      mat-icon {
        width: 56px;
        height: 56px;
        font-size: 56px;
      }

      small {
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-label-small);
      }
    }

    .match {
      display: grid;
      grid-template-columns: 1fr auto 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
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
        font: var(--mat-sys-title-small);
        font-variant-numeric: tabular-nums;
      }
    }

    .link {
      color: var(--app-success);
    }

    // ---- Call-to-action tile ----

    .cta {
      justify-content: center;
      border-color: transparent;
      background:
        radial-gradient(
          60% 100% at 100% 100%,
          color-mix(in srgb, var(--app-accent) 28%, transparent),
          transparent 70%
        ),
        #0b4f4a;
      color: #fff;
    }

    // ---- Responsive ----

    @media (max-width: 1099.98px) {
      :host {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .lg {
        grid-row: span 1;
      }
    }

    @media (max-width: 599.98px) {
      :host {
        grid-template-columns: 1fr;
      }

      .wide,
      .lg {
        grid-column: auto;
      }

      .match {
        grid-template-columns: 1fr auto 1fr;

        app-status-pill {
          grid-column: 1 / -1;
          justify-self: start;
        }
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .tile {
        transition: none;
      }

      .tile:hover {
        translate: none;
      }

      .enter,
      .live-dot::after {
        animation: none;
      }
    }
  `,
})
export class LandingModules {
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
        return [fresh, ...moved].slice(0, 5);
      });
    });
  }

  protected readonly modules: Module[] = [
    {
      icon: 'door_front',
      title: 'Gate & visitors',
      text: 'Visitors logged at the gate and approved from the flat — no intercom calls.',
      size: 'lg',
      visual: 'gate',
      points: [
        'Visitor entry with a photo at the gate',
        'Approve or reject from the resident’s phone, with push alerts',
        'Live gate board: expected, waiting and inside',
      ],
    },
    {
      icon: 'receipt_long',
      title: 'Maintenance billing',
      text: 'Bills for every flat, every billing cycle, with a UPI QR on each one.',
      size: 'wide',
      visual: 'bill',
      points: ['Charge heads and society-wide cycles', 'Fixed or interest-based late fees'],
    },
    {
      icon: 'payments',
      title: 'Collections',
      text: 'Every payment against the right flat.',
      size: 'sm',
      points: ['Cash, UPI, cheque, bank transfer', 'Receipts, advances and refunds'],
    },
    {
      icon: 'account_balance',
      title: 'Accounting',
      text: 'Double-entry books built for societies.',
      size: 'sm',
      points: ['Maker–checker approvals', 'Lock dates for closed periods'],
    },
    {
      icon: 'sync_alt',
      title: 'Bank reconciliation',
      text: 'Import the bank statement and match every line to the books.',
      size: 'wide',
      visual: 'match',
      points: ['CSV import with column mapping', 'Reconciliation statement, completed or reopened'],
    },
    {
      icon: 'query_stats',
      title: 'Reports & audit',
      text: 'Statements your auditor can work from.',
      size: 'sm',
      points: ['Trial balance, I&E, R&P, balance sheet', 'Audit log of every change'],
    },
    {
      icon: 'campaign',
      title: 'Helpdesk & notices',
      text: 'Complaints tracked, notices delivered.',
      size: 'sm',
      points: ['Complaints with a full timeline', 'A notice board for every flat'],
    },
    {
      icon: 'admin_panel_settings',
      title: 'Members & access',
      text: 'The right people, with the right permissions.',
      size: 'wide',
      points: [
        'Built-in and custom roles with a permission matrix',
        'Invite by link, QR code or WhatsApp; several societies, one login',
      ],
    },
  ];
}

/** An endless, slow strip of what Sahvasa covers; pauses on hover, still under reduced motion. */
@Component({
  selector: 'app-landing-marquee',
  imports: [MatIconModule],
  template: `
    <div class="track">
      @for (copy of [0, 1]; track copy) {
        <ul [attr.aria-hidden]="copy === 1 ? 'true' : null">
          @for (item of items; track item.label) {
            <li>
              <mat-icon aria-hidden="true">{{ item.icon }}</mat-icon
              >{{ item.label }}
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      overflow: hidden;
      padding-block: 18px;
      border-block: 1px solid var(--app-card-border);
      background: var(--mat-sys-surface-container-lowest);
      mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
    }

    .track {
      display: flex;
      width: max-content;
      animation: scroll 60s linear infinite;
    }

    :host(:hover) .track {
      animation-play-state: paused;
    }

    ul {
      display: flex;
      gap: 40px;
      margin: 0;
      padding: 0 20px;
      list-style: none;
    }

    li {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--app-heading);
      font: var(--mat-sys-title-small);
      white-space: nowrap;
    }

    mat-icon {
      color: var(--app-accent);
    }

    @keyframes scroll {
      to {
        transform: translateX(-50%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .track {
        flex-wrap: wrap;
        width: auto;
        animation: none;
      }

      ul[aria-hidden] {
        display: none;
      }
    }
  `,
})
export class LandingMarquee {
  protected readonly items = [
    { icon: 'apartment', label: 'Apartment complexes' },
    { icon: 'door_front', label: 'Visitor approvals' },
    { icon: 'handshake', label: 'Co-operative housing societies' },
    { icon: 'qr_code_2', label: 'UPI QR on every bill' },
    { icon: 'fence', label: 'Gated communities' },
    { icon: 'account_balance', label: 'Double-entry books' },
    { icon: 'location_city', label: 'Townships' },
    { icon: 'sync_alt', label: 'Bank reconciliation' },
    { icon: 'fact_check', label: 'Maker–checker approvals' },
    { icon: 'campaign', label: 'Notices & complaints' },
    { icon: 'notifications_active', label: 'Push notifications' },
  ];
}

/** A phone body; the screen is projected in. */
@Component({
  selector: 'app-landing-phone',
  template: `<div class="screen"><span class="island"></span><ng-content /></div>`,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host {
      display: block;
      width: 270px;
      padding: 10px;
      border-radius: 44px;
      background: #121816;
      box-shadow:
        inset 0 0 0 2px #2a3330,
        0 40px 80px -30px rgb(4 30 28 / 0.55);
    }

    .screen {
      position: relative;
      display: flex;
      flex-direction: column;
      aspect-ratio: 9 / 19;
      overflow: hidden;
      border-radius: 34px;
      background: var(--mat-sys-surface-container-low);
    }

    .island {
      position: absolute;
      top: 10px;
      left: 50%;
      z-index: 2;
      width: 84px;
      height: 24px;
      border-radius: 12px;
      background: #121816;
      transform: translateX(-50%);
    }
  `,
})
export class LandingPhone {}

/**
 * The dashboard in a browser window, tilted in 3D, with a phone in front showing what a resident
 * gets at the same moment: a push asking them to let a visitor in.
 */
@Component({
  selector: 'app-landing-device',
  imports: [MatIconModule, LandingPreview, LandingPhone],
  template: `
    <div class="browser">
      <div class="bar" aria-hidden="true">
        <i></i><i></i><i></i><span>Sahvasa · Dashboard</span>
      </div>
      <app-landing-preview />
    </div>
    <app-landing-phone class="phone">
      <div class="lock">
        <span class="time">10:24</span>
        <span class="date">Thursday, 12 November</span>
        <div class="push">
          <span class="app"><span class="app-icon"></span>Sahvasa · now</span>
          <strong>Meera Iyer is at the gate</strong>
          <span>Guest for B-204. Let her in?</span>
          <span class="push-actions"><b>Approve</b><b>Reject</b></span>
        </div>
        <div class="push older">
          <span class="app"><span class="app-icon"></span>Sahvasa · 2h ago</span>
          <strong>November bill: ₹2,800</strong>
          <span>Due 10 Dec · pay with the UPI QR</span>
        </div>
      </div>
    </app-landing-phone>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      padding: 0 0 48px;
      perspective: 1800px;
    }

    .browser {
      overflow: hidden;
      border: 1px solid var(--app-card-border);
      border-radius: 18px;
      background: var(--mat-sys-surface-container-lowest);
      box-shadow:
        0 2px 4px rgb(12 40 37 / 0.06),
        0 40px 80px -30px rgb(12 40 37 / 0.35);
      transform: rotateY(-9deg) rotateX(4deg);
      transform-origin: left center;
      transition: transform 700ms var(--app-ease-out);

      ::ng-deep .preview {
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }

      ::ng-deep figcaption {
        top: 12px;
      }
    }

    :host(:hover) .browser {
      transform: rotateY(-3deg) rotateX(1deg);
    }

    .bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--app-card-border);
      background: var(--mat-sys-surface-container);

      i {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--mat-sys-outline-variant);
      }

      span {
        margin: 0 auto;
        padding: 3px 14px;
        border-radius: 8px;
        background: var(--mat-sys-surface-container-lowest);
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-label-small);
      }
    }

    .phone {
      position: absolute;
      right: -24px;
      bottom: -40px;
      width: 220px;
      animation: rise 1s var(--app-ease-out) both;
    }

    .lock {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 52px 10px 12px;
      background:
        radial-gradient(70% 50% at 80% 100%, rgb(245 158 11 / 0.35), transparent 70%),
        linear-gradient(170deg, #0f766e, #0b4f4a);
      color: #fff;
    }

    .time {
      font-family: var(--app-font-display);
      font-size: 2.6rem;
      line-height: 1;
    }

    .date {
      margin-bottom: 14px;
      opacity: 0.85;
      font: var(--mat-sys-label-medium);
    }

    .push {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 16px;
      background: rgb(255 255 255 / 0.9);
      color: #1b1f1e;
      font: var(--mat-sys-body-small);
      animation: rise 700ms var(--app-ease-out) 900ms both;

      strong {
        font: var(--mat-sys-label-large);
      }

      &.older {
        opacity: 0.8;
        animation-delay: 1.2s;
      }
    }

    .app {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #4f5654;
      font: var(--mat-sys-label-small);
    }

    .app-icon {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      background: #0f766e;
    }

    .push-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;

      b {
        flex: 1;
        padding: 5px 0;
        border-radius: 8px;
        background: #e9ecea;
        text-align: center;
        font: var(--mat-sys-label-medium);

        &:first-child {
          background: #f59e0b;
          color: #2b1a00;
        }
      }
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(24px);
      }
    }

    @media (max-width: 959.98px) {
      .browser {
        transform: none;
      }

      .phone {
        right: 8px;
        width: 170px;
      }
    }

    @media (max-width: 599.98px) {
      .phone {
        display: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .browser,
      :host(:hover) .browser {
        transform: none;
        transition: none;
      }

      .phone,
      .push {
        animation: none;
      }
    }
  `,
})
export class LandingDevice {}

interface RoleView {
  key: 'committee' | 'guard' | 'resident';
  icon: string;
  title: string;
  text: string;
  points: string[];
}

/**
 * "Who it's for" as a guided tour: pick a role on the left, and the phone on the right shows that
 * person's screen. Advances on its own until someone picks a role.
 */
@Component({
  selector: 'app-landing-roles',
  imports: [MatIconModule, Avatar, StatusPill, LandingPhone],
  template: `
    <div class="tabs" role="tablist" aria-label="Roles">
      @for (r of roles; track r.key; let i = $index) {
        <button
          type="button"
          role="tab"
          class="tab"
          [class.active]="i === active()"
          [attr.aria-selected]="i === active()"
          (click)="pick(i)"
        >
          <span class="tab-icon"
            ><mat-icon aria-hidden="true">{{ r.icon }}</mat-icon></span
          >
          <span class="tab-text">
            <strong>{{ r.title }}</strong>
            <span>{{ r.text }}</span>
            @if (i === active()) {
              <ul>
                @for (p of r.points; track p) {
                  <li><mat-icon aria-hidden="true">check_circle</mat-icon>{{ p }}</li>
                }
              </ul>
            }
          </span>
          @if (i === active() && !paused()) {
            <span class="progress"></span>
          }
        </button>
      }
    </div>

    <div class="stage">
      <app-landing-phone>
        @switch (roles[active()].key) {
          @case ('committee') {
            <div class="app-screen enter">
              <header><small>Sai Sagar Residency</small><strong>Approvals</strong></header>
              @for (a of approvals; track a.title) {
                <div class="card">
                  <span class="row"
                    ><strong>{{ a.title }}</strong
                    ><b>{{ a.amount }}</b></span
                  >
                  <small>Recorded by {{ a.by }}</small>
                  <span class="row actions"><em class="yes">Approve</em><em>Reject</em></span>
                </div>
              }
              <div class="card">
                <small>November collections</small>
                <span class="row"><strong>₹1,04,160</strong><small>of ₹1,21,000</small></span>
                <span class="meter"><span></span></span>
              </div>
              <span class="tabbar">
                <span><mat-icon>space_dashboard</mat-icon>Home</span>
                <span class="on"><mat-icon>fact_check</mat-icon>Approvals</span>
                <span><mat-icon>receipt_long</mat-icon>Dues</span>
                <span><mat-icon>menu_book</mat-icon>Books</span>
              </span>
            </div>
          }
          @case ('guard') {
            <div class="app-screen enter">
              <header><small>Main gate</small><strong>Gate board</strong></header>
              <span class="big-action"><mat-icon>person_add</mat-icon>Log a visitor</span>
              @for (v of gate; track v.name) {
                <div class="card visitor">
                  <app-avatar [name]="v.name" [size]="30" />
                  <span class="col"
                    ><strong>{{ v.name }}</strong
                    ><small>{{ v.meta }}</small></span
                  >
                  <app-status-pill [tone]="v.tone">{{ v.status }}</app-status-pill>
                </div>
              }
              <span class="tabbar">
                <span class="on"><mat-icon>door_front</mat-icon>Gate</span>
                <span><mat-icon>groups</mat-icon>Inside</span>
                <span><mat-icon>search</mat-icon>Search</span>
                <span><mat-icon>person</mat-icon>Profile</span>
              </span>
            </div>
          }
          @case ('resident') {
            <div class="app-screen enter">
              <header><small>Flat B-204</small><strong>Hello, Meera</strong></header>
              <div class="card due">
                <small>November maintenance</small>
                <span class="amount">₹2,800</span>
                <small>Due 10 Dec 2026</small>
                <span class="qr"><mat-icon>qr_code_2</mat-icon>Pay by UPI</span>
              </div>
              <div class="card">
                <span class="row"><strong>Ravi Kumar · Delivery</strong></span>
                <small>Waiting at the gate</small>
                <span class="row actions"><em class="yes">Let in</em><em>Deny</em></span>
              </div>
              <div class="card notice">
                <small>Notice · 2 days ago</small>
                <strong>Water supply paused Sunday, 10 am – 2 pm</strong>
              </div>
              <span class="tabbar">
                <span class="on"><mat-icon>home</mat-icon>Home</span>
                <span><mat-icon>receipt_long</mat-icon>Dues</span>
                <span><mat-icon>door_front</mat-icon>Visitors</span>
                <span><mat-icon>person</mat-icon>Profile</span>
              </span>
            </div>
          }
        }
      </app-landing-phone>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 64px;
    }

    .tabs {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .tab {
      position: relative;
      display: flex;
      gap: 16px;
      overflow: hidden;
      padding: 20px 22px;
      border: 1px solid transparent;
      border-radius: 20px;
      background: transparent;
      color: inherit;
      text-align: left;
      font: inherit;
      cursor: pointer;
      transition:
        background 200ms ease,
        border-color 200ms ease,
        box-shadow 200ms ease;

      &:hover {
        background: var(--mat-sys-surface-container);
      }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }

      &.active {
        border-color: var(--app-card-border);
        background: var(--mat-sys-surface-container-lowest);
        box-shadow: var(--app-card-shadow-hover);
      }
    }

    .tab-icon {
      display: grid;
      flex: none;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }

    .active .tab-icon {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    .tab-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      line-height: 1.5;

      strong {
        color: var(--app-heading);
        font-family: var(--app-font-display);
        font-size: 1.1rem;
        font-weight: 500;
      }
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
      animation: fade 400ms ease both;
    }

    li {
      display: flex;
      gap: 8px;
      color: var(--mat-sys-on-surface);

      mat-icon {
        width: 18px;
        height: 18px;
        color: var(--mat-sys-primary);
        font-size: 18px;
      }
    }

    .progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 3px;
      width: 100%;
      background: var(--app-accent);
      transform-origin: left;
      animation: progress 6s linear both;
    }

    .stage {
      position: relative;
      display: grid;
      place-items: center;
      padding: 24px 40px;

      &::before {
        content: '';
        position: absolute;
        inset: 10% 0;
        z-index: -1;
        border-radius: 50%;
        background: radial-gradient(
          circle,
          color-mix(in srgb, var(--mat-sys-primary) 22%, transparent),
          transparent 70%
        );
        filter: blur(20px);
      }
    }

    .app-screen {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 10px;
      padding: 48px 12px 12px;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-small);

      header {
        display: flex;
        flex-direction: column;
        margin-bottom: 4px;

        small {
          color: var(--mat-sys-primary);
          font: var(--mat-sys-label-small);
        }

        strong {
          color: var(--app-heading);
          font-family: var(--app-font-display);
          font-size: 1.3rem;
          font-weight: 500;
        }
      }

      small {
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 10px 12px;
      border: 1px solid var(--app-card-border);
      border-radius: 14px;
      background: var(--mat-sys-surface-container-lowest);

      &.visitor {
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .col {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }

    .actions {
      margin-top: 6px;

      em {
        flex: 1;
        padding: 5px 0;
        border-radius: 8px;
        background: var(--mat-sys-surface-container-high);
        text-align: center;
        font: var(--mat-sys-label-medium);
        font-style: normal;

        &.yes {
          background: var(--mat-sys-primary);
          color: var(--mat-sys-on-primary);
        }
      }
    }

    // The app's bottom navigation, pinned to the foot of the screen.
    .tabbar {
      display: flex;
      justify-content: space-around;
      margin: auto -12px -12px;
      padding: 8px 4px 14px;
      border-top: 1px solid var(--app-card-border);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);

      > span {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }

      .on {
        color: var(--mat-sys-primary);
      }

      mat-icon {
        width: 20px;
        height: 20px;
        font-size: 20px;
      }
    }

    .meter {
      display: block;
      height: 6px;
      margin-top: 4px;
      overflow: hidden;
      border-radius: 3px;
      background: var(--mat-sys-surface-container-high);

      span {
        display: block;
        width: 86%;
        height: 100%;
        background: var(--app-success);
      }
    }

    .notice {
      border-left: 3px solid var(--app-accent);
    }

    .big-action {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px;
      border-radius: 14px;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      font: var(--mat-sys-title-small);
    }

    .due {
      align-items: flex-start;

      .amount {
        color: var(--app-heading);
        font-family: var(--app-font-display);
        font-size: 1.8rem;
        line-height: 1.1;
      }
    }

    .qr {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      padding: 6px 12px;
      border-radius: 10px;
      background: var(--app-accent);
      color: var(--app-on-accent);
      font: var(--mat-sys-label-large);
    }

    .enter {
      animation: fade 450ms var(--app-ease-out) both;
    }

    @keyframes fade {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }

    @keyframes progress {
      from {
        transform: scaleX(0);
      }
    }

    @media (max-width: 959.98px) {
      :host {
        grid-template-columns: 1fr;
        gap: 32px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      ul,
      .enter,
      .progress {
        animation: none;
      }
    }
  `,
})
export class LandingRoles {
  protected readonly roles: RoleView[] = [
    {
      key: 'committee',
      icon: 'groups',
      title: 'Managing committee',
      text: 'Chairman, secretary and treasurer see the society’s money and operations in one place.',
      points: [
        'Approvals queue for entries and payments',
        'Dues by flat and collection progress',
        'Financial statements and the audit log',
      ],
    },
    {
      key: 'guard',
      icon: 'shield_person',
      title: 'Security & facility staff',
      text: 'A gate board designed for a phone at the gate — fast, clear and live.',
      points: [
        'Log a visitor in seconds, with a photo',
        'See who is approved, waiting or inside',
        'Large one-tap actions and quick search',
      ],
    },
    {
      key: 'resident',
      icon: 'home',
      title: 'Residents & owners',
      text: 'Everything about their flat, without chasing the society office.',
      points: [
        'Bills, payments and paying by UPI',
        'Let visitors in from anywhere',
        'Raise complaints and read notices',
      ],
    },
  ];

  protected readonly approvals = [
    { title: 'Lift maintenance', amount: '₹12,000', by: 'Treasurer' },
    { title: 'Garden upkeep', amount: '₹4,500', by: 'Secretary' },
  ];

  protected readonly gate = [
    { name: 'Meera Iyer', meta: 'Guest · B-204', status: 'Waiting', tone: 'warning' as const },
    { name: 'Ravi Kumar', meta: 'Delivery · A-101', status: 'Approved', tone: 'success' as const },
    { name: 'Anil Shah', meta: 'Plumber · C-302', status: 'Inside', tone: 'primary' as const },
    { name: 'Priya Desai', meta: 'Tutor · B-502', status: 'Inside', tone: 'primary' as const },
    { name: 'Sanjay Patil', meta: 'Courier · B-101', status: 'Approved', tone: 'success' as const },
  ];

  protected readonly active = signal(0);
  /** Set once someone picks a role; the tour stops advancing. */
  protected readonly paused = signal(!motionAllowed());

  constructor() {
    liveTicker(6000, () => {
      if (!this.paused()) this.active.update((i) => (i + 1) % this.roles.length);
    });
  }

  protected pick(i: number): void {
    this.paused.set(true);
    this.active.set(i);
  }
}
/** Public home page for signed-out visitors: what the app does, for whom, and how to start. */
@Component({
  selector: 'app-landing',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    LandingDevice,
    LandingMarquee,
    LandingRoles,
    LandingHeroCards,
    LandingModules,
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

  protected readonly config = LANDING;
  protected readonly year = new Date().getFullYear();
  protected readonly demoLink = LANDING.contactEmail
    ? `mailto:${LANDING.contactEmail}?subject=${encodeURIComponent('Demo request')}`
    : null;

  protected readonly navLinks = [
    { id: 'modules', label: 'Modules' },
    { id: 'roles', label: 'Who it’s for' },
    { id: 'governance', label: 'Governance' },
    { id: 'how', label: 'Getting started' },
    { id: 'faq', label: 'FAQ' },
  ];

  protected readonly governance = [
    'Maker–checker approval on income, expenses, transfers and journals',
    'Audit log of every change to accounts, entries and settings',
    'Lock dates so closed periods can’t be edited',
    'Bank reconciliation that ties the books to the bank',
  ];

  protected readonly steps = [
    {
      title: 'Register your society',
      text: 'Share a few details about your society. Once it’s approved, your committee gets access.',
    },
    {
      title: 'Guided setup',
      text: 'Generate wings and flats from floors in one step, import residents from a spreadsheet and set your key rules.',
    },
    {
      title: 'Invite your people',
      text: 'Committee, residents and staff join by link, QR code or WhatsApp — each with the right role.',
    },
    {
      title: 'Run the month',
      text: 'Issue the billing cycle, record collections and expenses; the dashboard and the books keep up.',
    },
  ];

  protected readonly faqs = [
    {
      q: 'Do residents need to install an app?',
      a: 'No. Sahvasa runs in the browser on any phone or computer. Residents who allow notifications get visitor and approval alerts.',
    },
    {
      q: 'Can a resident see other flats’ dues?',
      a: 'No. Residents see only their own flat’s bills and payments. What each person can see and do is set by their role.',
    },
    {
      q: 'Who can change the financial records?',
      a: 'Only the roles you allow. Entries wait for a second person’s approval before they post, every change is in the audit log, and a lock date stops edits to closed periods.',
    },
    {
      q: 'Can we start in the middle of the financial year?',
      a: 'Yes. Enter opening balances for each flat’s dues and for the books, and continue from there.',
    },
    {
      q: 'How do residents pay their maintenance?',
      a: 'With the UPI QR code on their bill, or by cash, cheque or bank transfer recorded by the treasurer against their flat.',
    },
    {
      q: 'We manage more than one society. Is that supported?',
      a: 'Yes. Anyone with roles in several societies switches between them from the top bar, with one login.',
    },
  ];

  /** In-page links without touching the router's URL. */
  protected scrollTo(id: string, event: Event): void {
    event.preventDefault();
    this.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
