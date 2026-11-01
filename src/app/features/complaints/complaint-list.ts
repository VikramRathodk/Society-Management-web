import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, finalize, of, switchMap, tap } from 'rxjs';

import { ComplaintApi, ComplaintQuery } from '../../core/api/complaint.api';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { Complaint, ComplaintCategory, ComplaintStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { exportDialog } from '../../shared/export-dialog';
import { EmptyState, PageHeader, Skeleton } from '../../shared/ui';
import { COMPLAINT_CATEGORIES, ComplaintRow } from './complaint-ui';

const PAGE_SIZE = 20;

interface StatusFilter {
  label: string;
  value: ComplaintStatus | null;
}

/**
 * Complaints of the selected society, newest first. Residents get their own flat's complaints
 * (the backend scopes the list); the committee sees all of them.
 */
@Component({
  selector: 'app-complaint-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    Skeleton,
    MatSelectModule,
    HasPermission,
    EmptyState,
    PageHeader,
    ComplaintRow,
  ],
  templateUrl: './complaint-list.html',
  styleUrl: './complaint-list.scss',
})
export class ComplaintList {
  private readonly api = inject(ComplaintApi);
  protected readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);

  protected readonly filters: StatusFilter[] = [
    { label: 'All', value: null },
    { label: 'Open', value: 'OPEN' },
    { label: 'In progress', value: 'IN_PROGRESS' },
    { label: 'Resolved', value: 'RESOLVED' },
    { label: 'Closed', value: 'CLOSED' },
  ];
  protected readonly categories = COMPLAINT_CATEGORIES;

  /** Starts from `?status=` so dashboard cards can link to a filtered list. */
  protected readonly status = signal<ComplaintStatus | null>(
    statusParam(inject(ActivatedRoute).snapshot.queryParamMap.get('status')),
  );
  protected readonly category = signal<ComplaintCategory | null>(null);
  protected readonly complaints = signal<Complaint[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);

  private readonly query = computed<ComplaintQuery | null>(() => {
    const societyId = this.ctx.selectedSocietyId();
    return societyId == null
      ? null
      : { societyId, status: this.status(), category: this.category() };
  });
  private readonly attempt = signal(0);
  private page = 0;

  constructor() {
    toObservable(computed(() => [this.query(), this.attempt()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.page = 0;
        }),
        switchMap(([query]) =>
          query == null
            ? of([])
            : this.api
                .list({ ...query, page: 0, size: PAGE_SIZE })
                .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.complaints.set(list ?? []);
        this.hasMore.set(list?.length === PAGE_SIZE);
        this.loading.set(false);
      });
  }

  protected setStatus(status: ComplaintStatus | null): void {
    this.status.set(status);
  }

  protected setCategory(category: ComplaintCategory | null): void {
    this.category.set(category);
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected loadMore(): void {
    const query = this.query();
    if (query == null) return;
    this.loadingMore.set(true);
    this.api
      .list({ ...query, page: this.page + 1, size: PAGE_SIZE })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (list) => {
          if (query !== this.query()) return;
          this.page++;
          const seen = new Set(this.complaints().map((c) => c.id));
          this.complaints.update((current) => [...current, ...list.filter((c) => !seen.has(c.id))]);
          this.hasMore.set(list.length === PAGE_SIZE);
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  protected export(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    exportDialog(this.dialog, {
      title: 'Export complaints',
      download: ({ from, to }) => this.api.export(societyId, from, to),
    }).subscribe();
  }
}

const STATUSES: readonly ComplaintStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

function statusParam(value: string | null): ComplaintStatus | null {
  return STATUSES.find((s) => s === value) ?? null;
}
