import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, of, switchMap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { ReconciliationApi } from '../../core/api/reconciliation.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  Account,
  BankLine,
  BankLineState,
  BankStatement,
  BookEntry,
  Brs,
  ImportResult,
  StatementImport,
  Suggestions,
} from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton, StatCard, StatusPill } from '../../shared/ui';
import { dayLabel, inr, reasonDialog } from '../maintenance/maintenance-ui';
import { FinanceAccess, VOUCHER_STATUS, VOUCHER_TYPE, signedInr } from './finance-ui';
import {
  LINE_STATE,
  STATEMENT_STATUS,
  entryNet,
  flowLabel,
  importDialog,
  lineNet,
  lineVoucherDialog,
  periodText,
  statementDialog,
  sumNet,
} from './reconcile-ui';

interface Loaded {
  statement: BankStatement;
  lines: BankLine[];
  waiting: BookEntry[];
  cleared: BookEntry[];
  brs: Brs;
  imports: StatementImport[];
}

type LineFilter = BankLineState | 'ALL';

/**
 * One bank statement: its lines beside the bank ledger's entries waiting to clear. Pick a bank line
 * to see suggestions or tick the entries that make it up; set aside lines that aren't the society's
 * business, record the entry the books miss, pair two entries that cancel out. The reconciliation
 * statement (BRS) shows what's left and completes the statement; a completed one is read-only until
 * reopened.
 */
@Component({
  selector: 'app-reconcile-statement',
  imports: [
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatIconModule,
    MatMenuModule,
    MatTabsModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatCard,
    StatusPill,
  ],
  templateUrl: './reconcile-statement.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss', './reconcile-statement.scss'],
})
export class ReconcileStatement {
  private readonly api = inject(ReconciliationApi);
  private readonly finance = inject(FinanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(FinanceAccess);

  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly flowLabel = flowLabel;
  protected readonly dayLabel = dayLabel;
  protected readonly lineNet = lineNet;
  protected readonly entryNet = entryNet;
  protected readonly periodText = periodText;
  protected readonly lineState = LINE_STATE;
  protected readonly statementStatus = STATEMENT_STATUS;
  protected readonly voucherStatus = VOUCHER_STATUS;
  protected readonly voucherType = VOUCHER_TYPE;
  protected readonly abs = Math.abs;

  private readonly id = signal(Number(this.route.snapshot.paramMap.get('id')));
  protected readonly data = signal<Loaded | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  protected readonly busy = signal(false);
  private accounts: Account[] | null = null;

  protected readonly statement = computed(() => this.data()?.statement ?? null);
  protected readonly open = computed(() => this.statement()?.status === 'OPEN');
  /** May change lines and matches. */
  protected readonly editable = computed(() => this.open() && this.access.canReconcileEdit());

  // ---- Bank lines ----
  protected readonly lineFilter = signal<LineFilter>('UNMATCHED');
  protected readonly visibleLines = computed(() => {
    const f = this.lineFilter();
    const lines = this.data()?.lines ?? [];
    return f === 'ALL' ? lines : lines.filter((l) => l.state === f);
  });
  protected readonly selectedLineId = signal<number | null>(null);
  protected readonly selectedLine = computed(
    () => this.data()?.lines.find((l) => l.id === this.selectedLineId()) ?? null,
  );
  protected readonly suggestions = signal<Suggestions | null>(null);

  // ---- Book entries ----
  protected readonly bookView = signal<'waiting' | 'cleared'>('waiting');
  protected readonly ticked = signal<ReadonlySet<number>>(new Set());
  protected readonly tickedEntries = computed(() =>
    (this.data()?.waiting ?? []).filter((e) => this.ticked().has(e.lineId)),
  );
  protected readonly tickedNet = computed(() => sumNet(this.tickedEntries()));
  /** Ticked entries make up the selected line exactly. */
  protected readonly canMatchTicked = computed(() => {
    const line = this.selectedLine();
    return !!line && this.tickedEntries().length > 0 && this.tickedNet() === lineNet(line);
  });
  /** Two ticked entries that cancel out, with no line selected. */
  protected readonly canPair = computed(
    () => !this.selectedLine() && this.tickedEntries().length === 2 && this.tickedNet() === 0,
  );
  /** Entries this statement cleared by pairing, by voucher line id → the other entry. */
  protected readonly pairs = computed(() => {
    const cleared = this.data()?.cleared ?? [];
    const byLine = new Map(cleared.map((e) => [e.lineId, e]));
    return cleared
      .filter((e) => e.pairLineId != null && e.lineId < e.pairLineId)
      .map((e) => ({ first: e, second: byLine.get(e.pairLineId!) ?? null }));
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      this.id.set(Number(p.get('id')));
      this.selectedLineId.set(null);
      this.refresh(true);
    });
  }

