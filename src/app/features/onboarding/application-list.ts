import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { filter, finalize, switchMap } from 'rxjs';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { ApplicationStatus, SocietyApplication } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { nameDialog } from '../../shared/name-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { APPLICATION_STATUS } from './onboarding-ui';

/**
 * Societies that registered from the public site (platform only). The super admin calls the applicant
 * to confirm, then approves (creating the society, account and secretary role) or rejects with a
 * reason the applicant sees.
 */
@Component({
  selector: 'app-application-list',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatusPill,
  ],
  template: `
    <app-page-header title="Registrations" [subtitle]="subtitle()">
      <mat-button-toggle-group
        [ngModel]="status()"
        (ngModelChange)="show($event)"
        aria-label="Show"
        hideSingleSelectionIndicator
      >
        <mat-button-toggle value="PENDING">Waiting</mat-button-toggle>
        <mat-button-toggle value="APPROVED">Approved</mat-button-toggle>
        <mat-button-toggle value="REJECTED">Rejected</mat-button-toggle>
        <mat-button-toggle [value]="null">All</mat-button-toggle>
      </mat-button-toggle-group>
    </app-page-header>

    @if (loading()) {
      <app-skeleton variant="list" />
    } @else if (loadError()) {
      <app-empty-state icon="cloud_off" message="Couldn't load registrations.">
        <button mat-stroked-button (click)="load()">Try again</button>
      </app-empty-state>
    } @else if (applications().length === 0) {
      <app-empty-state
        icon="how_to_reg"
        [message]="status() === 'PENDING' ? 'No registrations waiting' : 'No registrations'"
      />
    } @else {
      <div class="cards">
        @for (a of applications(); track a.id) {
          <app-section padded>
            <article class="application" [attr.aria-label]="a.societyName">
              <div class="top">
                <div>
                  <p class="name">{{ a.societyName }}</p>
                  <p class="muted">
                    #{{ a.id }} · {{ a.city }}
                    @if (a.approxFlats) {
                      · about {{ a.approxFlats }} flats
                    }
                    · {{ a.createdAt | date: 'd MMM y, h:mm a' }}
                  </p>
                </div>
                <app-status-pill [tone]="statusOf(a.status).tone">{{
                  statusOf(a.status).label
                }}</app-status-pill>
              </div>
              @if (a.address) {
                <p>{{ a.address }}</p>
              }
              <p class="applicant">
                <mat-icon aria-hidden="true">person</mat-icon>
                {{ a.applicantName }} ·
                <a [href]="'tel:' + a.applicantPhone">{{ a.applicantPhone }}</a>
                @if (a.applicantEmail) {
                  · <a [href]="'mailto:' + a.applicantEmail">{{ a.applicantEmail }}</a>
                }
                @if (a.existingAccount) {
                  <span class="tag">Has an account</span>
                }
              </p>
              @if (a.message) {
                <blockquote>{{ a.message }}</blockquote>
              }
              @if (a.status === 'PENDING') {
                <div class="actions">
                  <span class="muted">Call to confirm before approving.</span>
                  <span class="spacer"></span>
                  <button mat-button type="button" (click)="reject(a)" [disabled]="busy() === a.id">
                    Reject
                  </button>
                  <button
                    mat-flat-button
                    type="button"
                    (click)="approve(a)"
                    [disabled]="busy() === a.id"
                  >
                    Approve
                  </button>
                </div>
              } @else {
                <p class="muted">
                  {{ statusOf(a.status).label }}
                  @if (a.reviewedByName) {
                    by {{ a.reviewedByName }}
                  }
                  @if (a.reviewedAt) {
                    on {{ a.reviewedAt | date: 'd MMM y' }}
                  }
                  @if (a.reason) {
                    : “{{ a.reason }}”
                  }
                </p>
                @if (a.societyId) {
                  <a mat-stroked-button [routerLink]="['/societies', a.societyId, 'setup']">
                    Open society setup
                  </a>
                }
              }
            </article>
          </app-section>
        }
      </div>
    }
  `,
  styles: `
    .cards {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    p {
      margin: 0 0 6px;
    }
    .top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    .name {
      font: var(--mat-sys-title-medium);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .applicant {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .applicant mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .tag {
      padding: 1px 8px;
      border-radius: 6px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-small);
    }
    blockquote {
      margin: 8px 0;
      padding: 6px 12px;
      border-left: 3px solid var(--mat-sys-outline-variant);
      color: var(--mat-sys-on-surface-variant);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .spacer {
      flex: 1;
    }
  `,
})
export class ApplicationList {
  private readonly api = inject(OnboardingApi);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly status = signal<ApplicationStatus | null>('PENDING');
  protected readonly applications = signal<SocietyApplication[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly busy = signal<number | null>(null);
  protected readonly subtitle = computed(() => {
    if (this.loading()) return null;
    const n = this.applications().length;
    return `${n} ${n === 1 ? 'registration' : 'registrations'}`;
  });

  constructor() {
    this.load();
  }

  protected statusOf(status: ApplicationStatus) {
    return APPLICATION_STATUS[status];
  }

  protected show(status: ApplicationStatus | null): void {
    this.status.set(status);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.api
      .applications(this.status())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => this.applications.set(list),
        error: () => this.loadError.set(true),
      });
  }

  protected approve(a: SocietyApplication): void {
    confirmDialog(this.dialog, {
      title: `Approve ${a.societyName}`,
      message: a.existingAccount
        ? `${a.applicantName} becomes its secretary with their existing account. The society starts in setup.`
        : `This creates ${a.applicantName}'s account with the password they chose and makes them secretary. The society starts in setup.`,
      confirmText: 'Approve',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.busy.set(a.id);
          return this.api.approve(a.id);
        }),
      )
      .subscribe({
        next: (updated) => {
          this.busy.set(null);
          this.replace(updated);
          this.snack.open(
            `${a.societyName} approved. Let ${a.applicantName} know they can sign in.`,
            undefined,
            {
              duration: 5000,
            },
          );
          this.ctx.load().subscribe(); // the new society joins the switcher
        },
        error: () => this.busy.set(null),
      });
  }

  protected reject(a: SocietyApplication): void {
    nameDialog(this.dialog, {
      title: `Reject ${a.societyName}`,
      label: 'Reason (the applicant sees this)',
      confirmText: 'Reject',
      save: (reason) => this.api.reject(a.id, reason),
    }).subscribe((updated) => {
      this.replace(updated);
      this.snack.open(`${a.societyName} rejected`, undefined, { duration: 3000 });
    });
  }

  /** Keeps the card in place in "All"; drops it from a list of another status. */
  private replace(updated: SocietyApplication): void {
    const keep = this.status() === null || this.status() === updated.status;
    this.applications.update((list) =>
      keep
        ? list.map((x) => (x.id === updated.id ? updated : x))
        : list.filter((x) => x.id !== updated.id),
    );
  }
}
