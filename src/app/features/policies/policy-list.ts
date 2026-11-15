import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, filter, forkJoin, of, switchMap, tap } from 'rxjs';

import { PolicyApi } from '../../core/api/policy.api';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { PolicyCategory, PolicyFilter, PolicySummary } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { VERSION_STATUS, categoriesDialog } from './policy-ui';

interface View {
  value: PolicyFilter;
  label: string;
  /** Only for the committee (drafters). */
  drafters?: boolean;
}

const VIEWS: View[] = [
  { value: 'published', label: 'In force' },
  { value: 'drafts', label: 'Drafts', drafters: true },
  { value: 'awaiting-approval', label: 'Awaiting approval', drafters: true },
  { value: 'archived', label: 'Archived' },
];

interface Group {
  category: PolicyCategory;
  policies: PolicySummary[];
}

/**
 * The society's rule book, grouped by category, with search. The committee also sees drafts and what
 * waits for approval; residents see which policies they still have to accept.
 */
@Component({
  selector: 'app-policy-list',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    HasPermission,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './policy-list.html',
  styleUrl: './policy-list.scss',
})
export class PolicyList {
  private readonly api = inject(PolicyApi);
  private readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly view = signal<PolicyFilter>(this.initialView());
  protected readonly query = signal(this.route.snapshot.queryParamMap.get('q') ?? '');
  protected readonly categoryId = signal<number | null>(null);
  protected readonly policies = signal<PolicySummary[]>([]);
  protected readonly categories = signal<PolicyCategory[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  private readonly attempt = signal(0);

  protected readonly status = VERSION_STATUS;
  protected readonly subtitle = computed(() => this.ctx.selectedSociety()?.name ?? null);
  protected readonly canDraft = computed(() =>
    this.auth.can('POLICY.RULE.CREATE', this.ctx.selectedSocietyId()),
  );
  protected readonly views = computed(() => VIEWS.filter((v) => !v.drafters || this.canDraft()));
  /** Published policies the caller still has to accept. */
  protected readonly toAccept = computed(() =>
    this.view() === 'published'
      ? this.policies().filter(
          (p) => p.yourAcknowledgement && !p.yourAcknowledgement.acknowledgedAt,
        )
      : [],
  );
  /** Policies under their category headings, in page order (the backend sorts them). */
  protected readonly groups = computed<Group[]>(() => {
    const groups: Group[] = [];
    for (const p of this.policies()) {
      const last = groups[groups.length - 1];
      if (last?.category.id === p.category.id) last.policies.push(p);
      else groups.push({ category: p.category, policies: [p] });
    }
    return groups;
  });
  protected readonly filtered = computed(
    () => this.query().trim() !== '' || this.categoryId() != null,
  );

  constructor() {
    toObservable(
      computed(() => ({
        societyId: this.ctx.selectedSocietyId(),
        view: this.view(),
        q: this.query(),
        categoryId: this.categoryId(),
        attempt: this.attempt(),
      })),
    )
      .pipe(
        debounceTime(150),
        tap(() => this.loading.set(true)),
        switchMap(({ societyId, view, q, categoryId }) =>
          societyId == null
            ? of({ list: [] as PolicySummary[], categories: [] as PolicyCategory[] })
            : forkJoin({
                list: this.api.list(societyId, { filter: view, q, categoryId }, { silent: true }),
                categories: this.api.categories(societyId),
              }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loadError.set(result === null);
        this.policies.set(result?.list ?? []);
        this.categories.set(result?.categories ?? []);
        this.loading.set(false);
      });
  }

  protected setView(view: PolicyFilter | null): void {
    if (!view) return;
    this.view.set(view);
    this.router.navigate([], {
      queryParams: { view: view === 'published' ? null : view },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected clearFilters(): void {
    this.query.set('');
    this.categoryId.set(null);
  }

  protected manageCategories(): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    categoriesDialog(this.dialog, { societyId, categories: this.categories() })
      .pipe(filter(Boolean))
      .subscribe(() => this.retry());
  }

  protected emptyMessage(): string {
    if (this.filtered()) return 'No policies match.';
    switch (this.view()) {
      case 'drafts':
        return 'No drafts.';
      case 'awaiting-approval':
        return 'Nothing is waiting for approval.';
      case 'archived':
        return 'No archived policies.';
      default:
        return 'No rules published yet.';
    }
  }

  private initialView(): PolicyFilter {
    const raw = this.route.snapshot.queryParamMap.get('view');
    return VIEWS.some((v) => v.value === raw) ? (raw as PolicyFilter) : 'published';
  }
}
