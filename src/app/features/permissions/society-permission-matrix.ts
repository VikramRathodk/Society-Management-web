import { Component, computed, input, output } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { PermissionCatalogEntry } from '../../core/models';
import {
  CellState,
  PermissionDraft,
  canToggle,
  cellState,
  groupCatalog,
  isOn,
  partLabel,
} from './permission-draft';

/**
 * The society's permission grid for a role, a person or a preset. Ticks show what is held after the
 * draft; added and removed boxes are marked so changes from the default stand out.
 *
 * mode 'toggle' (roles, people): a box ticks on and off against `base`; ticking needs `canGrant`.
 * mode 'preset': a box cycles none → add → remove → none (`base` is ignored).
 */
@Component({
  selector: 'app-society-permission-matrix',
  imports: [MatCheckboxModule, MatIconModule, MatTooltipModule],
  templateUrl: './society-permission-matrix.html',
  styleUrl: './society-permission-matrix.scss',
})
export class SocietyPermissionMatrix {
  readonly catalog = input.required<readonly PermissionCatalogEntry[]>();
  readonly base = input<ReadonlySet<string>>(new Set());
  readonly draft = input.required<PermissionDraft>();
  readonly readonly = input(false);
  readonly mode = input<'toggle' | 'preset'>('toggle');
  /** What the base is called in tooltips ("platform default", "from their roles"). */
  readonly baseLabel = input('default');
  readonly toggled = output<string>();

  protected readonly groups = computed(() => groupCatalog(this.catalog()));

  protected state(code: string): CellState {
    return this.mode() === 'preset'
      ? this.draft().added.has(code)
        ? 'added'
        : this.draft().removed.has(code)
          ? 'removed'
          : 'off'
      : cellState(code, this.base(), this.draft());
  }

  protected checked(code: string): boolean {
    return this.mode() === 'preset' ? this.state(code) === 'added' : isOn(this.state(code));
  }

  protected disabled(entry: PermissionCatalogEntry): boolean {
    if (this.readonly()) return true;
    return this.mode() === 'preset' ? false : !canToggle(this.state(entry.code), entry.canGrant);
  }

  protected tooltip(entry: PermissionCatalogEntry): string {
    const text = entry.description ?? entry.code;
    const note = this.note(entry);
    return note ? `${text} — ${note}` : text;
  }

  protected label = partLabel;

  private note(entry: PermissionCatalogEntry): string | null {
    const state = this.state(entry.code);
    if (this.mode() === 'preset') {
      return state === 'added' ? 'adds' : state === 'removed' ? 'removes' : null;
    }
    if (state === 'added') return `added (not in the ${this.baseLabel()})`;
    if (state === 'removed') return `removed (in the ${this.baseLabel()})`;
    if (!this.readonly() && !isOn(state) && !entry.canGrant)
      return "you don't have this permission";
    return null;
  }
}
