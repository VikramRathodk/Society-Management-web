import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, debounceTime, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { Ledger } from '../../core/models';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton } from '../../shared/ui';
import { dayLabel, inr, todayIso } from '../maintenance/maintenance-ui';
import { FinanceAccess, VOUCHER_TYPE, accountTypeLabel, signedInr } from './finance-ui';

/**
 * One account's movements over a period: opening balance, each entry with the running balance, and the
 * closing balance (in the account's natural sign). The cash book and each bank book are this page for
 * that account. `?flatId=` narrows a member account to one flat.
 */
@Component({
  selector: 'app-ledger',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    Skeleton,
  ],
  templateUrl: './ledger.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
})
export class LedgerPage {
  private readonly api = inject(FinanceApi);
  protected readonly access = inject(FinanceAccess);
  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly dayLabel = dayLabel;
  protected readonly voucherType = VOUCHER_TYPE;
  protected readonly accountTypeLabel = accountTypeLabel;
  protected readonly today = todayIso();

  private readonly route = inject(ActivatedRoute);
  private readonly id = signal(Number(this.route.snapshot.paramMap.get('id')));
  private readonly flatId = signal<number | null>(
    Number(this.route.snapshot.queryParamMap.get('flatId')) || null,
  );
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly ledger = signal<Ledger | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  private readonly attempt = signal(0);

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe((p) => this.id.set(Number(p.get('id'))));
    toObservable(
      computed(() => [this.id(), this.flatId(), this.from(), this.to(), this.attempt()] as const),
    )
      .pipe(
        debounceTime(100),
        tap(() => this.loading.set(true)),
        switchMap(([id, flatId, from, to]) =>
          this.api.ledger(id, { flatId, from: from || null, to: to || null }).pipe(
            catchError((err) => {
              this.loadError.set(err?.status === 404 || err?.status === 403 ? 'missing' : 'failed');
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((ledger) => {
        if (ledger) {
          this.loadError.set(null);
          this.ledger.set(ledger);
          if (!this.from()) this.from.set(ledger.from);
          if (!this.to()) this.to.set(ledger.to);
        }
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected export(): void {
    this.api
      .exportLedger(this.id(), {
        flatId: this.flatId(),
        from: this.from() || null,
        to: this.to() || null,
      })
      .subscribe((res) => saveResponse(res, 'ledger.csv'));
  }

  protected print(): void {
    window.print();
  }
}
