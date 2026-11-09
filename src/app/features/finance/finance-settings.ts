import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import {
  Account,
  BookDefaults,
  Books,
  ChargeHeadMapping,
  MaintenanceCheck,
  Openings,
} from '../../core/models';
import { Notifier } from '../../core/notifier';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { dayLabel, inr, reasonDialog, todayIso } from '../maintenance/maintenance-ui';
import { FinanceAccess, FinanceTabs, chartRows, moneyAccounts, signedInr } from './finance-ui';

interface SettingsData {
  books: Books;
  accounts: Account[];
  mappings: ChargeHeadMapping[];
  openings: Openings | null;
  check: MaintenanceCheck | null;
}

const DEFAULT_FIELDS: { key: keyof BookDefaults; label: string }[] = [
  { key: 'cashDepositAccountId', label: 'Cash payments go into' },
  { key: 'chequeDepositAccountId', label: 'Cheques go into' },
  { key: 'upiDepositAccountId', label: 'UPI payments go into' },
  { key: 'transferDepositAccountId', label: 'Bank transfers go into' },
  { key: 'defaultPayingAccountId', label: 'Expenses and refunds are paid from' },
];

/**
 * How the books are kept: the lock date, where maintenance money goes by default, which ledger each
 * maintenance charge credits, the openings, and whether the books agree with maintenance. The finance
 * rules (financial year, approval limit, resident summary) live with the society settings.
 */
@Component({
  selector: 'app-finance-settings',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatusPill,
    FinanceTabs,
  ],
  templateUrl: './finance-settings.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
})
export class FinanceSettings {
  private readonly api = inject(FinanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly notifier = inject(Notifier);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(FinanceAccess);
  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly dayLabel = dayLabel;
  protected readonly defaultFields = DEFAULT_FIELDS;
  protected readonly today = todayIso();

  protected readonly data = signal<SettingsData | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  private readonly attempt = signal(0);

  protected readonly lockDate = signal('');
  protected readonly defaults = signal<BookDefaults | null>(null);
  protected readonly mappingEdits = signal<Record<number, number | null>>({});
  protected readonly saving = signal<string | null>(null);
  protected readonly error = signal<{ section: string; message: string } | null>(null);

  protected readonly money = computed(() => moneyAccounts(this.data()?.accounts ?? []));
  /** Ledgers a charge head may credit: income, funds and liabilities that aren't cash/bank or members'. */
  protected readonly creditLedgers = computed(() => {
    const moneyIds = new Set(this.money().map((a) => a.id));
    return chartRows(this.data()?.accounts ?? []).filter(
      (r) =>
        !r.account.group &&
        r.account.active &&
        ['INCOME', 'FUND', 'LIABILITY'].includes(r.account.type) &&
        !moneyIds.has(r.account.id) &&
        !['MEMBER_DUES', 'MEMBER_ADVANCE'].includes(r.account.systemKey ?? ''),
    );
  });

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) =>
          societyId == null
            ? of(null)
            : forkJoin({
                books: this.api.books(societyId),
                accounts: this.api.accounts(societyId),
              }).pipe(
                switchMap(({ books, accounts }) =>
                  !books.started
                    ? of({ books, accounts, mappings: [], openings: null, check: null })
                    : forkJoin({
                        mappings: this.api
                          .chargeHeadMappings(societyId)
                          .pipe(catchError(() => of([]))),
                        openings: this.api.openings(societyId).pipe(catchError(() => of(null))),
                        check: this.access.canReports()
                          ? this.api.maintenanceCheck(societyId).pipe(catchError(() => of(null)))
                          : of(null),
                      }).pipe(switchMap((rest) => of({ books, accounts, ...rest }))),
                ),
                catchError(() => of(undefined)),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((data) => {
        this.loadError.set(data === undefined);
        this.data.set(data ?? null);
        this.lockDate.set(data?.books.lockedUntil ?? '');
        this.defaults.set(data?.books.defaults ?? null);
        this.mappingEdits.set({});
        this.loading.set(false);
      });
  }

  protected reload(): void {
    this.attempt.update((n) => n + 1);
  }

  private fail(section: string, err: HttpErrorResponse): void {
    this.saving.set(null);
    this.error.set({ section, message: errorMessage(err) });
  }

  protected saveLock(): void {
    const d = this.data();
    if (!d) return;
    const next = this.lockDate() || null;
    const current = d.books.lockedUntil;
    const reopening = current != null && (next == null || next < current);
    const run = (reason?: string) => this.api.setLock(d.books.societyId, next, reason);
    this.error.set(null);
    if (reopening) {
      reasonDialog(this.dialog, {
        title: 'Reopen a locked period?',
        message:
          'Entries on or before the earlier lock date become possible again. The reason is kept in the audit log.',
        label: 'Reason',
        confirmText: 'Reopen',
        save: (reason) => run(reason),
      }).subscribe(() => this.reload());
      return;
    }
    this.saving.set('lock');
    run().subscribe({
      next: () => {
        this.saving.set(null);
        this.notifier.show(next ? `Books locked up to ${dayLabel(next)}` : 'Books unlocked');
        this.reload();
      },
      error: (err) => this.fail('lock', err),
    });
  }

  protected setDefault(key: keyof BookDefaults, value: number | null): void {
    this.defaults.update((d) => (d ? { ...d, [key]: value } : d));
  }

  protected saveDefaults(): void {
    const d = this.data();
    const defaults = this.defaults();
    if (!d || !defaults) return;
    this.saving.set('defaults');
    this.error.set(null);
    this.api.setDefaults(d.books.societyId, defaults).subscribe({
      next: () => {
        this.saving.set(null);
        this.notifier.show('Default accounts saved');
        this.reload();
      },
      error: (err) => this.fail('defaults', err),
    });
  }

  protected mappingValue(m: ChargeHeadMapping): number | null {
    const edits = this.mappingEdits();
    return m.chargeHeadId in edits ? edits[m.chargeHeadId] : m.mapped ? m.accountId : null;
  }

  protected setMapping(m: ChargeHeadMapping, accountId: number | null): void {
    this.mappingEdits.update((e) => ({ ...e, [m.chargeHeadId]: accountId }));
  }

  protected readonly mappingsDirty = computed(() => Object.keys(this.mappingEdits()).length > 0);

  protected saveMappings(): void {
    const d = this.data();
    if (!d) return;
    const mappings = Object.entries(this.mappingEdits()).map(([id, accountId]) => ({
      chargeHeadId: Number(id),
      accountId,
    }));
    this.saving.set('mappings');
    this.error.set(null);
    this.api.setChargeHeadMappings(d.books.societyId, mappings).subscribe({
      next: () => {
        this.saving.set(null);
        this.notifier.show('Charge ledgers saved');
        this.reload();
      },
      error: (err) => this.fail('mappings', err),
    });
  }
}
