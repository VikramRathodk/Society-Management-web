import { Injectable, Injector, inject } from '@angular/core';

/**
 * Snackbar messages for code that runs at startup (the error interceptor). The snackbar and its
 * overlay load on first use, which keeps ~100 kB out of the initial bundle. Feature pages are lazy,
 * so they can keep injecting MatSnackBar directly.
 */
@Injectable({ providedIn: 'root' })
export class Notifier {
  private readonly injector = inject(Injector);

  show(message: string, action?: string, duration = 4000): void {
    import('@angular/material/snack-bar').then(({ MatSnackBar }) =>
      this.injector.get(MatSnackBar).open(message, action, { duration }),
    );
  }
}
