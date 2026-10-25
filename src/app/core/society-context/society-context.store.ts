import { Injectable, signal } from '@angular/core';

const SOCIETY_KEY = 'sm.societyId';

/** The society most screens work inside. The switcher and validation against access come in step 3. */
@Injectable({ providedIn: 'root' })
export class SocietyContextStore {
  private readonly _selectedSocietyId = signal<number | null>(readSocietyId());

  readonly selectedSocietyId = this._selectedSocietyId.asReadonly();

  select(societyId: number | null): void {
    this._selectedSocietyId.set(societyId);
    try {
      if (societyId == null) localStorage.removeItem(SOCIETY_KEY);
      else localStorage.setItem(SOCIETY_KEY, String(societyId));
    } catch {
      // Storage unavailable — the selection just won't survive a reload.
    }
  }
}

function readSocietyId(): number | null {
  try {
    const id = Number(localStorage.getItem(SOCIETY_KEY));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
