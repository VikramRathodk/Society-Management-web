/**
 * Small presentational building blocks shared across pages. Add new ones here rather than in
 * separate files; they only use theme tokens (--mat-sys-*, --app-*), so light and dark both work.
 */
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Params, RouterLink } from '@angular/router';

/** Colour intent for pills and cards. */
export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

/** Centered icon + message for empty lists; project actions (e.g. an "Add" button) as content. */
@Component({
  selector: 'app-empty-state',
  imports: [MatIconModule],
  template: `
    <span class="icon"
      ><mat-icon>{{ icon() }}</mat-icon></span
    >
    <p>{{ message() }}</p>
    <ng-content />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 48px 16px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .icon {
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--mat-sys-surface-container-high);
    }
    p {
      margin: 0;
    }
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly message = input.required<string>();
}

/** Default icon per tone, so a status never relies on colour alone (paid ✓, pending ◷, overdue !). */
const TONE_ICON: Record<Tone, string | null> = {
  success: 'check_circle',
  warning: 'schedule',
  danger: 'error',
  primary: 'timelapse',
  neutral: null,
};

/**
 * Compact coloured label, e.g. a visitor's status. Filled pills get an icon from their tone; pass
 * `icon` to pick another, or `icon="none"` to drop it. Outline pills (tags) have no icon by default.
 */
@Component({
  selector: 'app-status-pill',
  // The icon is drawn by CSS (::before), so the pill's text content stays just the label.
  template: `@if (iconName(); as name) {
      <span class="material-icons pill-icon" aria-hidden="true" [attr.data-icon]="name"></span>
    }
    <ng-content />`,
  host: { '[attr.data-tone]': 'tone()', '[class.outline]': 'outline()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 22px;
      box-sizing: border-box;
      padding: 1px 10px;
      border-radius: 11px;
      font: var(--mat-sys-label-medium);
      font-weight: 600;
      white-space: nowrap;
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
    }
    :host([data-tone='primary']) {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    :host([data-tone='success']) {
      background: var(--app-success-container);
      color: var(--app-success);
    }
    :host([data-tone='warning']) {
      background: var(--app-warning-container);
      color: var(--app-warning);
    }
    :host([data-tone='danger']) {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    :host(.outline) {
      background: transparent;
      box-shadow: inset 0 0 0 1px var(--mat-sys-outline-variant);
    }
    .pill-icon {
      width: 14px;
      height: 14px;
      margin-left: -3px;
      overflow: hidden;
      font-size: 14px;
      font-variation-settings:
        'FILL' 1,
        'wght' 500,
        'opsz' 20;
    }
    .pill-icon::before {
      content: attr(data-icon);
    }
  `,
})
export class StatusPill {
  readonly tone = input<Tone>('neutral');
  readonly outline = input(false, { transform: booleanAttribute });
  /** Material Symbol name; `none` for no icon. Defaults to the tone's icon. */
  readonly icon = input<string | null>(null);

  protected readonly iconName = computed(() => {
    const icon = this.icon();
    if (icon === 'none') return null;
    return icon ?? (this.outline() ? null : TONE_ICON[this.tone()]);
  });
}

/**
 * The Sahvasa mark: two arches (doorways sharing one space) with a resident between them, on the brand-teal
 * tile. It fills its container and takes the container's corner radius, so drop it inside an existing
 * `.brand-mark` box: <span class="brand-mark"><app-logo /></span>. Brand colours are fixed, not theme roles.
 */
