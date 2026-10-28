import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, filter, finalize, of, switchMap, tap } from 'rxjs';

import { NoticeApi } from '../../core/api/notice.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { Notice } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { Avatar, EmptyState, PageHeader } from '../../shared/ui';
import { timeAgo } from '../visitors/visitor-ui';
import { noticeDialog } from './notice-dialog';

const PAGE_SIZE = 20;

/** The selected society's notice board, newest first. */
@Component({
  selector: 'app-notice-list',
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    HasPermission,
    Avatar,
    EmptyState,
    PageHeader,
  ],
  templateUrl: './notice-list.html',
  styleUrl: './notice-list.scss',
})
export class NoticeList {
  private readonly api = inject(NoticeApi);
  private readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly notices = signal<Notice[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  protected readonly timeAgo = timeAgo;

  private readonly attempt = signal(0);
  private page = 0;

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.page = 0;
        }),
        switchMap(([societyId]) =>
          societyId == null
            ? of([])
            : this.api.list(societyId, 0, PAGE_SIZE).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.notices.set(list ?? []);
        this.hasMore.set(list?.length === PAGE_SIZE);
        this.loading.set(false);
      });
  }

  /** Authors edit/delete their own notices; moderators (SECRETARY+) anyone's. */
  protected canChange(permission: string, notice: Notice): boolean {
    return (
      this.auth.can(permission, notice.societyId) &&
      (notice.postedById === this.auth.user()?.id ||
        this.auth.can('NOTICE.POST.MODERATE', notice.societyId))
    );
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected loadMore(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    this.loadingMore.set(true);
    this.api
      .list(societyId, this.page + 1, PAGE_SIZE)
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (list) => {
          if (societyId !== this.ctx.selectedSocietyId()) return;
          this.page++;
          const seen = new Set(this.notices().map((n) => n.id));
          this.notices.update((current) => [...current, ...list.filter((n) => !seen.has(n.id))]);
          this.hasMore.set(list.length === PAGE_SIZE);
        },
        error: () => {}, // reported by the error interceptor
      });
  }

  protected post(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    noticeDialog(this.dialog, { societyId })
      .pipe(filter(Boolean))
      .subscribe((notice) => {
        this.notices.update((list) => [notice, ...list]);
        this.snack.open('Notice posted', undefined, { duration: 3000 });
      });
  }

  protected edit(notice: Notice): void {
    noticeDialog(this.dialog, { societyId: notice.societyId, notice })
      .pipe(filter(Boolean))
      .subscribe((saved) =>
        this.notices.update((list) => list.map((n) => (n.id === saved.id ? saved : n))),
      );
  }

  protected remove(notice: Notice): void {
    confirmDialog(this.dialog, {
      title: 'Delete notice',
      message: `Delete "${notice.title}"? Residents will no longer see it.`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.delete(notice.id)),
      )
      .subscribe({
        next: () => this.notices.update((list) => list.filter((n) => n.id !== notice.id)),
        error: () => {}, // reported by the error interceptor
      });
  }
}
