/**
 * Building-view pieces for the Structure page: floor grouping, the floor × flat grid and the flat
 * detail panel. Add further structure UI here rather than in new files.
 */
import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { HasPermission } from '../../core/auth/has-permission.directive';
import { Complaint, Flat, ResidentType, Visitor, Wing } from '../../core/models';
import { sortBy } from '../../shared/sort';
import { Avatar } from '../../shared/ui';
import { ComplaintRow } from '../complaints/complaint-ui';
import { VisitorRow } from '../visitors/visitor-ui';

/** What the grid colours each flat by. */
export type Overlay = 'residents' | 'complaints' | 'visitors';

export const OVERLAYS: Record<Overlay, { label: string; icon: string; noun: [string, string] }> = {
  residents: { label: 'Residents', icon: 'group', noun: ['resident', 'residents'] },
  complaints: { label: 'Complaints', icon: 'report', noun: ['open complaint', 'open complaints'] },
  visitors: { label: 'At the gate', icon: 'badge', noun: ['visitor waiting', 'visitors waiting'] },
};

export interface Resident {
  userId: number;
  name: string;
  isActive: boolean;
  residentType: ResidentType | null;
}

/** Everything known about one flat, for the tile and the detail panel. */
export interface FlatInfo {
  residents: Resident[];
  complaints: Complaint[];
  visitors: Visitor[];
}

export const EMPTY_INFO: FlatInfo = { residents: [], complaints: [], visitors: [] };

/**
 * The floor a flat number implies, or null when it doesn't follow the usual scheme.
 * "101" / "A-101" → 1, "1204" → 12, "G1" / "G-02" → 0 (ground), "7" / "Shop" → null.
 */
export function floorOf(flatNumber: string): number | null {
  const value = flatNumber.trim().toUpperCase();
  if (/^G(F|R)?[\s-]*\d*$/.test(value)) return 0;
  const digits = /(\d+)\s*$/.exec(value)?.[1];
  if (!digits || digits.length < 3) return null;
  return parseInt(digits.slice(0, -2), 10);
}

export function floorLabel(floor: number | null): string {
  if (floor === null) return 'Other';
  return floor === 0 ? 'G' : String(floor);
}

export interface FloorRow {
  floor: number | null;
  flats: Flat[];
}

/** Top floor first, like looking at the building; flats that don't parse go in a last row. */
export function groupByFloor(flats: readonly Flat[]): FloorRow[] {
  const rows = new Map<number | null, Flat[]>();
  for (const flat of flats) {
    const floor = floorOf(flat.flatNumber);
    rows.set(floor, [...(rows.get(floor) ?? []), flat]);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b - a))
    .map(([floor, list]) => ({ floor, flats: sortBy(list, (f) => f.flatNumber) }));
}

/** 0 (none) to 4 (busiest): drives the tile's heat colour. */
export function heatLevel(count: number, overlay: Overlay): number {
  if (count <= 0) return 0;
  // Residents are naturally several per flat; issues are notable from the first one.
  const steps = overlay === 'residents' ? [1, 3, 5] : [1, 2, 4];
  return 1 + steps.filter((s) => count > s).length;
}

export function countFor(info: FlatInfo, overlay: Overlay): number {
  return overlay === 'residents'
    ? info.residents.filter((r) => r.isActive).length
    : info[overlay].length;
}