  private load(id: number): Observable<Loaded> {
    return forkJoin({
      statement: this.api.statement(id),
      lines: this.api.lines(id),
      waiting: this.api.bookEntries(id, false),
      cleared: this.api.bookEntries(id, true),
      brs: this.api.brs(id),
      imports: this.api.imports(id),
    });
  }

  /** Reloads everything; matching changes counts, the BRS and both lists at once. */
  protected refresh(first = false): void {
    if (first) this.loading.set(true);
    this.load(this.id())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          if (first || !this.data())
            this.loadError.set(err?.status === 404 || err?.status === 403 ? 'missing' : 'failed');
          return of(null);
        }),
      )
      .subscribe((loaded) => {
        this.loading.set(false);
        this.busy.set(false);
        if (!loaded) return;
        this.loadError.set(null);
        this.data.set(loaded);
        const waitingIds = new Set(loaded.waiting.map((e) => e.lineId));
        this.ticked.set(new Set([...this.ticked()].filter((id) => waitingIds.has(id))));
        const line = this.selectedLine();
        if (line && line.state !== 'UNMATCHED') this.clearSelection();
        else if (line) this.loadSuggestions(line);
      });
  }

  // ---- Selecting ----

  protected select(line: BankLine): void {
    if (!this.editable() || line.state !== 'UNMATCHED') return;
    if (this.selectedLineId() === line.id) {
      this.clearSelection();
      return;
    }
    this.selectedLineId.set(line.id);
    this.ticked.set(new Set());
    this.bookView.set('waiting');
    this.loadSuggestions(line);
  }

  protected clearSelection(): void {
    this.selectedLineId.set(null);
    this.suggestions.set(null);
    this.ticked.set(new Set());
  }

  private loadSuggestions(line: BankLine): void {
    this.suggestions.set(null);
    this.api.suggestions(this.id(), line.id).subscribe((s) => {
      if (this.selectedLineId() === line.id) this.suggestions.set(s);
    });
  }

  protected tick(entry: BookEntry, on: boolean): void {
    const next = new Set(this.ticked());
    if (on) next.add(entry.lineId);
    else next.delete(entry.lineId);
    this.ticked.set(next);
  }

  // ---- Matching ----

  protected matchEntries(entries: BookEntry[]): void {
    const line = this.selectedLine();
    if (!line) return;
    this.run(
      this.api.match(
        this.id(),
        line.id,
        entries.map((e) => e.lineId),
      ),
      `Matched ${entries.length === 1 ? entries[0].number : entries.length + ' entries'}`,
    );
  }

  protected matchTicked(): void {
    this.matchEntries(this.tickedEntries());
  }

  protected unmatch(line: BankLine): void {
    this.run(this.api.unmatch(this.id(), line.id), 'Unmatched');
  }

  protected autoMatch(): void {
    this.busy.set(true);
    this.api.autoMatch(this.id()).subscribe({
      next: (r) => {
        const found = r.matched + r.paired;
        this.snack.open(
          found
            ? `Matched ${r.matched} line(s)` + (r.paired ? `, paired ${r.paired}` : '')
            : 'Nothing more matches exactly; use the suggestions',
          undefined,
          { duration: 4000 },
        );
        this.refresh();
      },
      error: () => this.busy.set(false),
    });
  }

  protected exclude(line: BankLine): void {
    reasonDialog(this.dialog, {
      title: 'Set this line aside?',
      message:
        "For a bank line that has no place in the society's books (e.g. a wrong credit the bank reversed). It shows on the reconciliation statement.",
      label: 'Why',
      confirmText: 'Set aside',
      save: (reason) => this.api.exclude(this.id(), line.id, reason),
    }).subscribe(() => this.refresh());
  }

  protected include(line: BankLine): void {
    this.run(this.api.include(this.id(), line.id), 'Back among the unmatched lines');
  }

  protected recordEntry(line: BankLine): void {
    const societyId = this.ctx.selectedSocietyId();
    const statement = this.statement();
    if (societyId == null || !statement) return;
    const accounts$ = this.accounts ? of(this.accounts) : this.finance.accounts(societyId);
    accounts$
      .pipe(
        switchMap((accounts) => {
          this.accounts = accounts;
          return lineVoucherDialog(this.dialog, {
            statementId: this.id(),
            bankAccountId: statement.accountId,
            line,
            accounts,
          });
        }),
      )
      .subscribe((r) => {
        this.snack.open(
          r.voucherStatus === 'PENDING_APPROVAL'
            ? `${r.voucherNumber} is waiting for approval; the line matches once it's approved`
            : `Recorded ${r.voucherNumber} and matched it`,
          undefined,
          { duration: 5000 },
        );
        this.refresh();
      });
  }

  protected pairTicked(): void {
    const [a, b] = this.tickedEntries();
    if (!a || !b) return;
    this.run(this.api.pair(this.id(), a.lineId, b.lineId), `Paired ${a.number} and ${b.number}`);
  }

  protected unpair(entry: BookEntry): void {
    this.run(this.api.unpair(this.id(), entry.lineId), 'Unpaired');
  }

  /** Runs a change; errors from inline calls show in a snackbar here. */
  private run(call: Observable<unknown>, done: string): void {
    this.busy.set(true);
    call.subscribe({
      next: () => {
        this.snack.open(done, undefined, { duration: 3000 });
        this.refresh();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.snack.open(errorMessage(err), 'OK', { duration: 6000 });
      },
    });
  }

  // ---- Statement ----

  protected importCsv(): void {
    const s = this.statement();
    if (!s) return;
    importDialog(this.dialog, {
      accountId: s.accountId,
      accountName: s.accountName,
      statementId: s.id,
    }).subscribe((r) => {
      if (r !== 'saved') this.snack.open(importSummary(r), 'OK', { duration: 8000 });
      this.lineFilter.set('UNMATCHED');
      this.refresh();
    });
  }

  protected edit(): void {
    const s = this.statement();
    if (!s) return;
    const societyId = this.ctx.selectedSocietyId();
    forkJoin({
      list: this.api.statements(societyId!, s.accountId),
      books: this.finance.books(societyId!),
    }).subscribe(({ list, books }) =>
      statementDialog(this.dialog, {
        accountId: s.accountId,
        accountName: s.accountName,
        statement: s,
        first: list.length === 1,
        booksStart: books.startDate,
      }).subscribe(() => this.refresh()),
    );
  }

  protected remove(): void {
    const s = this.statement();
    if (!s) return;
    confirmDialog(this.dialog, {
      title: 'Delete this statement?',
      message:
        'Its imports, lines and matches go with it. Entries recorded from its lines stay in the books.',
      confirmText: 'Delete',
    }).subscribe(
      (ok) =>
        ok &&
        this.api
          .deleteStatement(s.id)
          .subscribe(() => this.router.navigate(['/finance/reconcile', s.accountId])),
    );
  }

  protected removeImport(i: StatementImport): void {
    confirmDialog(this.dialog, {
      title: `Remove ${i.filename ?? 'this import'}?`,
      message: 'Its lines and their matches are removed; import the file again to bring them back.',
      confirmText: 'Remove',
    }).subscribe((ok) => ok && this.run(this.api.deleteImport(i.id), 'Import removed'));
  }

  protected downloadImport(i: StatementImport): void {
    this.api
      .downloadImport(i.id)
      .subscribe((res) => saveResponse(res, i.filename ?? 'statement.csv'));
  }

  protected exportBrs(): void {
    this.api.exportBrs(this.id()).subscribe((res) => saveResponse(res, 'brs.csv'));
  }

  protected complete(): void {
    confirmDialog(this.dialog, {
      title: 'Complete this reconciliation?',
      message:
        'The statement and its matches are locked and the reconciliation statement is kept as it is now. It can be reopened with a reason while it is the latest.',
      confirmText: 'Complete',
    }).subscribe((ok) => {
      if (!ok) return;
      this.busy.set(true);
      this.api.complete(this.id()).subscribe({
        next: () => {
          this.snack.open('Reconciled', undefined, { duration: 3000 });
          this.clearSelection();
          this.refresh();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.snack.open(errorMessage(err), 'OK', { duration: 6000 });
        },
      });
    });
  }

  protected reopen(): void {
    reasonDialog(this.dialog, {
      title: 'Reopen this reconciliation?',
      message: 'Matches stay as they are; it needs completing again afterwards.',
      label: 'Why',
      confirmText: 'Reopen',
      save: (reason) => this.api.reopen(this.id(), reason),
    }).subscribe(() => this.refresh());
  }
}

/** "Imported 23 lines, 2 already there, 1 outside the period; matched 18 automatically." */
export function importSummary(r: ImportResult): string {
  const parts = [`Imported ${r.import.rowsImported} line(s)`];
  if (r.import.rowsDuplicate) parts.push(`${r.import.rowsDuplicate} already imported`);
  if (r.outsidePeriod.length) parts.push(`${r.outsidePeriod.length} outside the period`);
  let text = parts.join(', ');
  const auto = r.autoMatched + r.autoPaired;
  if (auto) text += `; matched ${r.autoMatched} automatically`;
  if (r.autoPaired) text += ` and paired ${r.autoPaired}`;
  return text;
}
