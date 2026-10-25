import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';

import { SocietyApi } from '../api/society.api';
import { AuthStore } from '../auth/auth.store';
import { Society } from '../models';

const SOCIETY_KEY = 'sm.societyId';
const VIEW_SOCIETY = 'SOCIETY.SETTINGS.VIEW';

export interface SocietyOption {
  id: number;
  name: string;
}

/** The society most screens work inside, chosen from the societies the user has access to. */
@Injectable({ providedIn: 'root' })
export class SocietyContextStore {
  private readonly auth = inject(AuthStore);
  private readonly societyApi = inject(SocietyApi);

  private readonly _societies = signal<SocietyOption[]>([]);
  private readonly _selectedSocietyId = signal<number | null>(readSocietyId());

  readonly societies = this._societies.asReadonly();
  readonly selectedSocietyId = this._selectedSocietyId.asReadonly();
  readonly selectedSociety = computed(
    () => this._societies().find((s) => s.id === this._selectedSocietyId()) ?? null,
  );

  /**
   * Loads the user's societies and keeps the stored selection if it is still one of them,
   * otherwise falls back to the first. Never errors, so it is safe in the app initializer.
   */
  load(): Observable<void> {
    return this.fetchSocieties().pipe(
      catchError(() => of(this.accessFallback())),
      tap((societies) => {
        this._societies.set(societies);
        const current = this._selectedSocietyId();
        if (!societies.some((s) => s.id === current)) this.select(societies[0]?.id ?? null);
      }),
      map(() => undefined),
    );
  }

  select(societyId: number | null): void {
    this._selectedSocietyId.set(societyId);
    try {
      if (societyId == null) localStorage.removeItem(SOCIETY_KEY);
      else localStorage.setItem(SOCIETY_KEY, String(societyId));
    } catch {
      // Storage unavailable — the selection just won't survive a reload.
    }
  }

  private fetchSocieties(): Observable<SocietyOption[]> {
    // Platform-wide viewers (super admin) see every society.
    if (this.auth.canOnPlatform(VIEW_SOCIETY)) {
      return this.societyApi.list().pipe(map((list) => sortByName(list.map(toOption))));
    }
    const ids = this.societyIds();
    if (!ids.length) return of([]);
    // Everyone else works in the societies they hold roles in; names need view permission there.
    return forkJoin(
      ids.map((id) =>
        this.auth.can(VIEW_SOCIETY, id)
          ? this.societyApi.get(id).pipe(
              map(toOption),
              catchError(() => of(placeholder(id))),
            )
          : of(placeholder(id)),
      ),
    ).pipe(map(sortByName));
  }

  private accessFallback(): SocietyOption[] {
    return this.societyIds().map(placeholder);
  }

  private societyIds(): number[] {
    return this.auth.access()?.societies.map((s) => s.societyId) ?? [];
  }
}

function toOption(society: Society): SocietyOption {
  return { id: society.id, name: society.name };
}

function placeholder(id: number): SocietyOption {
  return { id, name: `Society #${id}` };
}

function sortByName(options: SocietyOption[]): SocietyOption[] {
  return [...options].sort((a, b) => a.name.localeCompare(b.name));
}

function readSocietyId(): number | null {
  try {
    const id = Number(localStorage.getItem(SOCIETY_KEY));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
