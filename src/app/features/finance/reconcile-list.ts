import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, combineLatest, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { ReconciliationApi } from '../../core/api/reconciliation.api';
import { Account, BankStatement, Books } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { dayLabel, inr } from '../maintenance/maintenance-ui';
import { FinanceAccess, FinanceTabs, signedInr } from './finance-ui';
import {
  STATEMENT_STATUS,
  bankAccounts,
  importDialog,
  periodText,
  statementDialog,
} from './reconcile-ui';

/**
 * Bank reconciliation, per bank account: its statements newest first, a new statement (which follows
 * the last one), and the account's statement columns. `/finance/reconcile/:accountId` picks the
 * account; without it the first bank account shows.
 */
@Component({
  selector: 'app-reconcile-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    FinanceTabs,
  ],
  templateUrl: './reconcile-list.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
})
export class ReconcileList {
  private readonly finance = inject(FinanceApi);
  private readonly api = inject(ReconciliationApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(FinanceAccess);
  protected readonly status = STATEMENT_STATUS;
  protected readonly periodText = periodText;
  protected readonly signedInr = signedInr;
  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;

  protected readonly banks = signal<Account[]>([]);
  protected readonly books = signal<Books | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  private readonly routeAccount = signal<number | null>(null);
  private readonly attempt = signal(0);

  protected readonly account = computed(() => {
    const banks = this.banks();
    return banks.find((b) => b.id === this.routeAccount()) ?? banks[0] ?? null;
  });
  protected readonly statements = signal<BankStatement[]>([]);
  protected readonly statementsLoading = signal(false);
  /** Newest first. */
  protected readonly sorted = computed(() =>
    [...this.statements()].sort((a, b) => b.periodFrom.localeCompare(a.periodFrom)),
  );
  protected readonly openStatement = computed(
    () => this.statements().find((s) => s.status === 'OPEN') ?? null,
  );

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe((p) => this.routeAccount.set(Number(p.get('accountId')) || null));

    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) =>
          societyId == null
            ? of(null)
            : forkJoin({
                accounts: this.finance.accounts(societyId),
                books: this.finance.books(societyId),
              }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loadError.set(result === null && this.ctx.selectedSocietyId() != null);
        this.banks.set(result ? bankAccounts(result.accounts) : []);
        this.books.set(result?.books ?? null);
        this.loading.set(false);
      });

    combineLatest([
      toObservable(computed(() => this.account()?.id ?? null)),
      toObservable(this.attempt),
    ])
      .pipe(
        tap(() => this.statementsLoading.set(true)),
        switchMap(([accountId]) => {
          const societyId = this.ctx.selectedSocietyId();
          return accountId == null || societyId == null
            ? of([])
            : this.api.statements(societyId, accountId).pipe(catchError(() => of([])));
        }),
        map((list) => list as BankStatement[]),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.statements.set(list);
        this.statementsLoading.set(false);
      });
  }

  protected reload(): void {
    this.attempt.update((n) => n + 1);
  }

  protected choose(accountId: number): void {
    this.router.navigate(['/finance/reconcile', accountId], { replaceUrl: true });
  }

  protected newStatement(): void {
    const account = this.account();
    if (!account) return;
    statementDialog(this.dialog, {
      accountId: account.id,
      accountName: account.name,
      latest: this.sorted()[0] ?? null,
      first: this.statements().length === 0,
      booksStart: this.books()?.startDate ?? null,
    }).subscribe((s) => this.router.navigate(['/finance/reconcile/statements', s.id]));
  }

  protected columns(): void {
    const account = this.account();
    if (!account) return;
    importDialog(this.dialog, { accountId: account.id, accountName: account.name }).subscribe(() =>
      this.snack.open('Statement columns saved', undefined, { duration: 3000 }),
    );
  }
}
