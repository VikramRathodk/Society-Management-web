/**
 * Small presentational building blocks shared across pages. Add new ones here rather than in
 * separate files; they only use theme tokens (--mat-sys-*, --app-*), so light and dark both work.
 */
import { Component, booleanAttribute, computed, input } from '@angular/core';
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

/** Compact coloured label, e.g. a visitor's status. */
@Component({
  selector: 'app-status-pill',
  template: `<ng-content />`,
  host: { '[attr.data-tone]': 'tone()', '[class.outline]': 'outline()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 10px;
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
  `,
})
export class StatusPill {
  readonly tone = input<Tone>('neutral');
  readonly outline = input(false, { transform: booleanAttribute });
}

/** A number with a label and icon, linking to the page behind it. */
@Component({
  selector: 'app-stat-card',
  imports: [RouterLink, MatIconModule],
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
      <span class="stat-value">{{ value() ?? '…' }}</span>
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
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      color: inherit;
      text-decoration: none;
      transition:
        border-color 120ms,
        transform 120ms;
    }
    .stat:hover,
    .stat:focus-visible {
      border-color: var(--mat-sys-outline);
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
      font-weight: 600;
      line-height: 1.1;
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
      border-color: color-mix(in srgb, var(--app-warning) 45%, transparent);
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
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px 10px 20px;
    }
    h2 {
      margin: 0;
      font: var(--mat-sys-title-medium);
      font-weight: 600;
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
      font: var(--mat-sys-headline-small);
      font-weight: 600;
      letter-spacing: -0.01em;
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