@Component({
  selector: 'app-logo',
  template: `
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g fill="none" stroke-width="6.4" stroke-linecap="round">
        <path stroke="#ffffff" d="M23.6 68.4V44.35a15.95 15.95 0 0 1 31.9 0V68.4" />
        <path stroke="#f59e0b" d="M44.3 68.4V44.35a16 16 0 0 1 32 0V68.4" />
      </g>
      <circle cx="49.6" cy="60.2" r="3.4" fill="#ffffff" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border-radius: inherit;
      background: #0f766e;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class Logo {}

/** True when it's fine to animate: a real browser, a visible tab, and no reduced-motion setting. */
export function motionAllowed(): boolean {
  return (
    typeof matchMedia === 'function' &&
    typeof requestAnimationFrame === 'function' &&
    document.visibilityState === 'visible' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** A value holding exactly one number, e.g. "₹1,86,000", "-₹250.50" or "12 flats differ". */
const SINGLE_NUMBER = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(\D*)$/;

/**
 * Shows a formatted value and counts its number up from the previous one when it changes
 * ("₹0" → "₹1,86,000"). Values with no number or several ("31 Oct 2026") just appear.
 */
@Component({
  selector: 'app-count-up',
  template: `{{ text() }}`,
})
export class CountUp {
  readonly value = input.required<string>();
  protected readonly text = signal('');

  constructor() {
    let frame = 0;
    let last = 0;
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(frame));

    effect(() => {
      const value = this.value();
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      const m = SINGLE_NUMBER.exec(value);
      if (!m) {
        this.text.set(value);
        return;
      }
      const [, prefix, digits, suffix] = m;
      const target = Number(digits.replace(/,/g, ''));
      const from = last;
      last = target;
      if (from === target || !motionAllowed()) {
        this.text.set(value);
        return;
      }
      const decimals = digits.split('.')[1]?.length ?? 0;
      const grouped = digits.includes(',');
      const fmt = (n: number) =>
        grouped
          ? n.toLocaleString('en-IN', {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            })
          : n.toFixed(decimals);
      const duration = 750;
      const start = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 4);
        // End on the exact original string so formatting always matches the caller's.
        this.text.set(p < 1 ? prefix + fmt(from + (target - from) * eased) + suffix : value);
        if (p < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
  }
}

/**
 * Fades and lifts an element in the first time it scrolls into view. Optional stagger in ms:
 *   <article appReveal>…</article>   <li [appReveal]="i * 60">…</li>
 * Content is visible by default; it only hides once JS knows it can animate it back in.
 */
@Directive({ selector: '[appReveal]' })
export class Reveal {
  readonly delay = input(0, { alias: 'appReveal', transform: numberAttribute });

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let observer: IntersectionObserver | undefined;
    inject(DestroyRef).onDestroy(() => observer?.disconnect());

    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined' || !motionAllowed()) return;
      el.style.setProperty('--reveal-delay', `${this.delay() || 0}ms`);
      el.classList.add('reveal', 'reveal-pending');
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            el.classList.remove('reveal-pending');
            observer?.disconnect();
          }
        },
        { rootMargin: '0px 0px -8% 0px' },
      );
      observer.observe(el);
    });
  }
}

/** A number with a label and icon, linking to the page behind it. */
@Component({
  selector: 'app-stat-card',
  imports: [RouterLink, MatIconModule, CountUp],
  template: `
    <a
      class="stat"
      [routerLink]="link()"
      [queryParams]="queryParams()"
      [attr.data-tone]="tone()"
      [attr.aria-label]="label() + ': ' + (value() ?? 'loading')"
    >
      <span class="stat-icon"
        ><mat-icon>{{ icon() }}</mat-icon></span
      >
      @if (value(); as v) {
        <span class="stat-value"><app-count-up [value]="v" /></span>
      } @else if (value() === '') {
        <span class="stat-value"></span>
      } @else {
        <span class="stat-value"><span class="sk-bar" style="width: 2.2em"></span></span>
      }
      <span class="stat-label">{{ label() }}</span>
    </a>
  `,
  styles: `
    .stat {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      column-gap: 14px;
      align-items: center;
      height: 100%;
      box-sizing: border-box;
      padding: 16px 18px;
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      color: inherit;
      text-decoration: none;
      transition:
        box-shadow 180ms ease,
        transform 180ms ease;
    }
    a.stat[href]:hover,
    a.stat[href]:focus-visible {
      box-shadow: var(--app-card-shadow-hover);
      transform: translateY(-2px);
    }
    @media (prefers-reduced-motion: reduce) {
      .stat {
        transition: none;
      }
      a.stat[href]:hover,
      a.stat[href]:focus-visible {
        transform: none;
      }
    }
    .stat-icon {
      grid-row: span 2;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    .stat-value {
      font: var(--mat-sys-headline-medium);
      font-weight: 500;
      line-height: 1.1;
      letter-spacing: -0.02em;
      font-variant-numeric: lining-nums tabular-nums;
    }
    .stat-label {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    [data-tone='primary'] .stat-icon {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    [data-tone='success'] .stat-icon {
      background: var(--app-success-container);
      color: var(--app-success);
    }
    [data-tone='warning'] .stat-icon {
      background: var(--app-warning-container);
      color: var(--app-warning);
    }
    [data-tone='warning'] {
      border-color: color-mix(in srgb, var(--app-warning) 35%, transparent);
      background: color-mix(
        in srgb,
        var(--app-warning-container) 35%,
        var(--mat-sys-surface-container-lowest)
      );
    }
  `,
})
export class StatCard {
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
  /** null while loading. */
  readonly value = input<string | null>(null);
  readonly link = input<string | null>(null);
  readonly queryParams = input<Params | undefined>(undefined);
  readonly tone = input<Tone>('neutral');
}

/**
 * A titled panel. Header actions go in an element marked `sectionActions`:
 *   <app-section title="Recent visitors"><a sectionActions ...>View all</a> ...rows... </app-section>
 * Add `padded` for form-like content; leave it off for edge-to-edge lists and tables.
 */
@Component({
  selector: 'app-section',
  template: `
    @if (title()) {
      <header>
        <div>
          <h2>{{ title() }}</h2>
          @if (subtitle()) {
            <p>{{ subtitle() }}</p>
          }
        </div>
        <ng-content select="[sectionActions]" />
      </header>
    }
    <div class="body"><ng-content /></div>
  `,
  host: { '[class.padded]': 'padded()' },
  styles: `
    :host {
      display: block;
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 16px 10px 20px;
    }
    h2 {
      margin: 0;
      font-family: var(--app-font-display);
      font-size: 1.15rem;
      font-weight: 500;
      line-height: 1.4;
    }
    p {
      margin: 2px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    :host(.padded) .body {
      padding: 8px 20px 20px;
    }
    :host(.padded) header + .body {
      padding-top: 4px;
    }
  `,
})
export class Section {
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly padded = input(false, { transform: booleanAttribute });
}

/**
 * Page title row: optional back link, title and subtitle on the left, projected actions on the
 * right. Put extra inline bits next to the title (e.g. a status pill) in `[headerMeta]`.
 */
@Component({
  selector: 'app-page-header',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    @if (back()) {
      <a mat-icon-button class="back" [routerLink]="back()" [attr.aria-label]="backLabel()">
        <mat-icon>arrow_back</mat-icon>
      </a>
    }
    <div class="text">
      <div class="title-row">
        <h1>{{ title() }}</h1>
        <ng-content select="[headerMeta]" />
      </div>
      @if (subtitle()) {
        <p>{{ subtitle() }}</p>
      }
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      margin-bottom: 24px;
    }
    .back {
      margin-left: -8px;
    }
    .text {
      flex: 1;
      min-width: 0;
    }
    .title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    h1 {
      margin: 0;
      font: var(--mat-sys-headline-medium);
      font-weight: 500;
      letter-spacing: -0.02em;
    }
    p {
      margin: 4px 0 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .actions:not(:has(*)) {
      display: none;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  /** Router link for a back arrow; omit for top-level pages. */
  readonly back = input<string | null>(null);
  readonly backLabel = input('Back');
}

/** Round initials badge for a person; decorative, so hidden from screen readers. */
@Component({
  selector: 'app-avatar',
  template: `{{ initials() }}`,
  host: { 'aria-hidden': 'true', '[style.--avatar-size.px]': 'size()' },
  styles: `
    :host {
      display: grid;
      flex-shrink: 0;
      place-items: center;
      width: var(--avatar-size);
      height: var(--avatar-size);
      border-radius: 50%;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font-family: var(--mat-sys-label-large-font);
      font-size: calc(var(--avatar-size) * 0.36);
      font-weight: 600;
      line-height: 1;
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(40);

  protected readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join(''),
  );
}

export type SkeletonVariant = 'rows' | 'list' | 'form' | 'building' | 'tiles';

/**
 * Shimmering placeholder in the shape of the content that's loading, instead of a spinner.
 *   rows     – list rows only, for inside an <app-section>
 *   list     – rows in their own card (list pages)
 *   form     – two cards of fields (detail pages)
 *   building – wing tabs + floor grid (structure page); tiles – just the grid
 * The shimmer itself (`.sk-bar`) is a global class in styles.scss so other components can use it.
 */
@Component({
  selector: 'app-skeleton',
  template: `
    <span class="sk-label">Loading…</span>
    @switch (variant()) {
      @case ('form') {
        <div class="sk-cards">
          @for (card of [0, 1]; track card) {
            <div class="sk-card sk-pad">
              <span class="sk-bar sk-title" style="width: 40%"></span>
              @for (field of fieldRows(); track field) {
                <span class="sk-bar sk-field"></span>
              }
              <span class="sk-bar sk-button"></span>
            </div>
          }
        </div>
      }
      @case ('building') {
        <div class="sk-tabs">
          @for (tab of [0, 1, 2]; track tab) {
            <span class="sk-bar sk-tab"></span>
          }
        </div>
        <div class="sk-card sk-pad">
          <span class="sk-bar sk-title" style="width: 30%"></span>
          <ng-container *ngTemplateOutlet="tiles" />
        </div>
      }
      @case ('tiles') {
        <div class="sk-pad"><ng-container *ngTemplateOutlet="tiles" /></div>
      }
      @default {
        <div [class.sk-card]="variant() === 'list'">
          @for (row of rowList(); track row) {
            <div class="sk-row">
              <span class="sk-bar sk-avatar"></span>
              <span class="sk-lines">
                <span class="sk-bar" [style.width.%]="60 - (row % 3) * 12"></span>
                <span class="sk-bar sk-small" [style.width.%]="38 - (row % 2) * 10"></span>
              </span>
              <span class="sk-bar sk-pill"></span>
            </div>
          }
        </div>
      }
    }

    <ng-template #tiles>
      @for (floor of [0, 1, 2, 3]; track floor) {
        <div class="sk-floor">
          <span class="sk-bar sk-floor-label"></span>
          @for (unit of [0, 1, 2, 3]; track unit) {
            <span class="sk-bar sk-unit"></span>
          }
        </div>
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  host: { 'aria-busy': 'true', role: 'status' },
  styles: `
    :host {
      display: block;
    }
    .sk-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .sk-card {
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      overflow: hidden;
    }
    .sk-pad {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 20px;
    }
    .sk-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
      gap: 16px;
    }
    .sk-row {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 20px;
    }
    .sk-row + .sk-row {
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .sk-lines {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 8px;
    }
    .sk-avatar {
      flex: none;
      width: 36px;
      height: 36px;
      border-radius: 50%;
    }
    .sk-small {
      height: 10px;
    }
    .sk-pill {
      flex: none;
      width: 64px;
      height: 22px;
      border-radius: 11px;
    }
    .sk-title {
      height: 20px;
    }
    .sk-field {
      height: 52px;
      border-radius: 8px;
    }
    .sk-button {
      align-self: flex-end;
      width: 96px;
      height: 36px;
      border-radius: 18px;
    }
    .sk-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .sk-tab {
      width: 104px;
      height: 40px;
      border-radius: 20px;
    }
    .sk-floor {
      display: flex;
      gap: 6px;
    }
    .sk-floor-label {
      flex: none;
      width: 24px;
      height: 52px;
      margin-right: 6px;
    }
    .sk-unit {
      flex: 1;
      height: 52px;
      border-radius: 10px;
    }
  `,
})
export class Skeleton {
  readonly variant = input<SkeletonVariant>('list');
  /** Rows to draw for the list variants, or fields per card for `form`. */
  readonly count = input<number | null>(null);

  protected readonly rowList = computed(() =>
    Array.from({ length: this.count() ?? (this.variant() === 'rows' ? 3 : 6) }, (_, i) => i),
  );
  protected readonly fieldRows = computed(() =>
    Array.from({ length: this.count() ?? 3 }, (_, i) => i),
  );
}
