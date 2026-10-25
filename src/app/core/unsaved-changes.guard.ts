import { CanDeactivateFn } from '@angular/router';
import { Observable } from 'rxjs';

/** Implemented by pages with editable state that shouldn't be lost by navigating away. */
export interface HasUnsavedChanges {
  /** True to leave; otherwise the page asks (e.g. with a confirm dialog) and emits the answer. */
  canLeave(): boolean | Observable<boolean>;
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) =>
  component?.canLeave?.() ?? true;
