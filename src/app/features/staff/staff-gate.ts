import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { Observable, catchError, filter, interval, of, switchMap } from 'rxjs';

import { StaffApi } from '../../core/api/staff.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { GateResult } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { EmptyState, PageHeader, Skeleton } from '../../shared/ui';
import { StaffPhoto, StaffPhotos, scheduleLabel, typeLabel } from './staff-ui';

const REFRESH_MS = 15_000;

/** The browser's BarcodeDetector (Chrome, Edge, Android); not in every browser or in TypeScript's DOM types. */
interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

export function barcodeDetector(): DetectorConstructor | null {
  return (globalThis as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector ?? null;
}

/** Points the camera at the ID card's QR and closes with its text. */
@Component({
  selector: 'app-scan-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Scan the ID card</h2>
    <mat-dialog-content>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else {
        <video #video autoplay playsinline muted></video>
        <p class="hint">Hold the card's QR code in front of the camera.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
    </mat-dialog-actions>
  `,
  styles: `
    video {
      display: block;
      width: 100%;
      max-height: 60vh;
      border-radius: 8px;
      background: #000;
    }
    .hint {
      margin: 8px 0 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ScanDialog implements OnDestroy {
  private readonly ref = inject<MatDialogRef<ScanDialog, string>>(MatDialogRef);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  protected readonly error = signal<string | null>(null);
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.start();
  }

  private async start(): Promise<void> {
    const Detector = barcodeDetector();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      this.error.set("This browser can't scan codes. Type the 6-digit code instead.");
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      this.error.set('The camera could not be opened. Allow camera access, or type the code.');
      return;
    }
    const detector = new Detector({ formats: ['qr_code'] });
    // The <video> appears once the view has rendered.
    setTimeout(() => {
      const video = this.video()?.nativeElement;
      if (!video || !this.stream) return;
      video.srcObject = this.stream;
      this.timer = setInterval(async () => {
        if (video.readyState < 2) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) this.ref.close(codes[0].rawValue);
        } catch {
          // Try the next frame.
        }
      }, 300);
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

/**
 * The gate for staff: the guard types a person's 6-digit code (or scans their card, or searches by
 * name), sees whether they may come in and why not, and checks them in and out. Below, who is inside.
 */
@Component({
  selector: 'app-staff-gate',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    Skeleton,
    StaffPhoto,
  ],
  providers: [StaffPhotos],
  template: `
    @if (!embedded()) {
      <app-page-header title="Staff at the gate" [subtitle]="ctx.selectedSociety()?.name ?? null">
        @if (canVisitors()) {
          <a mat-stroked-button routerLink="/gate">
            <mat-icon>badge</mat-icon>
            Visitors
          </a>
        }
      </app-page-header>
    }

    <div class="finder">
      <mat-form-field appearance="outline" class="code" subscriptSizing="dynamic">
        <mat-label>Entry code</mat-label>
        <input
          #codeInput
          matInput
          inputmode="numeric"
          autocomplete="off"
          maxlength="6"
          [value]="code()"
          (input)="onCode($event)"
          (keydown.enter)="findByCode()"
          cdkFocusInitial
        />
      </mat-form-field>
      @if (canScan) {
        <button mat-stroked-button class="big" (click)="scan()">
          <mat-icon>qr_code_scanner</mat-icon>
          Scan card
        </button>
      }
      <mat-form-field appearance="outline" class="search" subscriptSizing="dynamic">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Or find by name</mat-label>
        <input matInput type="search" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.enter)="findByName()" />
      </mat-form-field>
      <button mat-stroked-button class="big" (click)="findByName()" [disabled]="query().trim().length < 2">Find</button>
    </div>

    @if (searchError(); as message) {
      <p class="search-error" role="alert">{{ message }}</p>
    }

    @if (results(); as list) {
      <section class="results" aria-label="Found">
        @for (r of list; track r.staff.id) {
          <article class="person" [attr.data-state]="stateOf(r)">
            <app-staff-photo [staffId]="r.staff.id" [name]="r.staff.name" [hasPhoto]="!!r.staff.photoUrl" [size]="72" />
            <div class="who">
              <strong>{{ r.staff.name }}</strong>
              <span class="meta">{{ r.staff.society?.designation || typeLabel(r.staff.staffType) }}</span>
              @for (l of r.staff.links; track l.id) {
                <span class="meta">{{ l.flat }}{{ l.work ? ' · ' + l.work : '' }}{{ scheduleLabel(l) ? ' · ' + scheduleLabel(l) : '' }}</span>
              }
              @if (r.refusal) {
                <p class="refusal" role="alert"><mat-icon>block</mat-icon>{{ r.refusal }}</p>
              } @else if (r.inside) {
                <p class="inside"><mat-icon>door_open</mat-icon>Inside since {{ r.inAt | date: 'HH:mm' }}</p>
              }
            </div>
            <div class="actions">
              @if (r.inside) {
                <button mat-stroked-button class="big" (click)="checkOut(r)" [disabled]="busy().has(r.staff.id)">
                  <mat-icon>logout</mat-icon>
                  Check out
                </button>
              } @else if (r.allowed && canCheck()) {
                <button mat-flat-button class="big" (click)="checkIn(r)" [disabled]="busy().has(r.staff.id)">
                  <mat-icon>login</mat-icon>
                  Check in
                </button>
              }
            </div>
          </article>
        } @empty {
          <p class="quiet">Nobody found. Check the code, or search by name.</p>
        }
      </section>
    }

    <section class="lane" aria-label="Inside now">
      <header>
        <h2>Staff inside <span class="count">{{ inside().length }}</span></h2>
        <span class="live"><span class="dot" [class.stale]="stale()"></span>{{ stale() ? "Couldn't refresh" : 'Live' }}</span>
      </header>
      @if (loadingInside()) {
        <app-skeleton variant="list" [count]="3" />
      } @else {
        @for (r of inside(); track r.staff.id) {
          <div class="row">
            <app-staff-photo [staffId]="r.staff.id" [name]="r.staff.name" [hasPhoto]="!!r.staff.photoUrl" />
            <div class="who">
              <strong>{{ r.staff.name }}</strong>
              <span class="meta">
                {{ typeLabel(r.staff.staffType) }} · {{ flatsOf(r) }} · since {{ r.inAt | date: 'HH:mm' }}
              </span>
              @if (r.staff.blocked) {
                <span class="refusal small">Blocked: {{ r.staff.blockReason }}</span>
              }
            </div>
            @if (canCheck()) {
              <button mat-stroked-button (click)="checkOut(r)" [disabled]="busy().has(r.staff.id)">Check out</button>
            }
          </div>
        } @empty {
          <app-empty-state icon="door_front" message="No staff inside right now." />
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .finder {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .code {
      width: 200px;
    }
    .code input {
      font-size: 1.6rem;
      letter-spacing: 6px;
      font-variant-numeric: tabular-nums;
    }
    .search {
      flex: 1 1 220px;
      max-width: 360px;
    }
    .big {
      --mat-button-filled-container-height: 52px;
      --mat-button-outlined-container-height: 52px;
      min-width: 120px;
      font-size: 1rem;
    }
    .search-error {
      margin: 0 0 16px;
      color: var(--mat-sys-error);
    }
    .results {
      display: grid;
      gap: 12px;
      margin-bottom: 24px;
    }
    .person {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      border: 2px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
    }
    .person[data-state='allowed'] {
      border-color: var(--app-success);
    }
    .person[data-state='refused'] {
      border-color: var(--mat-sys-error);
      background: var(--mat-sys-error-container);
    }
    .who {
      display: grid;
      flex: 1;
      gap: 2px;
      min-width: 0;
    }
    .who strong {
      font: var(--mat-sys-title-large);
    }
    .meta {
      color: var(--mat-sys-on-surface-variant);
    }
    .refusal,
    .inside {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 6px 0 0;
      font-weight: 600;
    }
    .refusal {
      color: var(--mat-sys-error);
    }
    .refusal.small {
      font-weight: 500;
      font: var(--mat-sys-body-small);
    }
    .inside {
      color: var(--mat-sys-primary);
    }
    .quiet {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .lane {
      border: 1px solid var(--app-card-border);
      border-radius: var(--app-radius);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      overflow: hidden;
    }
    .lane header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px 12px;
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-family: var(--app-font-display);
      font-size: 1.15rem;
      font-weight: 500;
    }
    .count {
      min-width: 24px;
      padding: 0 8px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-large);
      text-align: center;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--app-success);
    }
    .dot.stale {
      background: var(--app-warning);
    }
    @media (max-width: 599.98px) {
      .person {
        flex-wrap: wrap;
      }
      .actions {
        flex: 1 1 100%;
      }
      .actions .big {
        width: 100%;
      }
    }
  `,
})
export class StaffGate {
  private readonly api = inject(StaffApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  /** Inside another page: no page header of its own. */
  readonly embedded = input(false, { transform: booleanAttribute });

  protected readonly typeLabel = typeLabel;
  protected readonly scheduleLabel = scheduleLabel;
  protected readonly canScan = !!barcodeDetector();

  protected readonly code = signal('');
  protected readonly query = signal('');
  protected readonly results = signal<GateResult[] | null>(null);
  protected readonly searchError = signal<string | null>(null);
  protected readonly inside = signal<GateResult[]>([]);
  protected readonly loadingInside = signal(true);
  protected readonly stale = signal(false);
  protected readonly busy = signal<ReadonlySet<number>>(new Set());

  private readonly can = (p: string) => this.auth.can(p, this.ctx.selectedSocietyId());
  protected readonly canCheck = computed(() => this.can('STAFF.ENTRY.CREATE'));
  protected readonly canVisitors = computed(() => this.can('VISITOR.ENTRY.UPDATE'));

  constructor() {
    toObservable(this.ctx.selectedSocietyId)
      .pipe(
        switchMap((id) => {
          this.loadingInside.set(true);
          this.results.set(null);
          return this.fetchInside(id, false);
        }),
        takeUntilDestroyed(),
      )
      .subscribe((list) => this.applyInside(list));

    interval(REFRESH_MS)
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        switchMap(() => this.fetchInside(this.ctx.selectedSocietyId(), true)),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => this.applyInside(list));
  }

  protected stateOf(r: GateResult): string {
    if (r.refusal) return 'refused';
    if (r.inside) return 'inside';
    return 'allowed';
  }

  protected flatsOf(r: GateResult): string {
    const flats = r.staff.links.map((l) => l.flat);
    return flats.length ? flats.join(', ') : 'society staff';
  }

  protected onCode(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = digits;
    this.code.set(digits);
    if (digits.length === 6) this.findByCode();
  }

  protected findByCode(): void {
    const code = this.code();
    if (code.length !== 6) {
      this.searchError.set('An entry code has 6 digits');
      return;
    }
    this.search({ code });
  }

  protected findByName(): void {
    const q = this.query().trim();
    if (q.length >= 2) this.search({ q });
  }

  protected scan(): void {
    this.dialog
      .open<ScanDialog, unknown, string>(ScanDialog, { width: '480px', maxWidth: '95vw' })
      .afterClosed()
      .pipe(filter((text): text is string => !!text))
      .subscribe((text) => this.search({ code: text.trim() }));
  }

  protected checkIn(r: GateResult): void {
    this.act(r, this.api.checkIn(r.staff.id), `${r.staff.name} checked in`);
  }

  protected checkOut(r: GateResult): void {
    this.act(r, this.api.checkOut(r.staff.id), `${r.staff.name} checked out`);
  }

  private search(params: { code?: string; q?: string }): void {
    const societyId = this.ctx.selectedSocietyId();
    if (societyId == null) return;
    this.searchError.set(null);
    this.api.gate(societyId, params).subscribe({
      next: (list) => this.results.set(list),
      error: (err: HttpErrorResponse) => {
        this.results.set(null);
        this.searchError.set(errorMessage(err));
      },
    });
  }

  private act(r: GateResult, request: Observable<GateResult>, done: string): void {
    this.setBusy(r.staff.id, true);
    request.subscribe({
      next: (updated) => {
        this.setBusy(r.staff.id, false);
        this.snack.open(done, undefined, { duration: 2500 });
        this.results.update((list) => list?.map((x) => (x.staff.id === updated.staff.id ? updated : x)) ?? null);
        this.inside.update((list) => {
          const others = list.filter((x) => x.staff.id !== updated.staff.id);
          return updated.inside ? [...others, updated] : others;
        });
        // Ready for the next person.
        this.code.set('');
        const input = this.codeInput()?.nativeElement;
        if (input) {
          input.value = '';
          input.focus();
        }
      },
      error: (err: HttpErrorResponse) => {
        this.setBusy(r.staff.id, false);
        // A refusal (409) shows on the person's card.
        this.results.update(
          (list) => list?.map((x) => (x.staff.id === r.staff.id ? { ...x, allowed: false, refusal: errorMessage(err) } : x)) ?? null,
        );
      },
    });
  }

  private fetchInside(societyId: number | null, silent: boolean): Observable<GateResult[] | null> {
    if (societyId == null) return of([]);
    return this.api.inside(societyId, { silent }).pipe(catchError(() => of(null)));
  }

  private applyInside(list: GateResult[] | null): void {
    this.loadingInside.set(false);
    if (list) {
      this.inside.set(list);
      this.stale.set(false);
    } else {
      this.stale.set(true);
    }
  }

  private setBusy(id: number, busy: boolean): void {
    this.busy.update((ids) => {
      const next = new Set(ids);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
