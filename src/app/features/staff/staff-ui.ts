import { Component, DestroyRef, Injectable, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { Observable, catchError, forkJoin, map, of, shareReplay, switchMap } from 'rxjs';

import { StaffApi } from '../../core/api/staff.api';
import { StructureApi } from '../../core/api/structure.api';
import { AuthStore } from '../../core/auth/auth.store';
import { DayOfWeek, IdType, Staff, StaffCard, StaffLink, StaffType } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { Avatar, StatusPill, Tone } from '../../shared/ui';
import { escapeHtml, qrDataUrl } from '../invitations/invitation-ui';

export const STAFF_TYPES: { value: StaffType; label: string }[] = [
  { value: 'MAID', label: 'Maid' },
  { value: 'COOK', label: 'Cook' },
  { value: 'DRIVER', label: 'Driver' },
  { value: 'NANNY', label: 'Nanny' },
  { value: 'CLEANER', label: 'Cleaner' },
  { value: 'GUARD', label: 'Guard' },
  { value: 'HOUSEKEEPING', label: 'Housekeeping' },
  { value: 'GARDENER', label: 'Gardener' },
  { value: 'PLUMBER', label: 'Plumber' },
  { value: 'ELECTRICIAN', label: 'Electrician' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'OTHER', label: 'Other' },
];

export const ID_TYPES: { value: IdType; label: string }[] = [
  { value: 'AADHAAR', label: 'Aadhaar' },
  { value: 'PAN', label: 'PAN' },
  { value: 'DRIVING_LICENCE', label: 'Driving licence' },
  { value: 'VOTER_ID', label: 'Voter ID' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'OTHER', label: 'Other' },
];

export const DAYS: { value: DayOfWeek; short: string }[] = [
  { value: 'MONDAY', short: 'Mon' },
  { value: 'TUESDAY', short: 'Tue' },
  { value: 'WEDNESDAY', short: 'Wed' },
  { value: 'THURSDAY', short: 'Thu' },
  { value: 'FRIDAY', short: 'Fri' },
  { value: 'SATURDAY', short: 'Sat' },
  { value: 'SUNDAY', short: 'Sun' },
];

export function typeLabel(type: StaffType): string {
  return STAFF_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function idTypeLabel(type: IdType | null): string {
  return ID_TYPES.find((t) => t.value === type)?.label ?? 'ID';
}

/** "08:00:00" → "08:00". */
export function hhmm(time: string | null): string {
  return time ? time.slice(0, 5) : '';
}

/** "Mon, Wed · 08:00–09:30", or '' when nothing is said. */
export function scheduleLabel(link: Pick<StaffLink, 'days' | 'timeFrom' | 'timeTo'>): string {
  const days =
    link.days.length === 7
      ? 'Every day'
      : DAYS.filter((d) => link.days.includes(d.value))
          .map((d) => d.short)
          .join(', ');
  const time =
    link.timeFrom || link.timeTo ? [hhmm(link.timeFrom), hhmm(link.timeTo)].filter(Boolean).join('–') : '';
  return [days, time].filter(Boolean).join(' · ');
}

/** "3 h 30 min". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The label and tone for a person's state; blocked wins over the verification status. */
export function staffState(staff: Pick<Staff, 'blocked' | 'status'>): { label: string; tone: Tone; icon: string } {
  if (staff.blocked) return { label: 'Blocked', tone: 'danger', icon: 'block' };
  switch (staff.status) {
    case 'VERIFIED':
      return { label: 'Verified', tone: 'success', icon: 'verified' };
    case 'PENDING':
      return { label: 'Awaiting verification', tone: 'warning', icon: 'hourglass_top' };
    case 'REJECTED':
      return { label: 'Not verified', tone: 'danger', icon: 'gpp_bad' };
  }
}

/** "2026-11" for a date (local). */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

@Component({
  selector: 'app-staff-state',
  imports: [StatusPill],
  template: `<app-status-pill [tone]="state().tone" [icon]="state().icon">{{ state().label }}</app-status-pill>`,
})
export class StaffStatePill {
  readonly staff = input.required<Pick<Staff, 'blocked' | 'status'>>();
  protected readonly state = computed(() => staffState(this.staff()));
}

/** Loads staff photos once per page (they need the auth header). */
@Injectable()
export class StaffPhotos {
  private readonly api = inject(StaffApi);
  private readonly cache = new Map<string, Observable<string | null>>();
  private readonly objectUrls: string[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.objectUrls.forEach((url) => URL.revokeObjectURL(url)));
  }

  /** `version` busts the cache after a new photo is uploaded. */
  url(staffId: number, version = ''): Observable<string | null> {
    const key = `${staffId}:${version}`;
    let url$ = this.cache.get(key);
    if (!url$) {
      url$ = this.api.photo(staffId).pipe(
        map((blob) => {
          const url = URL.createObjectURL(blob);
          this.objectUrls.push(url);
          return url;
        }),
        catchError(() => of(null)),
        shareReplay(1),
      );
      this.cache.set(key, url$);
    }
    return url$;
  }
}

/** The person's photo, or their initials when there is none. Needs StaffPhotos provided above it. */
@Component({
  selector: 'app-staff-photo',
  imports: [Avatar],
  template: `
    @if (src(); as url) {
      <img [src]="url" [alt]="name()" [style.width.px]="size()" [style.height.px]="size()" />
    } @else {
      <app-avatar [name]="name()" [size]="size()" />
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    img {
      border-radius: 50%;
      object-fit: cover;
    }
  `,
})
export class StaffPhoto {
  private readonly photos = inject(StaffPhotos);
  readonly staffId = input.required<number>();
  readonly name = input.required<string>();
  readonly hasPhoto = input(false);
  readonly size = input(40);
  readonly version = input('');

  protected readonly src = toSignal(
    toObservable(computed(() => ({ id: this.staffId(), has: this.hasPhoto(), v: this.version() }))).pipe(
      switchMap(({ id, has, v }) => (has ? this.photos.url(id, v) : of(null))),
    ),
    { initialValue: null },
  );
}

@Component({
  selector: 'app-staff-type-icon',
  imports: [MatIconModule],
  template: `<mat-icon aria-hidden="true">{{ icon() }}</mat-icon>`,
})
export class StaffTypeIcon {
  readonly type = input.required<StaffType>();
  protected readonly icon = computed(() => typeIcon(this.type()));
}

export function typeIcon(type: StaffType): string {
  switch (type) {
    case 'COOK':
      return 'soup_kitchen';
    case 'DRIVER':
      return 'directions_car';
    case 'NANNY':
      return 'child_care';
    case 'GUARD':
      return 'security';
    case 'GARDENER':
      return 'yard';
    case 'PLUMBER':
      return 'plumbing';
    case 'ELECTRICIAN':
      return 'electrical_services';
    case 'MANAGER':
      return 'manage_accounts';
    default:
      return 'cleaning_services';
  }
}

export interface FlatOption {
  id: number;
  label: string;
}

/** The signed-in user's own flats in the selected society, labelled "A-101". */
@Injectable()
export class OwnFlats {
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly structure = inject(StructureApi);

  readonly ids = computed(() => {
    const societyId = this.ctx.selectedSocietyId();
    return [
      ...new Set(
        (this.auth.user()?.roles ?? [])
          .filter((r) => r.societyId === societyId && r.flatId != null)
          .map((r) => r.flatId!),
      ),
    ];
  });

  /** undefined while loading. */
  readonly flats = toSignal(
    toObservable(this.ids).pipe(switchMap((ids) => (ids.length ? this.label(ids) : of([])))),
  );

  private label(ids: number[]): Observable<FlatOption[]> {
    return forkJoin(
      ids.map((id) =>
        this.structure.getFlat(id).pipe(
          switchMap((flat) =>
            this.structure.getWing(flat.wingId).pipe(
              map((wing) => ({ id, label: `${wing.name}-${flat.flatNumber}` })),
              catchError(() => of({ id, label: flat.flatNumber })),
            ),
          ),
          catchError(() => of({ id, label: `Flat #${id}` })),
        ),
      ),
    ).pipe(map((list) => [...list].sort((a, b) => a.label.localeCompare(b.label))));
  }
}

/** A blob as a data URL, so it survives into the print window. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Fetches the card data and photo, then opens the print window. */
export function printCardFor(api: StaffApi, staff: Pick<Staff, 'id' | 'photoUrl'>): void {
  forkJoin({
    card: api.card(staff.id),
    photo: staff.photoUrl ? api.photo(staff.id).pipe(catchError(() => of(null))) : of(null),
  }).subscribe(async ({ card, photo }) => {
    await printStaffCard(card, photo ? await blobToDataUrl(photo) : null);
  });
}

/** Opens a window with the printable ID card: photo, name, type, flats, the code and its QR. */
export async function printStaffCard(card: StaffCard, photo: string | null): Promise<void> {
  const qr = await qrDataUrl(card.qrPayload, 360);
  const win = window.open('', '_blank', 'width=480,height=640');
  if (!win) return;
  const role = card.designation || typeLabel(card.staffType);
  const flats = card.flats.length ? `Works for ${card.flats.join(', ')}` : card.kind === 'SOCIETY' ? 'Society staff' : '';
  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>ID card · ${escapeHtml(card.name)}</title>
<style>
  @page { margin: 12mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f1b16; margin: 0; }
  .card { width: 86mm; margin: 0 auto; padding: 16px; border: 1px solid #d6c8b8; border-radius: 12px; text-align: center; }
  .society { font-size: 15px; font-weight: 700; margin: 0 0 12px; }
  .photo { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; background: #eee; }
  .name { font-size: 20px; font-weight: 700; margin: 10px 0 2px; }
  .role, .flats { margin: 0; color: #52443a; font-size: 13px; }
  .qr { width: 150px; height: 150px; margin-top: 10px; image-rendering: pixelated; }
  .code { font-size: 26px; letter-spacing: 6px; font-weight: 700; margin: 4px 0 0; font-variant-numeric: tabular-nums; }
  .hint { margin: 2px 0 0; font-size: 11px; color: #52443a; }
</style></head>
<body><div class="card">
  <p class="society">${escapeHtml(card.societyName)}</p>
  ${photo ? `<img class="photo" src="${photo}" alt="">` : ''}
  <p class="name">${escapeHtml(card.name)}</p>
  <p class="role">${escapeHtml(role)}</p>
  ${flats ? `<p class="flats">${escapeHtml(flats)}</p>` : ''}
  <img class="qr" src="${qr}" alt="QR code">
  <p class="code">${escapeHtml(card.entryCode)}</p>
  <p class="hint">Show at the gate, or say this code</p>
</div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`);
  win.document.close();
}
