import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, finalize, forkJoin, of, switchMap, tap } from 'rxjs';

import { FinanceApi, VoucherQuery } from '../../core/api/finance.api';
import { Voucher, VoucherStatus, VoucherType } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { dayLabel, inr, todayIso } from '../maintenance/maintenance-ui';
import {
  EntryKind,
  FinanceAccess,
  FinanceTabs,
  VOUCHER_STATUS,
  VOUCHER_TYPE,
  entryDialog,
} from './finance-ui';

const PAGE_SIZE = 30;

/**
 * Every entry in the books, newest first, with filters. `?status=PENDING_APPROVAL` is the approvals
 * queue; `?new=RECEIPT|PAYMENT|CONTRA|JOURNAL` opens that form (from the command palette).
 */
@Component({
  selector: 'app-entry-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    FinanceTabs,
  ],
  templateUrl: './entry-list.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
})
export class EntryList {
  private readonly api = inject(FinanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(FinanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly voucherType = VOUCHER_TYPE;
  protected readonly voucherStatus = VOUCHER_STATUS;
  protected readonly today = todayIso();
  protected readonly types = Object.entries(VOUCHER_TYPE).map(([value, t]) => ({
    value: value as VoucherType,
    label: t.label,
  }));
  protected readonly statuses = Object.entries(VOUCHER_STATUS).map(([value, s]) => ({
    value: value as VoucherStatus,
    label: s.label,
  }));

  private readonly route = inject(ActivatedRoute);
  protected readonly type = signal<VoucherType | ''>('');
  protected readonly status = signal<VoucherStatus | ''>(
    (this.route.snapshot.queryParamMap.get('status') as VoucherStatus) ?? '',
  );
  protected readonly q = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly vouchers = signal<Voucher[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  protected readonly filtered = computed(
    () => !!(this.type() || this.status() || this.q() || this.from() || this.to()),
  );

  private readonly query = computed<VoucherQuery | null>(() => {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return null;
    return {
      societyId,
      type: this.type() ? [this.type() as VoucherType] : undefined,
      status: this.status() ? [this.status() as VoucherStatus] : undefined,
      q: this.q().trim() || null,
      from: this.from() || null,
      to: this.to() || null,
    };
  });
  private readonly attempt = signal(0);
  private page = 0;

  constructor() {
    toObservable(computed(() => [this.query(), this.attempt()] as const))
      .pipe(
        debounceTime(150),
        tap(() => {
          this.loading.set(true);
          this.page = 0;
        }),
        switchMap(([query]) =>
          query == null
            ? of([])
            : this.api
                .vouchers({ ...query, page: 0, size: PAGE_SIZE })
                .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.vouchers.set(list ?? []);
        this.hasMore.set(list?.length === PAGE_SIZE);
        this.loading.set(false);
      });

    const kind = this.route.snapshot.queryParamMap.get('new') as EntryKind | null;
    if (kind) {
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
      queueMicrotask(() => this.record(kind));
    }
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected clearFilters(): void {
    this.type.set('');
    this.status.set('');
    this.q.set('');
    this.from.set('');
    this.to.set('');
  }

  protected record(kind: EntryKind): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    if (kind === 'JOURNAL' ? !this.access.canJournal() : !this.access.canRecord()) return;
    forkJoin({
      books: this.api.books(societyId),
      accounts: this.api.accounts(societyId),
    }).subscribe(({ books, accounts }) => {
      if (!books.started) {
        this.router.navigate(['/finance']);
        return;
      }
      entryDialog(this.dialog, {
        societyId,
        kind,
        accounts,
        moneyAccountId:
          kind === 'PAYMENT'
            ? books.defaults?.defaultPayingAccountId
            : books.defaults?.cashDepositAccountId,
      }).subscribe((v) => this.router.navigate(['/finance/entries', v.id]));
    });
  }

  protected exportDayBook(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    this.api
      .exportReport(societyId, 'day-book', { from: this.from() || null, to: this.to() || null })
      .subscribe((res) => saveResponse(res, 'day-book.csv'));
  }

  protected loadMore(): void {
    const query = this.query();
    if (query == null) return;
    this.loadingMore.set(true);
    this.api
      .vouchers({ ...query, page: this.page + 1, size: PAGE_SIZE })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (list) => {
          if (query !== this.query()) return;
          this.page++;
          const seen = new Set(this.vouchers().map((v) => v.id));
          this.vouchers.update((current) => [...current, ...list.filter((v) => !seen.has(v.id))]);
          this.hasMore.set(list.length === PAGE_SIZE);
        },
        error: () => {}, // reported by the error interceptor
      });
  }
}
