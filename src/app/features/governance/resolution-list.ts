import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, of, switchMap, tap } from 'rxjs';

import { GovernanceApi } from '../../core/api/governance.api';
import { Outcome, Resolution } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton, StatusPill } from '../../shared/ui';
import { MEETING_KIND, OUTCOME } from './governance-ui';

/** The resolutions register: what the society decided, searchable, latest first. */
@Component({
  selector: 'app-resolution-list',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusPill,
  ],
  template: `
    <app-page-header
      title="Resolutions"
      [subtitle]="ctx.selectedSociety()?.name ?? null"
      back="/meetings"
      backLabel="Meetings"
    />

    <div class="toolbar">
      <mat-chip-listbox
        aria-label="Outcome"
        [hideSingleSelectionIndicator]="true"
        (change)="outcome.set($event.value ?? 'PASSED')"
      >
        @for (o of outcomes; track o.value) {
          <mat-chip-option [value]="o.value" [selected]="outcome() === o.value">{{
            o.label
          }}</mat-chip-option>
        }
      </mat-chip-listbox>
      <mat-form-field appearance="outline" class="search" subscriptSizing="dynamic">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Search number, title or text</mat-label>
        <input matInput [value]="query()" (input)="query.set($any($event.target).value)" />
      </mat-form-field>
    </div>

    @if (loading() && items().length === 0) {
      <app-skeleton variant="list" />
    } @else if (loadError()) {
      <app-empty-state icon="cloud_off" message="Couldn't load resolutions.">
        <button mat-stroked-button (click)="retry()">Try again</button>
      </app-empty-state>
    } @else if (items().length === 0) {
      <app-empty-state icon="gavel" message="No resolutions here yet." />
    } @else {
      <div class="list">
        @for (r of items(); track r.itemId) {
          <a class="item" [routerLink]="['/meetings', r.meetingId]">
            <div class="head">
              @if (r.resolutionNumber) {
                <span class="number">{{ r.resolutionNumber }}</span>
              }
              <strong>{{ r.title }}</strong>
              <app-status-pill
                [tone]="outcomeOf(r.outcome).tone"
                [icon]="outcomeOf(r.outcome).icon"
                >{{ outcomeOf(r.outcome).label }}</app-status-pill
              >
            </div>
            @if (r.resolutionText) {
              <p>{{ r.resolutionText }}</p>
            }
            <div class="meta">
              {{ kinds[r.meetingKind].short }} · {{ r.meetingTitle }} ·
              {{ r.meetingAt | date: 'd MMM y' }}
              @if (r.results; as v) {
                · for {{ v.votesFor }}, against {{ v.votesAgainst }}, abstained {{ v.abstained }}
              }
            </div>
          </a>
        }
      </div>
    }
  `,
  styles: `
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 16px;
      margin-bottom: 16px;
    }
    .search {
      flex: 1 1 260px;
      max-width: 420px;
    }
    .list {
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      overflow: hidden;
    }
    .item {
      display: block;
      padding: 12px 16px;
      color: inherit;
      text-decoration: none;
      &:hover,
      &:focus-visible {
        background: var(--mat-sys-surface-container-low);
      }
      & + & {
        border-top: 1px solid var(--mat-sys-surface-container-high);
      }
      p {
        margin: 6px 0;
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
    }
    .number {
      padding: 1px 8px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-medium);
    }
    .meta {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class ResolutionList {
  private readonly api = inject(GovernanceApi);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly outcome = signal<Outcome | 'all'>('PASSED');
  protected readonly query = signal('');
  protected readonly items = signal<Resolution[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  private readonly attempt = signal(0);

  protected readonly kinds = MEETING_KIND;
  protected readonly outcomes: { value: Outcome | 'all'; label: string }[] = [
    { value: 'PASSED', label: 'Passed' },
    { value: 'REJECTED', label: 'Not passed' },
    { value: 'DEFERRED', label: 'Deferred' },
    { value: 'all', label: 'All' },
  ];
  protected readonly outcomeOf = (o: Outcome) => OUTCOME[o];

  constructor() {
    toObservable(
      computed(() => ({
        societyId: this.ctx.selectedSocietyId(),
        outcome: this.outcome(),
        q: this.query(),
        attempt: this.attempt(),
      })),
    )
      .pipe(
        debounceTime(150),
        tap(() => this.loading.set(true)),
        switchMap(({ societyId, outcome, q }) =>
          societyId == null
            ? of([] as Resolution[])
            : this.api.resolutions(societyId, q, outcome).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.loadError.set(list === null);
        this.items.set(list ?? []);
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }
}
