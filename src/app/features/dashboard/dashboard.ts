import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { StructureApi } from '../../core/api/structure.api';
import { UserApi } from '../../core/api/user.api';
import { VisitorApi } from '../../core/api/visitor.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { SocietyContextStore } from '../../core/society-context/society-context.store';

/** The API caps a page at 100 and returns no totals, so larger counts show as "100+". */
const MAX = 100;

interface StatCard {
  label: string;
  icon: string;
  link: string;
  queryParams?: Record<string, string>;
  /** Resolves to the number to show; undefined when it couldn't be loaded. */
  count: Observable<number | undefined>;
}

interface LoadedCard extends Omit<StatCard, 'count'> {
  /** null while loading, '—' if it failed. */
  value: string | null;
}

/** Cards built from the user's permissions in the selected society. */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, HasPermission],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly visitorApi = inject(VisitorApi);
  private readonly userApi = inject(UserApi);
  private readonly structureApi = inject(StructureApi);
  protected readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly cards = signal<LoadedCard[]>([]);

  constructor() {
    toObservable(this.ctx.selectedSocietyId)
      .pipe(
        map((societyId) => this.cardsFor(societyId)),
        switchMap((cards) => {
          this.cards.set(cards.map(({ count: _, ...card }) => ({ ...card, value: null })));
          if (!cards.length) return of([]);
          return forkJoin(cards.map((c) => c.count));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((counts) =>
        this.cards.update((cards) =>
          cards.map((card, i) => ({ ...card, value: display(counts[i]) })),
        ),
      );
  }

  private cardsFor(societyId: number | null): StatCard[] {
    const can = (permission: string) => this.auth.can(permission, societyId);
    const settle = (source: Observable<unknown[]>) =>
      source.pipe(
        map((list) => list.length),
        catchError(() => of(undefined)),
      );
    const visitors = (status?: 'PENDING' | 'ENTERED') =>
      this.visitorApi.list({ societyId, status, page: 0, size: MAX }, { silent: true });

    const cards: StatCard[] = [];
    if (can('VISITOR.ENTRY.VIEW')) {
      cards.push(
        {
          label: 'Waiting for approval',
          icon: 'hourglass_top',
          link: '/visitors',
          queryParams: { status: 'PENDING' },
          count: settle(visitors('PENDING')),
        },
        {
          label: 'Inside now',
          icon: 'login',
          link: '/visitors',
          queryParams: { status: 'ENTERED' },
          count: settle(visitors('ENTERED')),
        },
        {
          label: 'Logged today',
          icon: 'today',
          link: '/visitors',
          count: settle(visitors().pipe(map((list) => list.filter((v) => isToday(v.loggedAt))))),
        },
      );
    }
    if (can('USER.ACCOUNT.VIEW')) {
      cards.push({
        label: 'Users',
        icon: 'group',
        link: '/users',
        count: settle(this.userApi.list(societyId)),
      });
    }
    if (can('FLAT.DIRECTORY.VIEW') && societyId != null) {
      cards.push({
        label: 'Wings',
        icon: 'domain',
        link: '/structure',
        count: settle(this.structureApi.wings(societyId)),
      });
    }
    return cards;
  }
}

function display(count: number | undefined): string {
  if (count === undefined) return '—';
  return count >= MAX ? `${MAX}+` : String(count);
}

function isToday(iso: string | null): boolean {
  return !!iso && new Date(iso).toDateString() === new Date().toDateString();
}
