import { Component, DestroyRef, Injectable, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Observable, catchError, map, of, shareReplay, switchMap } from 'rxjs';

import { VisitorApi } from '../../core/api/visitor.api';

/**
 * Fetches visitor photos as blobs (they need the auth header) and caches the object URLs
 * for the lifetime of the page that provides it, revoking them when that page is destroyed.
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

/** Thumbnail that opens the full photo; a person icon when there is none. */
@Component({
  selector: 'app-visitor-photo',
  imports: [MatIconModule],
  template: `
    @if (url(); as src) {
      <button
        type="button"
        class="thumb"
        (click)="open(src)"
        [attr.aria-label]="'View photo of ' + name()"
      >
        <img [src]="src" alt="" />
      </button>
    } @else {
      <span class="thumb thumb--empty"><mat-icon>person</mat-icon></span>
    }
  `,
  styles: `
    .thumb {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      padding: 0;
      overflow: hidden;
      border: none;
      border-radius: 50%;
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
    }
    .thumb--empty {
      cursor: default;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class VisitorPhoto {
  private readonly photos = inject(VisitorPhotos);
  private readonly dialog = inject(MatDialog);

  readonly visitorId = input.required<number>();
  readonly hasPhoto = input(false);
  readonly name = input('');

  protected readonly url = toSignal(
    toObservable(computed(() => ({ id: this.visitorId(), hasPhoto: this.hasPhoto() }))).pipe(
      switchMap(({ id, hasPhoto }) => (hasPhoto ? this.photos.url(id) : of(null))),
    ),
    { initialValue: null },
  );

  protected open(src: string): void {
    this.dialog.open(VisitorPhotoDialog, { data: { src, alt: `Photo of ${this.name()}` } });
  }
}
