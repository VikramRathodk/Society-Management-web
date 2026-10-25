/**
 * Visitor presentation pieces shared by the gate log and the dashboard. Add further visitor UI here
 * rather than in new files.
 */
import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  Injectable,
  booleanAttribute,
  computed,
  inject,
  input,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Observable, catchError, map, of, shareReplay, switchMap } from 'rxjs';

import { VisitorApi } from '../../core/api/visitor.api';
import { Visitor, VisitorStatus } from '../../core/models';
import { Avatar, StatusPill, Tone } from '../../shared/ui';

/** How each status reads and is coloured everywhere. */
export const VISITOR_STATUS: Record<VisitorStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  ENTERED: { label: 'Inside', tone: 'primary' },
  EXITED: { label: 'Exited', tone: 'neutral' },
};

/** "just now", "12 min ago", "4:05 PM", "Yesterday, 4:05 PM", "18 Oct, 4:05 PM". */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const minutes = Math.max(0, now - date.getTime()) / 60_000;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = dayLabel(iso, now);
  return day === 'Today' ? time : `${day}, ${time}`;
}

/** "Today", "Yesterday" or "Sat 18 Oct". */
export function dayLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Earlier';
  const date = new Date(iso).toDateString();
  if (date === new Date(now).toDateString()) return 'Today';
  if (date === new Date(now - 86_400_000).toDateString()) return 'Yesterday';
  return new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Consecutive visitors (newest first) grouped under their day label. */
export function groupByDay(visitors: Visitor[]): { label: string; visitors: Visitor[] }[] {
  const groups: { label: string; visitors: Visitor[] }[] = [];
  for (const v of visitors) {
    const label = dayLabel(v.loggedAt);
    const last = groups.at(-1);
    if (last?.label === label) last.visitors.push(v);
    else groups.push({ label, visitors: [v] });
  }
  return groups;
}

/**
 * Fetches visitor photos as blobs (they need the auth header) and caches the object URLs for the
 * lifetime of the page that provides it, revoking them when that page is destroyed.
 */
@Injectable()
export class VisitorPhotos {
  private readonly api = inject(VisitorApi);
  private readonly cache = new Map<number, Observable<string | null>>();
  private readonly objectUrls: string[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.objectUrls.forEach((url) => URL.revokeObjectURL(url)));
  }

  url(visitorId: number): Observable<string | null> {
    let url$ = this.cache.get(visitorId);
    if (!url$) {
      url$ = this.api.photo(visitorId).pipe(
        map((blob) => {
          const url = URL.createObjectURL(blob);
          this.objectUrls.push(url);
          return url;
        }),
        catchError(() => of(null)),
        shareReplay(1),
      );
      this.cache.set(visitorId, url$);
    }
    return url$;
  }
}

@Component({
  selector: 'app-visitor-photo-dialog',
  imports: [MatDialogModule],
  template: `<img [src]="data.src" [alt]="data.alt" />`,
  styles: `
    img {
      display: block;
      max-width: 100%;
      max-height: 80vh;
    }
  `,
})
export class VisitorPhotoDialog {
  protected readonly data = inject<{ src: string; alt: string }>(MAT_DIALOG_DATA);
}

/** The visitor's photo (click to enlarge), or their initials. Needs VisitorPhotos provided. */
@Component({
  selector: 'app-visitor-avatar',
  imports: [Avatar],
  template: `
    @if (url(); as src) {
      <button
        type="button"
        class="avatar"
        (click)="open(src)"
        [attr.aria-label]="'View photo of ' + visitor().visitorName"
      >
        <img [src]="src" alt="" />
      </button>
    } @else {
      <app-avatar [name]="visitor().visitorName" [size]="44" />
    }
  `,
  styles: `
    .avatar {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      padding: 0;
      overflow: hidden;
      border: none;
      border-radius: 50%;
      cursor: pointer;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class VisitorAvatar {
  private readonly photos = inject(VisitorPhotos);
  private readonly dialog = inject(MatDialog);

  readonly visitor = input.required<Visitor>();

  protected readonly url = toSignal(
    toObservable(computed(() => (this.visitor().photoUrl ? this.visitor().id : null))).pipe(
      switchMap((id) => (id == null ? of(null) : this.photos.url(id))),
    ),
    { initialValue: null },
  );

  protected open(src: string): void {
    this.dialog.open(VisitorPhotoDialog, {
      data: { src, alt: `Photo of ${this.visitor().visitorName}` },
    });
  }
}

/**
 * One visitor as a list row: avatar, name, flat and purpose, status and time. Actions (buttons)
 * are projected and sit at the end. `compact` drops the who/when trail for dashboards.
 */
@Component({
  selector: 'app-visitor-row',
  imports: [DatePipe, StatusPill, VisitorAvatar],
  template: `
    <app-visitor-avatar [visitor]="visitor()" />
    <div class="main">
      <div class="title">
        <span class="name">{{ visitor().visitorName }}</span>
        @if (visitor().overridden) {
          <app-status-pill
            outline
            [title]="'Decided by ' + visitor().respondedByName + ' for the flat'"
            >Override</app-status-pill
          >
        }
      </div>
      <div class="meta">
        Flat {{ visitor().flatNumber }}
        @if (visitor().purpose) {
          · {{ visitor().purpose }}
        }
        @if (!compact() && visitor().visitorPhone) {
          · {{ visitor().visitorPhone }}
        }
      </div>
      @if (!compact()) {
        <div class="trail">
          <span>Logged by {{ visitor().loggedByName }}</span>
          @if (visitor().respondedByName) {
            <span>
              {{ visitor().status === 'REJECTED' ? 'Rejected' : 'Approved' }} by
              {{ visitor().respondedByName }}
            </span>
          }
          @if (visitor().enteredAt) {
            <span>In {{ visitor().enteredAt | date: 'h:mm a' }}</span>
          }
          @if (visitor().exitedAt) {
            <span>Out {{ visitor().exitedAt | date: 'h:mm a' }}</span>
          }
        </div>
      }
    </div>
    <div class="side">
      <app-status-pill [tone]="status().tone">{{ status().label }}</app-status-pill>
      <span class="time" [title]="visitor().loggedAt | date: 'medium'">{{ when() }}</span>
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 20px;
    }
    .main {
      flex: 1;
      min-width: 0;
    }
    .title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .name {
      font: var(--mat-sys-title-small);
      font-weight: 600;
    }
    .meta,
    .trail {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .meta {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .trail {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 12px;
      margin-top: 2px;
    }
    .side {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }
    .time {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      white-space: nowrap;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .actions:not(:has(*)) {
      display: none;
    }
    @media (max-width: 599.98px) {
      :host {
        flex-wrap: wrap;
        padding: 12px 16px;
      }
      .actions {
        width: 100%;
        justify-content: flex-end;
      }
    }
  `,
})
export class VisitorRow {
  readonly visitor = input.required<Visitor>();
  readonly compact = input(false, { transform: booleanAttribute });

  protected readonly status = computed(() => VISITOR_STATUS[this.visitor().status]);
  protected readonly when = computed(() => timeAgo(this.visitor().loggedAt));
}
