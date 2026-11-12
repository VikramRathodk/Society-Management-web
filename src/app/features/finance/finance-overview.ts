import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Account, Books, CashAndBank, MaintenanceCheck, Voucher } from '../../core/models';
import { Notifier } from '../../core/notifier';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Section, Skeleton, StatCard, StatusPill } from '../../shared/ui';
import { dayLabel, inr, todayIso } from '../maintenance/maintenance-ui';
import {
  EntryKind,
  FinanceAccess,
  FinanceTabs,
  SYSTEM,
  VOUCHER_STATUS,
  VOUCHER_TYPE,
  bankDialog,
  chartRows,
  entryDialog,
  moneyAccounts,
  signedInr,
} from './finance-ui';

interface Overview {
  books: Books;
  accounts: Account[];
  cash: CashAndBank | null;
  waiting: Voucher[];
  recent: Voucher[];
  check: MaintenanceCheck | null;
}

/**
 * The books at a glance. Before the books are started it is the setup: the chart, bank accounts and
 * opening balances (the General fund balances them). Afterwards: cash and bank, what waits for
 * approval, whether the books agree with maintenance, and the latest entries.
 */
@Component({
  selector: 'app-finance-overview',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatCard,
    StatusPill,
    FinanceTabs,
  ],
  templateUrl: './finance-overview.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
})
export class FinanceOverview {
  private readonly api = inject(FinanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly notifier = inject(Notifier);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(FinanceAccess);

  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly dayLabel = dayLabel;
  protected readonly voucherType = VOUCHER_TYPE;
  protected readonly voucherStatus = VOUCHER_STATUS;
  protected readonly today = todayIso();

  protected readonly data = signal<Overview | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  private readonly attempt = signal(0);

  // ---- Setup ----
  protected readonly startDate = signal(todayIso());
  protected readonly openings = signal<Record<number, number | null>>({});
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | null>(null);
  protected readonly seeding = signal(false);

  protected readonly banks = computed(() => moneyAccounts(this.data()?.accounts ?? []));

  /** Ledgers that take a typed opening balance: assets, liabilities and funds, not the computed ones. */
  protected readonly openingRows = computed(() =>
    chartRows(this.data()?.accounts ?? []).filter(
      (r) =>
        !r.account.group &&
        r.account.active &&
        ['ASSET', 'LIABILITY', 'FUND'].includes(r.account.type) &&
        ![SYSTEM.GENERAL_FUND, SYSTEM.MEMBER_DUES, SYSTEM.MEMBER_ADVANCE].includes(
          r.account.systemKey as never,
        ),
    ),
  );

  /** What the General fund will be (credit positive): assets − liabilities − other funds. */
  protected readonly generalFund = computed(() => {
    const byId = new Map((this.data()?.accounts ?? []).map((a) => [a.id, a]));
    let total = 0;
    for (const [id, amount] of Object.entries(this.openings())) {
      const account = byId.get(Number(id));
      if (!account || !amount) continue;
      total += account.type === 'ASSET' ? amount : -amount;
    }
    return Math.round(total * 100) / 100;
  });

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) =>
          societyId == null ? of(null) : this.load(societyId).pipe(catchError(() => of(undefined))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((data) => {
        this.loadError.set(data === undefined);
        this.data.set(data ?? null);
        this.loading.set(false);
      });
  }

  private load(societyId: number) {
    return forkJoin({
      books: this.api.books(societyId),
      accounts: this.api.accounts(societyId),
    }).pipe(
      switchMap(({ books, accounts }) => {
        if (!books.started)
          return of<Overview>({
            books,
            accounts,
            cash: null,
            waiting: [],
            recent: [],
            check: null,
          });
        return forkJoin({
          cash: this.access.canViewVouchers()
            ? this.api.cashAndBank(societyId).pipe(catchError(() => of(null)))
            : of(null),
          waiting: this.access.canViewVouchers()
            ? this.api
                .vouchers({ societyId, status: ['PENDING_APPROVAL'], size: 50 })
                .pipe(catchError(() => of([])))
            : of([]),
          recent: this.access.canViewVouchers()
            ? this.api
                .vouchers({ societyId, status: ['POSTED', 'VOID'], size: 8 })
                .pipe(catchError(() => of([])))
            : of([]),
          check: this.access.canReports()
            ? this.api.maintenanceCheck(societyId).pipe(catchError(() => of(null)))
            : of(null),
        }).pipe(map((rest) => ({ books, accounts, ...rest })));
      }),
    );
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected seedChart(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    this.seeding.set(true);
    this.api.seedChart(societyId).subscribe({
      next: () => {
        this.seeding.set(false);
        this.retry();
      },
      error: () => this.seeding.set(false),
    });
  }

  protected addBank(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    bankDialog(this.dialog, { societyId }).subscribe(() => this.retry());
  }

  protected setOpening(accountId: number, value: string): void {
    const amount = value === '' ? null : Number(value);
    this.openings.update((o) => ({ ...o, [accountId]: Number.isFinite(amount) ? amount : null }));
  }

  protected start(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null || this.starting()) return;
    const openings = Object.entries(this.openings())
      .filter(([, amount]) => amount != null && amount !== 0)
      .map(([accountId, amount]) => ({ accountId: Number(accountId), amount: amount! }));
    this.starting.set(true);
    this.startError.set(null);
    this.api.start(societyId, this.startDate(), openings).subscribe({
      next: () => {
        this.starting.set(false);
        this.notifier.show('The books are started');
        this.retry();
      },
      error: (err: HttpErrorResponse) => {
        this.starting.set(false);
        this.startError.set(errorMessage(err));
      },
    });
  }

  protected record(kind: EntryKind): void {
    const societyId = this.ctx.selectedSocietyId();
    const data = this.data();
    if (societyId == null || !data) return;
    entryDialog(this.dialog, {
      societyId,
      kind,
      accounts: data.accounts,
      moneyAccountId:
        kind === 'PAYMENT'
          ? data.books.defaults?.defaultPayingAccountId
          : data.books.defaults?.cashDepositAccountId,
    }).subscribe((v) => this.router.navigate(['/finance/entries', v.id]));
  }
}
