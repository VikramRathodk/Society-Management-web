import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { Account } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import {
  FinanceAccess,
  FinanceTabs,
  SYSTEM,
  accountDialog,
  bankDialog,
  chartRows,
  isProtected,
  signedInr,
} from './finance-ui';

/**
 * The chart of accounts as a tree with balances (a group's is the total of everything under it).
 * Managers add, rename, move, deactivate and delete accounts; roots and system accounts stay.
 */
@Component({
  selector: 'app-account-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatSlideToggleModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    FinanceTabs,
  ],
  templateUrl: './account-list.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
  styles: `
    .tree-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px 16px;
      padding: 8px 8px 8px 16px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .tree-row:first-child {
      border-top: 0;
    }
    .tree-row.root {
      background: var(--mat-sys-surface-container-low);
      font: var(--mat-sys-title-small);
    }
    .tree-row.inactive .name {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
    .name {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .name a {
      color: inherit;
    }
    .code {
      color: var(--mat-sys-on-surface-variant);
      font-variant-numeric: tabular-nums;
      min-width: 3.5em;
    }
    .group-name {
      font-weight: 600;
    }
  `,
})
export class AccountList {
  private readonly api = inject(FinanceApi);
  private readonly dialog = inject(MatDialog);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly access = inject(FinanceAccess);
  protected readonly signedInr = signedInr;
  protected readonly isProtected = isProtected;

  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly showInactive = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  private readonly attempt = signal(0);

  protected readonly rows = computed(() =>
    chartRows(this.accounts()).filter((r) => this.showInactive() || r.account.active),
  );

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) =>
          societyId == null
            ? of([])
            : this.api.accounts(societyId).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.accounts.set(list ?? []);
        this.loading.set(false);
      });
  }

  protected reload(): void {
    this.attempt.update((n) => n + 1);
  }

  protected add(parent?: Account): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    accountDialog(this.dialog, {
      societyId,
      accounts: this.accounts(),
      parentId: parent?.id,
    }).subscribe(() => this.reload());
  }

  protected addBank(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    bankDialog(this.dialog, { societyId }).subscribe(() => this.reload());
  }

  protected edit(account: Account): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    const open = account.bank
      ? bankDialog(this.dialog, { societyId, account })
      : accountDialog(this.dialog, { societyId, accounts: this.accounts(), account });
    open.subscribe(() => this.reload());
  }

  protected toggleActive(account: Account): void {
    this.api.updateAccount(account.id, { active: !account.active }).subscribe(() => this.reload());
  }

  protected remove(account: Account): void {
    confirmDialog(this.dialog, {
      title: `Delete ${account.name}?`,
      message: 'Only possible while nothing was ever posted to it and nothing is under it.',
      confirmText: 'Delete',
    }).subscribe((ok) => ok && this.api.deleteAccount(account.id).subscribe(() => this.reload()));
  }

  protected isBankGroup(account: Account): boolean {
    return account.systemKey === SYSTEM.BANK_ACCOUNTS;
  }
}
