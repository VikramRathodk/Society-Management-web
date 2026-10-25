import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
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
import { EmptyState } from '../../shared/empty-state';
import { VisitorPhoto, VisitorPhotos } from './visitor-photo';

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
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    HasPermission,
    EmptyState,
    VisitorPhoto,
  ],
  providers: [VisitorPhotos],
  templateUrl: './visitor-list.html',
  styleUrl: './visitor-list.scss',
})
export class VisitorList {
  private readonly api = inject(VisitorApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);

  protected readonly filters: StatusFilter[] = [
    { label: 'All', value: null },
    { label: 'Pending', value: 'PENDING' },
    { label: 'Approved', value: 'APPROVED' },
    { label: 'Inside', value: 'ENTERED' },
    { label: 'Exited', value: 'EXITED' },
    { label: 'Rejected', value: 'REJECTED' },
  ];

  protected readonly status = signal<VisitorStatus | null>(null);
  protected readonly visitors = signal<Visitor[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  /** Visitors with an action in flight, so their buttons can be disabled. */
  protected readonly busy = signal<ReadonlySet<number>>(new Set());

  private readonly query = computed<VisitorQuery>(() => ({
    societyId: this.ctx.selectedSocietyId(),
    status: this.status(),
  }));
  private page = 0;

  constructor() {
    toObservable(this.query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.page = 0;
        }),
        switchMap((query) => this.fetch(query, 0, PAGE_SIZE)),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.visitors.set(list);
        this.hasMore.set(list.length === PAGE_SIZE);
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
        if (query !== this.query()) return; // the filter changed while polling
        this.visitors.update((current) => dedupe([...list, ...current.slice(size)]));
      });
  }

  protected setStatus(status: VisitorStatus | null): void {
    this.status.set(status);
  }

  protected loadMore(): void {
    this.loadingMore.set(true);
    const query = this.query();
    this.fetch(query, this.page + 1, PAGE_SIZE)
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe((list) => {
        if (query !== this.query()) return;
        this.page++;
        this.visitors.update((current) => dedupe([...current, ...list]));
        this.hasMore.set(list.length === PAGE_SIZE);
      });
  }

  protected can(permission: string, visitor: Visitor): boolean {
    return this.auth.can(permission, visitor.societyId);
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
    const isResident = this.auth.user()?.roles.some((a) => a.flatId === visitor.flatId) ?? false;
    const confirmed = isResident
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

  private fetch(query: VisitorQuery, page: number, size: number, silent = false) {
    return this.api
      .list({ ...query, page, size }, { silent })
      .pipe(catchError(() => of<Visitor[]>([])));
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
