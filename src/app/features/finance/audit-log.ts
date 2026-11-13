import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { catchError, finalize, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { AuditEntityType, AuditEntry } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { FinanceTabs } from './finance-ui';

const PAGE_SIZE = 50;

const ENTITIES: { value: AuditEntityType; label: string }[] = [
  { value: 'VOUCHER', label: 'Entries' },
  { value: 'ACCOUNT', label: 'Accounts' },
  { value: 'BANK_ACCOUNT', label: 'Bank accounts' },
  { value: 'BOOKS', label: 'Books (start, openings, lock)' },
  { value: 'MAPPING', label: 'Default accounts and charge ledgers' },
  { value: 'SETTING', label: 'Finance settings' },
  { value: 'DOCUMENT', label: 'Documents' },
  { value: 'RECONCILIATION', label: 'Bank reconciliation' },
];

/** Who changed what in the books and why, newest first. Entries can't be edited or deleted. */
@Component({
  selector: 'app-audit-log',
  imports: [
    DatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
    FinanceTabs,
  ],
  templateUrl: './audit-log.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
  styles: `
    .changes {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 2px 12px;
      margin: 6px 0 0;
      font: var(--mat-sys-body-small);
    }
    .changes dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .changes dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .old {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
      margin-right: 6px;
    }
  `,
})
export class AuditLog {
  private readonly api = inject(FinanceApi);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly entities = ENTITIES;

  protected readonly entityType = signal<AuditEntityType | ''>('');
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  private page = 0;

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.entityType()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.page = 0;
        }),
        switchMap(([societyId, entityType]) =>
          societyId == null
            ? of([])
            : this.api
                .audit(societyId, { entityType: entityType || null, size: PAGE_SIZE })
                .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.entries.set(list ?? []);
        this.hasMore.set(list?.length === PAGE_SIZE);
        this.loading.set(false);
      });
  }

  protected entityLabel(type: AuditEntityType): string {
    return ENTITIES.find((e) => e.value === type)?.label ?? type;
  }

  /** The changed fields, old next to new. */
  protected changes(entry: AuditEntry): { key: string; old: string | null; new: string | null }[] {
    const parse = (s: string | null): Record<string, unknown> => {
      try {
        return s ? (JSON.parse(s) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };
    const before = parse(entry.oldValues);
    const after = parse(entry.newValues);
    const show = (v: unknown) =>
      v === undefined ? null : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => ({
      key,
      old: show(before[key]),
      new: show(after[key]),
    }));
  }

  protected loadMore(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    this.loadingMore.set(true);
    this.api
      .audit(societyId, {
        entityType: this.entityType() || null,
        page: this.page + 1,
        size: PAGE_SIZE,
      })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (list) => {
          this.page++;
          this.entries.update((current) => [...current, ...list]);
          this.hasMore.set(list.length === PAGE_SIZE);
        },
        error: () => {},
      });
  }
}
