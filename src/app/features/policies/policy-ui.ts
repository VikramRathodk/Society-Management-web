import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, forkJoin, of } from 'rxjs';

import { PolicyApi } from '../../core/api/policy.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Policy, PolicyCategory, PolicyVersion, PolicyVersionStatus } from '../../core/models';
import { Skeleton, Tone } from '../../shared/ui';

// ---- Labels ----

export const VERSION_STATUS: Record<PolicyVersionStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING: { label: 'Awaiting approval', tone: 'warning' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  SUPERSEDED: { label: 'Replaced', tone: 'neutral' },
};

/** "1.2 MB" / "340 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Today as yyyy-MM-dd in the browser's time zone (the society's, in practice). */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Opens a version's attachment in a new tab. */
export function openAttachment(api: PolicyApi, versionId: number): void {
  api.attachment(versionId).subscribe((blob) => {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

// ---- Text ----

/**
 * Policy text is plain text with a little Markdown: `#`/`##` headings, `-`/`*` bullets, `1.`
 * numbered items, blank lines between paragraphs. Parsed into blocks rendered by the template, never
 * as HTML, so nothing a writer types can run.
 */
export type RulesBlock =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] }
  | { kind: 'paragraph'; text: string };

export function parseRules(text: string): RulesBlock[] {
  const blocks: RulesBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const pushItem = (kind: 'bullets' | 'numbered', item: string) => {
    const last = blocks[blocks.length - 1];
    if (last?.kind === kind) last.items.push(item);
    else blocks.push({ kind, items: [item] });
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      flush();
    } else if ((m = /^(#{1,3})\s+(.*)$/.exec(line.trim()))) {
      flush();
      blocks.push({ kind: 'heading', level: m[1].length === 1 ? 1 : 2, text: m[2] });
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      flush();
      pushItem('bullets', m[1]);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flush();
      pushItem('numbered', m[1]);
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Line-by-line changes from `before` to `after` (longest common subsequence). */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i++] });
    } else {
      out.push({ kind: 'added', text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] });
  while (j < b.length) out.push({ kind: 'added', text: b[j++] });
  return out;
}

/** A policy's text, rendered from the simple Markdown above. */
@Component({
  selector: 'app-rules-text',
  template: `
    @for (block of blocks(); track $index) {
      @switch (block.kind) {
        @case ('heading') {
          @if (block.level === 1) {
            <h3>{{ block.text }}</h3>
          } @else {
            <h4>{{ block.text }}</h4>
          }
        }
        @case ('bullets') {
          <ul>
            @for (item of block.items; track $index) {
              <li>{{ item }}</li>
            }
          </ul>
        }
        @case ('numbered') {
          <ol>
            @for (item of block.items; track $index) {
              <li>{{ item }}</li>
            }
          </ol>
        }
        @default {
          <p>{{ block.text }}</p>
        }
      }
    } @empty {
      <p class="empty">No text yet.</p>
    }
  `,
  styles: `
    :host {
      display: block;
      font: var(--mat-sys-body-large);
      overflow-wrap: anywhere;
    }
    h3,
    h4 {
      margin: 20px 0 8px;
      font-family: var(--app-heading-font, inherit);
    }
    h3 {
      font-size: 1.2rem;
    }
    h4 {
      font-size: 1.05rem;
    }
    :host > :first-child {
      margin-top: 0;
    }
    p {
      margin: 0 0 12px;
      white-space: pre-line;
    }
    ul,
    ol {
      margin: 0 0 12px;
      padding-left: 24px;
    }
    li {
      margin-bottom: 4px;
    }
    .empty {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }
  `,
})
export class RulesText {
  readonly text = input.required<string>();
  protected readonly blocks = computed(() => parseRules(this.text()));
}

// ---- Send back ----