/** The floor × flat grid of one wing. Emits the flat the user picks. */
@Component({
  selector: 'app-building-grid',
  imports: [MatTooltipModule],
  template: `
    <div class="building" [attr.data-overlay]="overlay()" role="grid" [attr.aria-label]="label()">
      <div class="roof" aria-hidden="true"></div>
      @for (row of rows(); track row.floor) {
        <div class="floor" role="row">
          @if (showFloors()) {
            <span class="floor-label" role="rowheader" [attr.aria-label]="floorName(row.floor)">
              {{ floorLabel(row.floor) }}
            </span>
          }
          <div class="units">
            @for (flat of row.flats; track flat.id) {
              @let count = countOf(flat);
              <button
                type="button"
                role="gridcell"
                class="unit"
                [class.selected]="flat.id === selectedId()"
                [attr.data-heat]="overlay() ? heat(count) : null"
                [attr.aria-pressed]="flat.id === selectedId()"
                [attr.aria-label]="tileLabel(flat, count)"
                [matTooltip]="tileLabel(flat, count)"
                matTooltipShowDelay="400"
                (click)="pick.emit(flat)"
              >
                <span class="unit-number">{{ flat.flatNumber }}</span>
                @if (overlay() && count > 0) {
                  <span class="unit-count">{{ count }}</span>
                }
              </button>
            }
          </div>
        </div>
      }
      <div class="ground" aria-hidden="true"></div>
    </div>

    @if (overlay(); as o) {
      <div class="legend" aria-hidden="true">
        <span>None</span>
        @for (level of [0, 1, 2, 3, 4]; track level) {
          <span class="swatch" [attr.data-heat]="level"></span>
        }
        <span>More {{ nouns[o][1] }}</span>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      --heat: var(--mat-sys-primary);
    }
    /* The heat colour follows the overlay, for both the tiles and the legend. */
    :host([data-overlay='complaints']) {
      --heat: var(--mat-sys-error);
    }
    :host([data-overlay='visitors']) {
      --heat: var(--app-warning);
    }
    .building {
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
    }
    .roof {
      height: 6px;
      margin: 0 12px 4px;
      border-radius: 6px 6px 0 0;
      background: var(--mat-sys-surface-container-highest);
    }
    .ground {
      height: 4px;
      margin-top: 4px;
      border-radius: 4px;
      background: linear-gradient(
        90deg,
        transparent,
        var(--mat-sys-outline-variant) 12%,
        var(--mat-sys-outline-variant) 88%,
        transparent
      );
    }
    .floor {
      display: flex;
      align-items: stretch;
      gap: 10px;
    }
    .floor-label {
      display: grid;
      place-items: center;
      flex: none;
      width: 32px;
      color: var(--mat-sys-on-surface-variant);
      font-family: var(--app-font-display);
      font-size: 0.95rem;
      font-variant-numeric: lining-nums tabular-nums;
    }
    .units {
      display: grid;
      flex: 1;
      grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
      gap: 6px;
    }
    .unit {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 52px;
      padding: 6px 4px;
      border: 1px solid var(--app-card-border);
      border-radius: 10px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition:
        background-color 160ms ease,
        box-shadow 160ms ease,
        transform 160ms ease;
    }
    .unit:hover {
      transform: translateY(-1px);
      box-shadow: var(--app-card-shadow-hover);
    }
    .unit:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }
    .unit.selected {
      box-shadow:
        0 0 0 2px var(--mat-sys-surface-container-lowest),
        0 0 0 4px var(--mat-sys-primary);
    }
    .unit-count {
      margin-top: 2px;
      font: var(--mat-sys-label-small);
      opacity: 0.85;
    }
    [data-heat='0'] {
      background: var(--mat-sys-surface-container);
    }
    [data-heat='1'] {
      background: color-mix(in srgb, var(--heat) 16%, var(--mat-sys-surface-container-lowest));
    }
    [data-heat='2'] {
      background: color-mix(in srgb, var(--heat) 34%, var(--mat-sys-surface-container-lowest));
    }
    [data-heat='3'] {
      background: color-mix(in srgb, var(--heat) 58%, var(--mat-sys-surface-container-lowest));
    }
    [data-heat='4'] {
      background: color-mix(in srgb, var(--heat) 82%, var(--mat-sys-surface-container-lowest));
    }
    .unit[data-heat='3'],
    .unit[data-heat='4'] {
      color: light-dark(#fff, var(--mat-sys-surface));
      border-color: transparent;
    }
    .legend {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      margin-top: 14px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .legend span:first-child {
      margin-right: 4px;
    }
    .legend span:last-child {
      margin-left: 4px;
    }
    .swatch {
      width: 16px;
      height: 16px;
      border-radius: 4px;
      border: 1px solid var(--app-card-border);
    }
    @media (prefers-reduced-motion: reduce) {
      .unit {
        transition: none;
      }
      .unit:hover {
        transform: none;
      }
    }
    @media (max-width: 599.98px) {
      .units {
        grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
      }
      .floor-label {
        width: 24px;
      }
    }
  `,
  host: { '[attr.data-overlay]': 'overlay()' },
})
export class BuildingGrid {
  readonly flats = input.required<readonly Flat[]>();
  readonly info = input.required<ReadonlyMap<number, FlatInfo>>();
  readonly overlay = input<Overlay | null>(null);
  readonly selectedId = input<number | null>(null);
  readonly label = input('Flats');
  readonly pick = output<Flat>();

  protected readonly nouns = Object.fromEntries(
    Object.entries(OVERLAYS).map(([k, v]) => [k, v.noun]),
  ) as Record<Overlay, [string, string]>;
  protected readonly floorLabel = floorLabel;

  protected readonly rows = computed(() => groupByFloor(this.flats()));
  /** Skip floor labels when nothing parses (villas, shops): it's then a plain grid. */
  protected readonly showFloors = computed(() => this.rows().some((r) => r.floor !== null));

  protected countOf(flat: Flat): number {
    const overlay = this.overlay();
    return overlay ? countFor(this.info().get(flat.id) ?? EMPTY_INFO, overlay) : 0;
  }

  protected heat(count: number): number {
    return heatLevel(count, this.overlay()!);
  }

  protected floorName(floor: number | null): string {
    if (floor === null) return 'Other flats';
    return floor === 0 ? 'Ground floor' : `Floor ${floor}`;
  }

