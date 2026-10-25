import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Observable,
  catchError,
  exhaustMap,
  filter,
  finalize,
  map,
  of,
  switchMap,
  tap,
  timer,
} from 'rxjs';

import { VisitorApi, VisitorQuery } from '../../core/api/visitor.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { Visitor, VisitorStatus } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader } from '../../shared/ui';
import { VisitorPhotos, VisitorRow, groupByDay } from './visitor-ui';

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const POLL_MS = 15_000;

interface StatusFilter {
  label: string;
  value: VisitorStatus | null;
}

/** Gate log: visitors of the selected society, newest first, refreshed every 15 s. */
@Component({
  selector: 'app-visitor-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    HasPermission,
    EmptyState,
    PageHeader,
    VisitorRow,
  ],
  providers: [VisitorPhotos],
  templateUrl: './visitor-list.html',
  styleUrl: './visitor-list.scss',
})
export class VisitorList {
  private readonly api = inject(VisitorApi);
  private readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);

  protected readonly filters: StatusFilter[] = [
    { label: 'All', value: null },
    { label: 'Pending', value: 'PENDING' },
    { label: 'Approved', value: 'APPROVED' },
    { label: 'Inside', value: 'ENTERED' },
    { label: 'Exited', value: 'EXITED' },
    { label: 'Rejected', value: 'REJECTED' },
  ];

  /** Starts from `?status=` so dashboard cards can link to a filtered log. */
  protected readonly status = signal<VisitorStatus | null>(
    statusParam(inject(ActivatedRoute).snapshot.queryParamMap.get('status')),
  );
  protected readonly visitors = signal<Visitor[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly subtitle = computed(() =>
    [this.ctx.selectedSociety()?.name, 'Updates every 15 seconds'].filter(Boolean).join(' · '),
  );
  /** Filters what is loaded by name, flat, phone or purpose. */
  protected readonly search = signal('');
  protected readonly groups = computed(() => {
    const query = this.search().trim().toLowerCase();
    const shown = query
      ? this.visitors().filter((v) =>
          [v.visitorName, v.flatNumber, v.visitorPhone, v.purpose].some((field) =>
            field?.toLowerCase().includes(query),
          ),
        )
      : this.visitors();
    return groupByDay(shown);
  });
  /** Visitors with an action in flight, so their buttons can be disabled. */
  protected readonly busy = signal<ReadonlySet<number>>(new Set());

  private readonly query = computed<VisitorQuery>(() => ({
    societyId: this.ctx.selectedSocietyId(),
    status: this.status(),
  }));
  private page = 0;
  protected readonly loadError = signal(false);
  private readonly attempt = signal(0);

  constructor() {
    toObservable(computed(() => [this.query(), this.attempt()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.page = 0;
        }),
        switchMap(([query]) =>
          this.api.list({ ...query, page: 0, size: PAGE_SIZE }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.visitors.set(list ?? []);
        this.hasMore.set(list?.length === PAGE_SIZE);
        this.loading.set(false);
      });

    // No push in the web app yet: re-fetch what is on screen while the tab is visible.
    timer(POLL_MS, POLL_MS)
      .pipe(
        filter(
          () => !this.loading() && !this.loadingMore() && document.visibilityState === 'visible',
        ),
        exhaustMap(() => {
          const query = this.query();
          const size = Math.min(Math.max(this.visitors().length, PAGE_SIZE), MAX_PAGE_SIZE);
          return this.fetch(query, 0, size, true).pipe(map((list) => ({ query, size, list })));
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ query, size, list }) => {
        // Skip failed polls (keep what is shown) and results for a filter that has since changed.
        if (!list || query !== this.query()) return;
        this.loadError.set(false);
        this.visitors.update((current) => dedupe([...list, ...current.slice(size)]));
      });
  }

  protected setStatus(status: VisitorStatus | null): void {
    this.status.set(status);
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected loadMore(): void {
    this.loadingMore.set(true);
    const query = this.query();
    this.fetch(query, this.page + 1, PAGE_SIZE)
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe((list) => {
        if (!list || query !== this.query()) return; // a failure is reported by the interceptor
        this.page++;
        this.visitors.update((current) => dedupe([...current, ...list]));
        this.hasMore.set(list.length === PAGE_SIZE);
      });
  }

  protected can(permission: string, visitor: Visitor): boolean {
    return this.auth.can(permission, visitor.societyId);
  }

  /** Approve/reject: residents decide for their own flat; anyone else also needs OVERRIDE. */
  protected canDecide(permission: string, visitor: Visitor): boolean {
    return (
      this.can(permission, visitor) &&
      (this.isResidentOf(visitor) || this.can('VISITOR.APPROVAL.OVERRIDE', visitor))
    );
  }

  protected approve(visitor: Visitor): void {
    this.decide(visitor, 'Approve', () => this.api.approve(visitor.id));
  }

  protected reject(visitor: Visitor): void {
    this.decide(visitor, 'Reject', () => this.api.reject(visitor.id));
  }

  protected markEntered(visitor: Visitor): void {
    this.act(visitor, this.api.enter(visitor.id));
  }

  protected markExited(visitor: Visitor): void {
    this.act(visitor, this.api.exit(visitor.id));
  }

  protected remove(visitor: Visitor): void {
    confirmDialog(this.dialog, {
      title: 'Delete visitor entry',
      message: `Delete the entry for ${visitor.visitorName}?`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.delete(visitor.id)),
      )
      .subscribe({
        next: () => this.visitors.update((list) => list.filter((v) => v.id !== visitor.id)),
        error: () => {}, // reported by the error interceptor
      });
  }

  /** Someone who isn't a resident of the flat decides on its behalf (SECRETARY+): confirm first. */
  private decide(visitor: Visitor, verb: 'Approve' | 'Reject', request: () => Observable<unknown>) {
    const confirmed = this.isResidentOf(visitor)
      ? of(true)
      : confirmDialog(this.dialog, {
          title: `${verb} on behalf of flat ${visitor.flatNumber}?`,
          message: `You are not a resident of flat ${visitor.flatNumber}. This will be recorded as an override.`,
          confirmText: verb,
        });
    confirmed.pipe(filter(Boolean)).subscribe(() => this.act(visitor, request()));
  }

  /**
   * Runs the action, then re-fetches the row. On 409 (someone else answered, or the status moved
   * on) the interceptor shows the message and the re-fetch brings the row up to date.
   */
  private act(visitor: Visitor, request: Observable<unknown>): void {
    this.setBusy(visitor.id, true);
    request
      .pipe(
        catchError(() => of(null)),
        switchMap(() => this.api.get(visitor.id)),
        finalize(() => this.setBusy(visitor.id, false)),
      )
      .subscribe({
        next: (updated) =>
          this.visitors.update((list) => list.map((v) => (v.id === updated.id ? updated : v))),
        error: () => {}, // reported by the error interceptor
      });
  }

  private isResidentOf(visitor: Visitor): boolean {
    return this.auth.user()?.roles.some((a) => a.flatId === visitor.flatId) ?? false;
  }

  /** null on failure, so callers leave what is on screen alone instead of treating it as empty. */
  private fetch(query: VisitorQuery, page: number, size: number, silent = false) {
    return this.api.list({ ...query, page, size }, { silent }).pipe(catchError(() => of(null)));
  }

  private setBusy(id: number, busy: boolean): void {
    this.busy.update((ids) => {
      const next = new Set(ids);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}

function dedupe(visitors: Visitor[]): Visitor[] {
  const seen = new Set<number>();
  return visitors.filter((v) => !seen.has(v.id) && seen.add(v.id));
}

const STATUSES: readonly VisitorStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'ENTERED', 'EXITED'];

function statusParam(value: string | null): VisitorStatus | null {
  return STATUSES.find((s) => s === value) ?? null;
}