@Component({
  selector: 'app-send-back-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Send back to the author</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="lead">{{ data.title }}, version {{ data.number }}. Say what should change.</p>
        <mat-form-field appearance="outline">
          <mat-label>Reason</mat-label>
          <textarea
            matInput
            formControlName="reason"
            rows="4"
            maxlength="500"
            cdkFocusInitial
          ></textarea>
          <mat-hint align="end">{{ form.controls.reason.value.length }} / 500</mat-hint>
          @if (form.controls.reason.invalid) {
            <mat-error>Say why it is sent back</mat-error>
          }
        </mat-form-field>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Send back</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .lead {
      margin: 0 0 16px;
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class SendBackDialog {
  protected readonly data = inject<{ versionId: number; title: string; number: number }>(
    MAT_DIALOG_DATA,
  );
  private readonly api = inject(PolicyApi);
  private readonly ref = inject(MatDialogRef<SendBackDialog, Policy>);
  protected readonly form = inject(NonNullableFormBuilder).group({
    reason: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)]],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.api.sendBack(this.data.versionId, this.form.controls.reason.value.trim()).subscribe({
      next: (policy) => this.ref.close(policy),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}

/** Emits the policy once sent back, or undefined if cancelled. */
export function sendBackDialog(
  dialog: MatDialog,
  data: { versionId: number; title: string; number: number },
): Observable<Policy | undefined> {
  return dialog.open(SendBackDialog, { data, width: '520px' }).afterClosed();
}

// ---- One version, with what changed ----

interface VersionDialogData {
  policyId: number;
  title: string;
  number: number;
  /** The draft being reviewed, when it isn't published (published versions are fetched). */
  version?: PolicyVersion;
  /** The version to compare with; omit for none. */
  compareWith?: number | null;
}

@Component({
  selector: 'app-version-dialog',
  imports: [
    DatePipe,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatIconModule,
    RulesText,
    Skeleton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }} · version {{ data.number }}</h2>
    <mat-dialog-content>
      @if (loading()) {
        <app-skeleton variant="form" />
      } @else if (version(); as v) {
        <p class="meta">
          @if (v.effectiveFrom) {
            In force from {{ v.effectiveFrom | date: 'd MMM y' }}
          } @else {
            Takes effect the day it is published
          }
          @if (v.changeSummary) {
            · {{ v.changeSummary }}
          }
        </p>
        @if (previous()) {
          <mat-button-toggle-group
            [value]="mode()"
            (change)="mode.set($event.value)"
            aria-label="Show"
            hideSingleSelectionIndicator
          >
            <mat-button-toggle value="text">Text</mat-button-toggle>
            <mat-button-toggle value="changes">
              Changes from version {{ data.compareWith }}
            </mat-button-toggle>
          </mat-button-toggle-group>
        }
        @if (mode() === 'changes' && previous()) {
          <div class="diff" role="list" aria-label="Changes">
            @for (line of diff(); track $index) {
              <div class="line" role="listitem" [attr.data-kind]="line.kind">
                <span class="mark" aria-hidden="true">{{
                  line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '
                }}</span>
                <span class="sr-only">{{
                  line.kind === 'added' ? 'Added: ' : line.kind === 'removed' ? 'Removed: ' : ''
                }}</span>
                {{ line.text || ' ' }}
              </div>
            }
          </div>
        } @else {
          <app-rules-text [text]="v.body" />
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .meta {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    mat-button-toggle-group {
      margin-bottom: 16px;
    }
    .diff {
      font: var(--mat-sys-body-medium);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      overflow: hidden;
    }
    .line {
      display: flex;
      gap: 8px;
      padding: 2px 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      &[data-kind='added'] {
        background: color-mix(in srgb, var(--app-success) 16%, transparent);
      }
      &[data-kind='removed'] {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
        text-decoration: line-through;
      }
    }
    .mark {
      width: 1ch;
      flex-shrink: 0;
      text-decoration: none;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `,
})
export class VersionDialog {
  protected readonly data = inject<VersionDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(PolicyApi);

  protected readonly version = signal<PolicyVersion | null>(null);
  protected readonly previous = signal<PolicyVersion | null>(null);
  protected readonly loading = signal(true);
  protected readonly mode = signal<'text' | 'changes'>(this.data.compareWith ? 'changes' : 'text');
  protected readonly diff = computed(() =>
    lineDiff(this.previous()?.body ?? '', this.version()?.body ?? ''),
  );

  constructor() {
    const { policyId, number, version, compareWith } = this.data;
    forkJoin([
      version ? of(version) : this.api.version(policyId, number),
      compareWith ? this.api.version(policyId, compareWith) : of(null),
    ]).subscribe({
      next: ([v, prev]) => {
        this.version.set(v);
        this.previous.set(prev);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}

export function versionDialog(dialog: MatDialog, data: VersionDialogData): void {
  dialog.open(VersionDialog, { data, width: '720px', maxHeight: '90vh' });
}

// ---- Categories ----

/** Rename, reorder, hide and add the rules page's categories (secretary and above). */
@Component({
  selector: 'app-policy-categories-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>Categories</h2>
    <mat-dialog-content>
      <p class="lead">
        Headings on the rules page. A hidden category keeps its policies but isn't offered for new
        ones.
      </p>
      <ul class="rows">
        @for (c of categories(); track c.id; let first = $first; let last = $last) {
          <li [class.hidden]="c.hidden">
            @if (editing() === c.id) {
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="name">
                <mat-label>Name</mat-label>
                <input
                  matInput
                  [value]="c.name"
                  #rename
                  maxlength="60"
                  (keydown.enter)="$event.preventDefault(); saveName(c, rename.value)"
                  (keydown.escape)="editing.set(null)"
                />
              </mat-form-field>
              <button mat-icon-button (click)="saveName(c, rename.value)" aria-label="Save name">
                <mat-icon>check</mat-icon>
              </button>
            } @else {
              <span class="name">{{ c.name }}</span>
              <button
                mat-icon-button
                (click)="editing.set(c.id)"
                [attr.aria-label]="'Rename ' + c.name"
                matTooltip="Rename"
              >
                <mat-icon>edit</mat-icon>
              </button>
            }
            <button
              mat-icon-button
              [disabled]="first || busy()"
              (click)="move(c, -1)"
              [attr.aria-label]="'Move ' + c.name + ' up'"
            >
              <mat-icon>arrow_upward</mat-icon>
            </button>
            <button
              mat-icon-button
              [disabled]="last || busy()"
              (click)="move(c, 1)"
              [attr.aria-label]="'Move ' + c.name + ' down'"
            >
              <mat-icon>arrow_downward</mat-icon>
            </button>
            <mat-slide-toggle
              [checked]="!c.hidden"
              (change)="setHidden(c, !$event.checked)"
              [disabled]="busy()"
              [attr.aria-label]="'Show ' + c.name"
              matTooltip="Shown"
            />
          </li>
        }
      </ul>
      <form [formGroup]="form" (ngSubmit)="add()" class="add" novalidate>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>New category</mat-label>
          <input matInput formControlName="name" maxlength="60" />
        </mat-form-field>
        <button mat-stroked-button type="submit" [disabled]="busy()">
          <mat-icon>add</mat-icon>
          Add
        </button>
      </form>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button [mat-dialog-close]="changed">Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    .lead {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .rows {
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      &.hidden .name {
        color: var(--mat-sys-on-surface-variant);
        text-decoration: line-through;
      }
    }
    .name {
      flex: 1;
      min-width: 0;
    }
    mat-slide-toggle {
      margin-left: 8px;
    }
    .add {
      display: flex;
      gap: 8px;
      align-items: center;
      mat-form-field {
        flex: 1;
      }
    }
    .error {
      margin: 12px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class PolicyCategoriesDialog {
  private readonly data = inject<{ societyId: number; categories: PolicyCategory[] }>(
    MAT_DIALOG_DATA,
  );
  private readonly api = inject(PolicyApi);

  protected readonly categories = signal(this.data.categories);
  protected readonly editing = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
  });
  protected changed = false;

  protected saveName(c: PolicyCategory, name: string): void {
    if (!name.trim() || name.trim() === c.name) {
      this.editing.set(null);
      return;
    }
    this.save(c, { name: name.trim() }, () => this.editing.set(null));
  }

  protected setHidden(c: PolicyCategory, hidden: boolean): void {
    this.save(c, { hidden });
  }

  /** Swaps positions with its neighbour (positions are renumbered 1…n first, in case of gaps). */
  protected move(c: PolicyCategory, by: -1 | 1): void {
    const list = this.categories();
    const index = list.findIndex((x) => x.id === c.id);
    const other = list[index + by];
    if (!other) return;
    this.busy.set(true);
    this.error.set(null);
    forkJoin([
      this.api.updateCategory(c.id, { position: index + by + 1 }),
      this.api.updateCategory(other.id, { position: index + 1 }),
    ]).subscribe({
      next: ([a, b]) => {
        const next = list.map((x) => (x.id === a.id ? a : x.id === b.id ? b : x));
        this.categories.set([...next].sort((x, y) => x.position - y.position || x.id - y.id));
        this.changed = true;
        this.busy.set(false);
      },
      error: (err) => this.fail(err),
    });
  }

  protected add(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.createCategory(this.data.societyId, this.form.controls.name.value.trim()).subscribe({
      next: (created) => {
        this.categories.update((list) => [...list, created]);
        this.form.reset();
        this.changed = true;
        this.busy.set(false);
      },
      error: (err) => this.fail(err),
    });
  }

  private save(c: PolicyCategory, changes: Partial<PolicyCategory>, done?: () => void): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.updateCategory(c.id, changes).subscribe({
      next: (saved) => {
        this.categories.update((list) => list.map((x) => (x.id === saved.id ? saved : x)));
        this.changed = true;
        this.busy.set(false);
        done?.();
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: HttpErrorResponse): void {
    this.busy.set(false);
    this.error.set(errorMessage(err));
  }
}

/** Emits true when anything changed. */
export function categoriesDialog(
  dialog: MatDialog,
  data: { societyId: number; categories: PolicyCategory[] },
): Observable<boolean | undefined> {
  return dialog.open(PolicyCategoriesDialog, { data, width: '560px' }).afterClosed();
}
