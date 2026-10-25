import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'sm.theme';

/**
 * Light / dark / system. "system" leaves `color-scheme: light dark` in charge (styles.scss);
 * light and dark pin it with a class on <html>. index.html applies the saved class before boot.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly _mode = signal<ThemeMode>(readMode());

  readonly mode = this._mode.asReadonly();

  set(mode: ThemeMode): void {
    this._mode.set(mode);
    this.root.classList.toggle('theme-light', mode === 'light');
    this.root.classList.toggle('theme-dark', mode === 'dark');
    try {
      if (mode === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Storage unavailable — the choice just won't survive a reload.
    }
  }
}

function readMode(): ThemeMode {
  try {
    const mode = localStorage.getItem(THEME_KEY);
    return mode === 'light' || mode === 'dark' ? mode : 'system';
  } catch {
    return 'system';
  }
}
