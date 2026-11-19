import { PermissionCatalogEntry } from '../../core/models';
import { compareNatural } from '../../shared/sort';

/**
 * Unsaved changes on top of a base set (a role's platform default, or what a person's roles give):
 * codes added beyond it and codes taken from it. A preset has an empty base and keeps both kinds.
 */
export interface PermissionDraft {
  readonly added: ReadonlySet<string>;
  readonly removed: ReadonlySet<string>;
}

/** base: from the default · added / removed: changed here · off: not held. */
export type CellState = 'base' | 'added' | 'removed' | 'off';

export const EMPTY_DRAFT: PermissionDraft = { added: new Set(), removed: new Set() };

export function draftOf(added: readonly string[], removed: readonly string[]): PermissionDraft {
  return { added: new Set(added), removed: new Set(removed) };
}

export function cellState(
  code: string,
  base: ReadonlySet<string>,
  draft: PermissionDraft,
): CellState {
  if (draft.added.has(code)) return 'added';
  if (draft.removed.has(code)) return 'removed';
  return base.has(code) ? 'base' : 'off';
}

export function isOn(state: CellState): boolean {
  return state === 'base' || state === 'added';
}

/**
 * Ticking or unticking a box. Unticking is always allowed; ticking gives the code back, which the
 * backend allows only for codes the editor holds (`canGrant`).
 */
export function canToggle(state: CellState, canGrant: boolean): boolean {
  return isOn(state) || canGrant;
}

/** Ticks or unticks against the base: a default comes back by dropping its removal, and so on. */
export function toggle(
  draft: PermissionDraft,
  base: ReadonlySet<string>,
  code: string,
): PermissionDraft {
  const added = new Set(draft.added);
  const removed = new Set(draft.removed);
  if (isOn(cellState(code, base, draft))) {
    if (added.has(code)) added.delete(code);
    else removed.add(code);
  } else if (removed.has(code)) {
    removed.delete(code);
  } else {
    added.add(code);
  }
  return { added, removed };
}

/** For presets (no base): none → add → remove → none. */
export function cycle(draft: PermissionDraft, code: string): PermissionDraft {
  const added = new Set(draft.added);
  const removed = new Set(draft.removed);
  if (added.has(code)) {
    added.delete(code);
    removed.add(code);
  } else if (removed.has(code)) {
    removed.delete(code);
  } else {
    added.add(code);
  }
  return { added, removed };
}

export function sameDraft(a: PermissionDraft, b: PermissionDraft): boolean {
  return sameSet(a.added, b.added) && sameSet(a.removed, b.removed);
}

/** The body for a save: the full set of changes, sorted. */
export function changeOf(draft: PermissionDraft): { grant: string[]; revoke: string[] } {
  return { grant: [...draft.added].sort(), revoke: [...draft.removed].sort() };
}

export interface MatrixRow {
  feature: string;
  /** One cell per action column; null where that permission doesn't exist. */
  cells: (PermissionCatalogEntry | null)[];
}

export interface MatrixGroup {
  module: string;
  actions: string[];
  rows: MatrixRow[];
}

const ACTION_ORDER = ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'APPROVE', 'REJECT'];

/** One grid per module: features × actions. */
export function groupCatalog(entries: readonly PermissionCatalogEntry[]): MatrixGroup[] {
  const byModule = new Map<string, PermissionCatalogEntry[]>();
  for (const e of entries) byModule.set(e.module, [...(byModule.get(e.module) ?? []), e]);
  return [...byModule.keys()].sort(compareNatural).map((module) => {
    const list = byModule.get(module)!;
    const actions = [...new Set(list.map((e) => e.action))].sort(compareActions);
    const features = [...new Set(list.map((e) => e.feature))].sort(compareNatural);
    return {
      module,
      actions,
      rows: features.map((feature) => ({
        feature,
        cells: actions.map(
          (a) => list.find((e) => e.feature === feature && e.action === a) ?? null,
        ),
      })),
    };
  });
}

/** "MAINTENANCE.PAYMENT.CREATE" → "Maintenance payment create". */
export function codeLabel(code: string): string {
  const text = code.split('.').join(' ').replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "SELF_APPROVE" → "Self approve". */
export function partLabel(part: string): string {
  const text = part.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function compareActions(a: string, b: string): number {
  const ia = ACTION_ORDER.indexOf(a);
  const ib = ACTION_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return compareNatural(a, b);
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
