import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, filter, forkJoin, of, switchMap, tap } from 'rxjs';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { SocietyApi } from '../../core/api/society.api';
import { OnboardingChecklist, SendResult, Society } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { inviteDialog } from '../invitations/invite-dialog';
import { SocietyProfileForm } from '../societies/society-profile-form';
import { SocietyRules } from '../societies/society-rules';
import { missingProfileText, setupProgress } from './onboarding-ui';
import { ResidentImporter } from './resident-importer';
import { SentInvitations } from './sent-invitations';
import { StructureGenerator } from './structure-generator';

export type SetupStep = 'profile' | 'structure' | 'residents' | 'committee' | 'live';

const STEPS: SetupStep[] = ['profile', 'structure', 'residents', 'committee', 'live'];

/**
 * The setup wizard: profile (required), wings and flats, residents from a sheet, committee and key
 * rules, then go live. Every step but the profile can be skipped and finished later from here, and the
 * page stays useful after go-live (bulk flats, another residents sheet).
 */
@Component({
  selector: 'app-setup-wizard',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatusPill,
    SocietyProfileForm,
    SocietyRules,
    StructureGenerator,
    ResidentImporter,
    SentInvitations,
  ],
  templateUrl: './setup-wizard.html',
  styleUrl: './setup-wizard.scss',
})
export class SetupWizard {
  private readonly societies = inject(SocietyApi);
  private readonly api = inject(OnboardingApi);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Bound from the `:id` route param. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly society = signal<Society | null>(null);
  protected readonly checklist = signal<OnboardingChecklist | null>(null);
  protected readonly loading = signal(true);
  protected readonly goingLive = signal(false);
  protected readonly wentLive = signal<SendResult | null | undefined>(undefined);
  protected readonly step = signal<SetupStep>('profile');

  protected readonly live = computed(() => this.society()?.status === 'LIVE');
  protected readonly progress = computed(() => {
    const c = this.checklist();
    return c ? setupProgress(c) : null;
  });
  protected readonly steps = computed(() => {
    const c = this.checklist();
    return [
      {
        key: 'profile' as const,
        label: 'Society profile',
        required: true,
        done: !!c?.profile.done,
        detail: c?.profile.done
          ? 'Complete'
          : `Missing ${missingProfileText(c?.profile.missing ?? [])}`,
      },
      {
        key: 'structure' as const,
        label: 'Wings & flats',
        required: false,
        done: !!c?.structure.done,
        detail: c ? `${c.structure.wings} wings · ${c.structure.flats} flats` : '',
      },
      {
        key: 'residents' as const,
        label: 'Residents',
        required: false,
        done: !!c?.residents.done,
        detail: c ? residentsDetail(c) : '',
      },
      {
        key: 'committee' as const,
        label: 'Committee & rules',
        required: false,
        done: !!c?.committee.done,
        detail: c
          ? `${c.committee.members} members · ${c.committee.openInvitations} invited · ${c.settings.customized} rules changed`
          : '',
      },
      {
        key: 'live' as const,
        label: 'Go live',
        required: false,
        done: c?.status === 'LIVE',
        detail: c?.status === 'LIVE' ? 'Live' : c?.canGoLive ? 'Ready' : 'Needs the profile',
      },
    ];
  });

  constructor() {
    const asked = this.route.snapshot.queryParamMap.get('step') as SetupStep | null;
    if (asked && STEPS.includes(asked)) this.step.set(asked);

    toObservable(this.id)
      .pipe(
        tap((id) => {
          this.loading.set(true);
          // Links to Maintenance, Finance and Invitations work in the selected society.
          if (this.ctx.societies().some((s) => s.id === id)) this.ctx.select(id);
        }),
        switchMap((id) =>
          forkJoin({
            society: this.societies.get(id),
            checklist: this.api.checklist(id),
          }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((loaded) => {
        this.loading.set(false);
        this.society.set(loaded?.society ?? null);
        this.checklist.set(loaded?.checklist ?? null);
        // A society that is live opens on the tools rather than the profile.
        if (!asked && loaded?.society.status === 'LIVE') this.step.set('structure');
      });
  }

  protected go(step: SetupStep): void {
    this.step.set(step);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step },
      replaceUrl: true,
    });
  }

  protected next(): void {
    const at = STEPS.indexOf(this.step());
    if (at < STEPS.length - 1) this.go(STEPS[at + 1]);
  }

  protected refresh(): void {
    this.api.checklist(this.id()).subscribe({
      next: (c) => this.checklist.set(c),
      error: () => {},
    });
  }

  protected profileSaved(society: Society): void {
    const renamed = society.name !== this.society()?.name;
    this.society.set(society);
    this.refresh();
    if (renamed) this.ctx.load().subscribe();
  }

  protected invite(): void {
    inviteDialog(this.dialog, { societyId: this.id() }).subscribe(() => this.refresh());
  }

  protected goLive(): void {
    const c = this.checklist();
    if (!c?.canGoLive || this.goingLive()) return;
    const staged = c.residents.staged;
    confirmDialog(this.dialog, {
      title: `Make ${c.name} live`,
      message:
        (staged
          ? `The ${staged} residents in your sheet get their invitations now. `
          : 'Residents can be invited once it is live. ') + 'This can’t be undone.',
      confirmText: 'Go live',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.goingLive.set(true);
          return this.api.goLive(this.id());
        }),
      )
      .subscribe({
        next: (res) => {
          this.goingLive.set(false);
          this.checklist.set(res.onboarding);
          this.wentLive.set(res.residentInvitations);
          this.society.update((s) =>
            s ? { ...s, status: 'LIVE', wentLiveAt: res.onboarding.wentLiveAt } : s,
          );
          this.snack.open(`${res.onboarding.name} is live`, undefined, { duration: 4000 });
          this.ctx.load().subscribe(); // the Setup banner goes away
        },
        error: () => this.goingLive.set(false),
      });
  }
}

function residentsDetail(c: OnboardingChecklist): string {
  const parts = [`${c.residents.members} residents`];
  if (c.residents.openInvitations) parts.push(`${c.residents.openInvitations} invited`);
  if (c.residents.staged) parts.push(`${c.residents.staged} in the sheet`);
  return parts.join(' · ');
}
