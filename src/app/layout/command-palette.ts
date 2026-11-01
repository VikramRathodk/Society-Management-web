/**
 * Ctrl/⌘+K command palette: jump to pages, people and flats, or run quick actions, from anywhere.
 * The shell supplies the static commands (pages, actions); people and flats load here on first
 * open and are cached per society for the session.
 */
import {
  Component,
  ElementRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, shareReplay, switchMap } from 'rxjs';

import { StructureApi } from '../core/api/structure.api';
import { UserApi } from '../core/api/user.api';
import { AuthStore } from '../core/auth/auth.store';
import { SocietyContextStore } from '../core/society-context/society-context.store';
import { sortBy } from '../shared/sort';
import { Skeleton } from '../shared/ui';

export type CommandGroup = 'Recent' | 'Pages' | 'Actions' | 'People' | 'Flats';

export interface Command {
  /** Stable id, used for "recent". */
  id: string;
  group: Exclude<CommandGroup, 'Recent'>;
  label: string;
  hint?: string;
  icon: string;
  /** Extra words to match on (e.g. a phone number). */
  keywords?: string;
  run: () => void;
}

const RECENT_KEY = 'sm.palette.recent';
const RECENT_MAX = 5;
const PER_GROUP = 6;
/** People and flats are refetched after this long, so new ones show up. */
const CACHE_MS = 2 * 60_000;
const GROUP_ORDER: CommandGroup[] = ['Recent', 'Actions', 'Pages', 'People', 'Flats'];

/**
 * How well `query` matches `text`: higher is better, 0 is no match.
 * Prefix > start of a word > anywhere > letters in order ("lgv" → "Log visitor").
 */
export function matchScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - Math.min(t.length - q.length, 50) / 10;
  const at = t.indexOf(q);
  if (at > 0 && /[\s\-/·(]/.test(t[at - 1])) return 80 - at / 10;
  if (at > 0) return 60 - at / 10;
  let i = 0;
  let gaps = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    else if (i > 0) gaps++;
    if (i === q.length) return Math.max(40 - gaps, 1);
  }
  return 0;
}

/** The matching part of a label, for highlighting: [before, match, after]. */
export function splitMatch(text: string, query: string): [string, string, string] {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return [text, '', ''];
  return [text.slice(0, at), text.slice(at, at + q.length), text.slice(at + q.length)];
}

