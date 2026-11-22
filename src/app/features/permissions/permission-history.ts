import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { SocietyPermissionApi } from '../../core/api/society-permission.api';
import { PermissionHistoryEntry, PermissionHistoryQuery } from '../../core/models';
import { saveResponse } from '../../shared/export-dialog';
import { EmptyState, Skeleton, StatusPill, Tone } from '../../shared/ui';
import { codeLabel } from './permission-draft';

/**
 * The society's permission history, newest first, with date and role filters and a CSV download.
 * Give `userId` to show one person's history only (the role filter is then hidden).
 */
@Component({
  selector: 'app-permission-history',
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    EmptyState,
    Skeleton,
    StatusPill,
  ],
  template: `
    <div class="filters">
      @if (userId() == null) {
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Changes to</mat-label>
          <mat-select [(ngModel)]="role" (selectionChange)="load()">
            <mat-option [value]="null">Roles and people</mat-option>
            @for (r of roles(); track r.code) {
              <mat-option [value]="r.code">{{ r.name }} role</mat-option>
            }
          </mat-select>
        </mat-form-field>
      }
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>From</mat-label>
        <input matInput type="date" [(ngModel)]="from" (change)="load()" />
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>To</mat-label>
        <input matInput type="date" [(ngModel)]="to" (change)="load()" />
      </mat-form-field>
      <span class="spacer"></span>
      <button
        mat-stroked-button
        (click)="download()"
        [disabled]="downloading() || !entries().length"
      >
        <mat-icon>download</mat-icon>
        CSV
      </button>
    </div>

    @if (loading()) {
      <app-skeleton variant="rows" [count]="4" />
    } @else {
      <ul class="lines">
        @for (e of entries(); track e.id) {
          <li>
            <app-status-pill [tone]="tone(e)">{{ changeLabel(e) }}</app-status-pill>
            <div class="text">
              <div>
                @if (e.permission) {
                  <strong>{{ label(e.permission) }}</strong>
                } @else {
                  <strong>Back to the default</strong>
                }
                @if (userId() == null) {
                  <span class="muted">
                    ·
                    {{
                      e.targetType === 'ROLE'
                        ? roleName(e.role) + ' role'
                        : (e.userName ?? 'Someone')
                    }}
                  </span>
                }
              </div>
              <div class="muted small">
                {{ e.changedAt | date: 'd MMM y, h:mm a' }} · {{ e.changedByName ?? 'System' }}
                @if (e.reason) {
                  · “{{ e.reason }}”
                }
              </div>
            </div>
          </li>
        } @empty {
          <app-empty-state icon="history" message="No permission changes yet." />
        }
      </ul>
    }
  `,
  styles: `
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      margin-bottom: 12px;
    }
    .spacer {
      flex: 1;
    }
    .lines {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 10px 0;
      border-bottom: 1px solid var(--app-card-border);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .small {
      font: var(--mat-sys-body-small);
    }
  `,
})
export class PermissionHistory {
  private readonly api = inject(SocietyPermissionApi);

  readonly societyId = input.required<number>();
  readonly userId = input<number | null>(null);
  /** For the role filter and labels. */
  readonly roles = input<readonly { code: string; name: string }[]>([]);
  /** Bump to reload after a change elsewhere on the page. */
  readonly refresh = input(0);

  protected readonly entries = signal<PermissionHistoryEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly downloading = signal(false);
  protected role: string | null = null;
  protected from = '';
  protected to = '';

  protected readonly label = codeLabel;

  constructor() {
    effect(() => {
      this.societyId();
      this.userId();
      this.refresh();
      this.load();
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.api.history(this.societyId(), this.query()).subscribe({
      next: (list) => {
        this.entries.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false), // reported by the error interceptor
    });
  }

  protected download(): void {
    this.downloading.set(true);
    this.api.exportHistory(this.societyId(), this.query()).subscribe({
      next: (res) => {
        this.downloading.set(false);
        saveResponse(res, 'permission-history.csv');
      },
      error: () => this.downloading.set(false),
    });
  }

  protected roleName(code: string | null): string {
    return this.roles().find((r) => r.code === code)?.name ?? code ?? '';
  }

  protected changeLabel(e: PermissionHistoryEntry): string {
    return e.change === 'GRANTED' ? 'Added' : e.change === 'REVOKED' ? 'Removed' : 'Reset';
  }

  protected tone(e: PermissionHistoryEntry): Tone {
    return e.change === 'GRANTED' ? 'success' : e.change === 'REVOKED' ? 'danger' : 'neutral';
  }

  private query(): PermissionHistoryQuery {
    return {
      userId: this.userId(),
      role: this.userId() == null ? this.role : null,
      from: this.from || null,
      to: this.to || null,
    };
  }
}
