import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of, switchMap, tap } from 'rxjs';

import { GovernanceApi } from '../../core/api/governance.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Meeting, MeetingKind, MeetingView } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { MEETING_KIND, MEETING_STATUS } from './governance-ui';

/** The society's meetings: upcoming, past, and (for the organisers) drafts. */
@Component({
  selector: 'app-meeting-list',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './meeting-list.html',
  styleUrl: './meeting-list.scss',
})
export class MeetingList {
  private readonly api = inject(GovernanceApi);
  private readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly view = signal<MeetingView>(this.initialView());
  protected readonly kind = signal<MeetingKind | null>(null);
  protected readonly meetings = signal<Meeting[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  private readonly attempt = signal(0);

  protected readonly kinds = MEETING_KIND;
  protected readonly status = MEETING_STATUS;
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  protected readonly organises = computed(() =>
    this.auth.can('GOVERNANCE.MEETING.CREATE', this.ctx.selectedSocietyId()),
  );
  protected readonly views = computed(() => {
    const views: { value: MeetingView; label: string }[] = [
      { value: 'upcoming', label: 'Upcoming' },
      { value: 'past', label: 'Past' },
    ];
    if (this.organises()) views.push({ value: 'drafts', label: 'Drafts' });
    return views;
  });

  constructor() {
    toObservable(
      computed(() => ({
        societyId: this.ctx.selectedSocietyId(),
        view: this.view(),
        kind: this.kind(),
        attempt: this.attempt(),
      })),
    )
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(({ societyId, view, kind }) =>
          societyId == null
            ? of([] as Meeting[])
            : this.api
                .list(societyId, view, kind, { silent: true })
                .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.meetings.set(list ?? []);
        this.loading.set(false);
      });
  }

  protected setView(view: MeetingView | null): void {
    if (!view) return;
    this.view.set(view);
    this.router.navigate([], {
      queryParams: { view: view === 'upcoming' ? null : view },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected votingOpen(m: Meeting): number {
    return m.agenda.filter((i) => i.canVote).length;
  }

  protected emptyMessage(): string {
    switch (this.view()) {
      case 'past':
        return 'No past meetings.';
      case 'drafts':
        return 'No drafts.';
      default:
        return 'No meetings coming up.';
    }
  }

  private initialView(): MeetingView {
    const raw = this.route.snapshot.queryParamMap.get('view');
    return raw === 'past' || raw === 'drafts' ? raw : 'upcoming';
  }
}