/** Loads people and flats for the palette, cached per society. */
@Injectable({ providedIn: 'root' })
export class PaletteData {
  private readonly users = inject(UserApi);
  private readonly structure = inject(StructureApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly cache = new Map<number, { at: number; commands: Observable<Command[]> }>();

  commands(societyId: number | null): Observable<Command[]> {
    if (societyId == null) return of([]);
    const cached = this.cache.get(societyId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.commands;
    const commands = forkJoin([this.people(societyId), this.flats(societyId)]).pipe(
      map(([people, flats]) => [...people, ...flats]),
      shareReplay(1),
    );
    this.cache.set(societyId, { at: Date.now(), commands });
    return commands;
  }

  /** Drop cached results, e.g. after creating a user or flat. */
  clear(): void {
    this.cache.clear();
  }

  private people(societyId: number): Observable<Command[]> {
    if (!this.auth.can('USER.ACCOUNT.VIEW', societyId)) return of([]);
    return this.users.list(societyId).pipe(
      map((users) =>
        users.map<Command>((u) => ({
          id: `user:${u.id}`,
          group: 'People',
          label: u.name,
          hint: u.isActive ? u.phone : `${u.phone} · inactive`,
          icon: 'person',
          keywords: `${u.phone} ${u.email ?? ''}`,
          run: () => this.router.navigate(['/users', u.id]),
        })),
      ),
      catchError(() => of([])),
    );
  }

  private flats(societyId: number): Observable<Command[]> {
    if (!this.auth.can('FLAT.DIRECTORY.VIEW', societyId)) return of([]);
    return this.structure.wings(societyId).pipe(
      switchMap((wings) =>
        wings.length === 0
          ? of([])
          : forkJoin(
              wings.map((wing) =>
                this.structure.flats(wing.id).pipe(
                  map((flats) =>
                    sortBy(flats, (f) => f.flatNumber).map<Command>((f) => ({
                      id: `flat:${f.id}`,
                      group: 'Flats',
                      label: `${wing.name} · ${f.flatNumber}`,
                      hint: 'Flat',
                      icon: 'door_front',
                      keywords: `${f.flatNumber} ${wing.name}${f.flatNumber}`,
                      run: () =>
                        this.router.navigate(['/structure'], {
                          queryParams: { wing: wing.id, flat: f.id },
                        }),
                    })),
                  ),
                  catchError(() => of([])),
                ),
              ),
            ).pipe(map((lists) => lists.flat())),
      ),
      catchError(() => of([])),
    );
  }
}

interface PaletteDialogData {
  commands: Command[];
}

interface Row {
  command: Command;
  group: CommandGroup;
  parts: [string, string, string];
}

@Component({
  selector: 'app-command-palette',
  imports: [MatIconModule, Skeleton],
  template: `
    <div class="search">
      <mat-icon>search</mat-icon>
      <input
        #input
        type="text"
        role="combobox"
        aria-label="Search pages, people, flats and actions"
        aria-autocomplete="list"
        aria-controls="palette-results"
        [attr.aria-expanded]="true"
        [attr.aria-activedescendant]="rows()[active()] ? 'palette-' + active() : null"
        placeholder="Search pages, people, flats…"
        autocomplete="off"
        spellcheck="false"
        [value]="query()"
        (input)="setQuery($any($event.target).value)"
        (keydown)="onKey($event)"
      />
      <kbd>esc</kbd>
    </div>

    <div class="results" id="palette-results" role="listbox" #list>
      @for (row of rows(); track row.group + row.command.id; let i = $index) {
        @if (i === 0 || rows()[i - 1].group !== row.group) {
          <div class="group" role="presentation">{{ row.group }}</div>
        }
        <div
          class="item"
          role="option"
          [id]="'palette-' + i"
          [class.active]="i === active()"
          [attr.aria-selected]="i === active()"
          (mousemove)="active.set(i)"
          (click)="run(row.command)"
        >
          <span class="item-icon"
            ><mat-icon>{{ row.command.icon }}</mat-icon></span
          >
          <span class="item-label"
            >{{ row.parts[0] }}<mark>{{ row.parts[1] }}</mark
            >{{ row.parts[2] }}</span
          >
          @if (row.command.hint) {
            <span class="item-hint">{{ row.command.hint }}</span>
          }
          <mat-icon class="item-enter" aria-hidden="true">keyboard_return</mat-icon>
        </div>
      } @empty {
        @if (!loaded() && query()) {
          <app-skeleton variant="rows" [count]="3" />
        } @else {
          <p class="none">No matches for “{{ query() }}”.</p>
        }
      }
      @if (!loaded() && rows().length) {
        <p class="loading-more">Loading people and flats…</p>
      }
    </div>

    <footer>
      <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
      <span><kbd>↵</kbd> to open</span>
      <span class="spacer"></span>
      <span
        ><kbd>{{ modKey }}</kbd
        ><kbd>K</kbd> anywhere</span
      >
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      max-height: min(560px, 76vh);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
    }
    .search {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-title-medium);
      font-weight: 400;
    }
    input::placeholder {
      color: var(--mat-sys-on-surface-variant);
      opacity: 0.8;
    }
    kbd {
      display: inline-grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      margin: 0 2px;
      padding: 0 5px;
      border: 1px solid var(--app-card-border);
      border-bottom-width: 2px;
      border-radius: 5px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
      font-family: inherit;
    }
    .results {
      flex: 1;
      overflow-y: auto;
      padding: 6px 8px 8px;
      overscroll-behavior: contain;
    }
    .group {
      padding: 12px 12px 6px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 0 12px;
      border-radius: 10px;
      cursor: pointer;
    }
    .item.active {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .item-icon {
      display: grid;
      flex: none;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);
    }
    .item.active .item-icon {
      background: color-mix(in srgb, var(--mat-sys-primary) 18%, transparent);
      color: inherit;
    }
    .item-icon mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }
    .item-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font: var(--mat-sys-body-large);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    mark {
      background: none;
      color: inherit;
      font-weight: 700;
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent);
      text-underline-offset: 3px;
    }
    .item-hint {
      flex: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .item.active .item-hint {
      color: inherit;
      opacity: 0.8;
    }
    .item-enter {
      width: 16px;
      height: 16px;
      font-size: 16px;
      opacity: 0;
    }
    .item.active .item-enter {
      opacity: 0.7;
    }
    .none,
    .loading-more {
      margin: 0;
      padding: 24px 12px;
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
    }
    .loading-more {
      padding: 10px 12px 4px;
      font: var(--mat-sys-body-small);
    }
    footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      padding: 10px 18px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .spacer {
      flex: 1;
    }
    @media (max-width: 599.98px) {
      footer {
        display: none;
      }
    }
  `,
})
export class CommandPalette {
  private readonly data = inject<PaletteDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<CommandPalette>);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  protected readonly modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  protected readonly query = signal('');
  protected readonly active = signal(0);

  private readonly dynamic = toSignal(
    inject(PaletteData).commands(inject(SocietyContextStore).selectedSocietyId()),
  );
  protected readonly loaded = computed(() => this.dynamic() !== undefined);

  private readonly all = computed(() => [...this.data.commands, ...(this.dynamic() ?? [])]);

  protected readonly rows = computed<Row[]>(() => {
    const query = this.query().trim();
    const all = this.all();
    if (!query) {
      // No query: recent first, then actions and pages (people and flats need a search).
      const byId = new Map(all.map((c) => [c.id, c]));
      const recent = readRecent()
        .map((id) => byId.get(id))
        .filter((c): c is Command => !!c);
      const recentIds = new Set(recent.map((c) => c.id));
      return [
        ...recent.map((command) => ({ command, group: 'Recent' as const })),
        ...all
          .filter((c) => (c.group === 'Actions' || c.group === 'Pages') && !recentIds.has(c.id))
          .map((command) => ({ command, group: command.group })),
      ]
        .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
        .map((r) => ({ ...r, parts: [r.command.label, '', ''] as [string, string, string] }));
    }

    const scored = all
      .map((command) => ({
        command,
        score: Math.max(
          matchScore(command.label, query),
          command.keywords ? matchScore(command.keywords, query) * 0.9 : 0,
        ),
      }))
      .filter((s) => s.score > 0);
    const rows: Row[] = [];
    for (const group of GROUP_ORDER) {
      rows.push(
        ...scored
          .filter((s) => s.command.group === group)
          .sort((a, b) => b.score - a.score)
          .slice(0, PER_GROUP)
          .map((s) => ({ command: s.command, group, parts: splitMatch(s.command.label, query) })),
      );
    }
    // Put the group holding the single best match first.
    const best = scored.sort((a, b) => b.score - a.score)[0];
    if (best) {
      const first = rows.filter((r) => r.group === best.command.group);
      return [...first, ...rows.filter((r) => r.group !== best.command.group)];
    }
    return rows;
  });

  constructor() {
    // Keep the highlighted row in view while moving with the keyboard.
    effect(() => {
      const index = this.active();
      this.list()
        .nativeElement.querySelector(`#palette-${index}`)
        ?.scrollIntoView?.({ block: 'nearest' });
    });
    queueMicrotask(() => this.input().nativeElement.focus());
  }

  protected setQuery(value: string): void {
    this.query.set(value);
    this.active.set(0);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.rows().length;
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      if (count) this.active.update((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      if (count) this.active.update((i) => (i - 1 + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = this.rows()[this.active()];
      if (row) this.run(row.command);
    }
  }

  protected run(command: Command): void {
    writeRecent(command.id);
    this.ref.close();
    command.run();
  }
}

/** Opens the palette (once at a time). */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly dialog = inject(MatDialog);
  private ref: MatDialogRef<CommandPalette> | null = null;

  get isOpen(): boolean {
    return this.ref !== null;
  }

  open(commands: Command[]): void {
    if (this.ref) return;
    this.ref = this.dialog.open<CommandPalette, PaletteDialogData>(CommandPalette, {
      data: { commands },
      width: '640px',
      maxWidth: 'calc(100vw - 32px)',
      position: { top: '12vh' },
      panelClass: 'command-palette-panel',
      backdropClass: 'command-palette-backdrop',
      autoFocus: false,
      restoreFocus: true,
      ariaLabel: 'Command palette',
    });
    this.ref.afterClosed().subscribe(() => (this.ref = null));
  }

  toggle(commands: Command[]): void {
    if (this.ref) this.ref.close();
    else this.open(commands);
  }
}

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeRecent(id: string): void {
  try {
    const next = [id, ...readRecent().filter((r) => r !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: recents just won't be remembered.
  }
}