  protected tileLabel(flat: Flat, count: number): string {
    const overlay = this.overlay();
    if (!overlay) return `Flat ${flat.flatNumber}`;
    const [one, many] = OVERLAYS[overlay].noun;
    return `Flat ${flat.flatNumber}: ${count || 'no'} ${count === 1 ? one : many}`;
  }
}

const RESIDENT_TYPE: Record<ResidentType, string> = {
  OWNER: 'Owner',
  FAMILY: 'Family',
  TENANT: 'Tenant',
};

/** Who lives in a flat and what's going on there, with the flat's edit actions. */
@Component({
  selector: 'app-flat-panel',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    HasPermission,
    Avatar,
    ComplaintRow,
    VisitorRow,
  ],
  template: `
    <header>
      <div>
        <p class="eyebrow">{{ wing().name }} · {{ floorText() }}</p>
        <h2>Flat {{ flat().flatNumber }}</h2>
      </div>
      <span class="header-actions">
        <button
          mat-icon-button
          *hasPermission="'FLAT.STRUCTURE.UPDATE'"
          (click)="rename.emit()"
          matTooltip="Rename flat"
          aria-label="Rename flat"
        >
          <mat-icon>edit</mat-icon>
        </button>
        <button
          mat-icon-button
          *hasPermission="'FLAT.STRUCTURE.DELETE'"
          (click)="remove.emit()"
          matTooltip="Delete flat"
          aria-label="Delete flat"
        >
          <mat-icon>delete</mat-icon>
        </button>
        <button mat-icon-button (click)="closed.emit()" aria-label="Close flat details">
          <mat-icon>close</mat-icon>
        </button>
      </span>
    </header>

    @if (show().includes('residents')) {
      <section>
        <h3>
          Residents <span class="count">{{ residents().length }}</span>
        </h3>
        @for (r of residents(); track r.userId) {
          <a class="resident" [routerLink]="['/users', r.userId]" [class.inactive]="!r.isActive">
            <app-avatar [name]="r.name" [size]="32" />
            <span class="resident-name">{{ r.name }}</span>
            <span class="resident-type">
              {{ r.isActive ? (r.residentType ? residentType[r.residentType] : '') : 'Inactive' }}
            </span>
          </a>
        } @empty {
          <p class="quiet">Nobody is registered here yet.</p>
        }
      </section>
    }

    @if (show().includes('complaints')) {
      <section>
        <h3>
          Open complaints <span class="count">{{ info().complaints.length }}</span>
        </h3>
        @for (c of info().complaints; track c.id) {
          <a class="row-link" [routerLink]="['/complaints', c.id]">
            <app-complaint-row [complaint]="c" compact />
          </a>
        } @empty {
          <p class="quiet">Nothing open.</p>
        }
      </section>
    }

    @if (show().includes('visitors')) {
      <section>
        <h3>
          Waiting at the gate <span class="count">{{ info().visitors.length }}</span>
        </h3>
        @for (v of info().visitors; track v.id) {
          <a class="row-link" routerLink="/visitors" [queryParams]="{ status: 'PENDING' }">
            <app-visitor-row [visitor]="v" compact />
          </a>
        } @empty {
          <p class="quiet">Nobody is waiting.</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      padding: 18px 8px 8px 20px;
    }
    .eyebrow {
      margin: 0 0 2px;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-medium);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    h2 {
      margin: 0;
      font: var(--mat-sys-headline-small);
      font-weight: 500;
    }
    .header-actions {
      display: flex;
      flex: none;
    }
    section {
      padding: 8px 0 4px;
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 8px 20px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-title-small);
    }
    .count {
      padding: 0 7px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-small);
      line-height: 18px;
    }
    .resident {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 20px;
      color: inherit;
      text-decoration: none;
    }
    .resident-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font: var(--mat-sys-body-large);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .resident-type {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .resident.inactive {
      opacity: 0.55;
    }
    .resident:hover,
    .resident:focus-visible,
    .row-link:hover,
    .row-link:focus-visible {
      background: var(--mat-sys-surface-container-low);
    }
    .row-link {
      display: block;
      color: inherit;
      text-decoration: none;
    }
    .quiet {
      margin: 0;
      padding: 4px 20px 12px;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class FlatPanel {
  readonly wing = input.required<Wing>();
  readonly flat = input.required<Flat>();
  readonly info = input.required<FlatInfo>();
  /** Which sections the viewer may see. */
  readonly show = input.required<readonly Overlay[]>();
  readonly rename = output<void>();
  readonly remove = output<void>();
  readonly closed = output<void>();

  protected readonly residentType = RESIDENT_TYPE;
  protected readonly floorText = computed(() => {
    const floor = floorOf(this.flat().flatNumber);
    if (floor === null) return 'Unnumbered floor';
    return floor === 0 ? 'Ground floor' : `Floor ${floor}`;
  });
  /** Active first, then by name. */
  protected readonly residents = computed(() =>
    sortBy(this.info().residents, (r) => `${r.isActive ? 0 : 1}${r.name}`),
  );
}
