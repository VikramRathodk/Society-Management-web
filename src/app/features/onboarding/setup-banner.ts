import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { AuthStore } from '../../core/auth/auth.store';
import { OnboardingChecklist } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { setupProgress } from './onboarding-ui';

/**
 * On every page while the selected society is being set up, for whoever runs the setup:
 * "Your society is being set up — 2 of 4 steps done · Continue". Hidden on the setup page itself.
 */
@Component({
  selector: 'app-setup-banner',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    @if (visible() && checklist(); as c) {
      <aside class="banner" role="status">
        <mat-icon aria-hidden="true">construction</mat-icon>
        <p>
          <strong>{{ c.name }} is being set up</strong>
          <span> · {{ progress()?.done }} of {{ progress()?.total }} steps done</span>
          @if (!c.profile.done) {
            <span> · the profile is needed to go live</span>
          }
        </p>
        <a mat-flat-button [routerLink]="['/societies', c.societyId, 'setup']">Continue setup</a>
      </aside>
    }
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding: 10px 16px;
      border-radius: 12px;
      background: var(--app-warning-container);
      color: var(--app-warning);
    }
    p {
      flex: 1 1 240px;
      margin: 0;
    }
  `,
})
export class SetupBanner {
  private readonly api = inject(OnboardingApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly router = inject(Router);

  protected readonly checklist = signal<OnboardingChecklist | null>(null);
  protected readonly progress = computed(() => {
    const c = this.checklist();
    return c ? setupProgress(c) : null;
  });

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The selected society, when it is in Setup and the user can run its setup. */
  private readonly settingUp = computed(() => {
    const society = this.ctx.selectedSociety();
    if (!society || society.status !== 'SETUP') return null;
    return this.auth.can('SOCIETY.SETTINGS.UPDATE', society.id) ? society.id : null;
  });

  protected readonly visible = computed(() => {
    const id = this.settingUp();
    return id !== null && !this.url().startsWith(`/societies/${id}/setup`);
  });

  constructor() {
    // Fetched again on each page change, so the step count follows what was just done.
    effect(() => {
      const id = this.settingUp();
      this.url();
      untracked(() => {
        if (id === null) {
          this.checklist.set(null);
          return;
        }
        this.api.checklist(id).subscribe({
          next: (c) => {
            this.checklist.set(c);
            // Went live elsewhere (another tab, another committee member): refresh the switcher.
            if (c.status === 'LIVE') this.ctx.load().subscribe();
          },
          error: () => this.checklist.set(null),
        });
      });
    });
  }
}
