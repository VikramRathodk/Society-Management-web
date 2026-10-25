import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Centered icon + message for empty lists; project actions (e.g. an "Add" button) as content. */
@Component({
  selector: 'app-empty-state',
  imports: [MatIconModule],
  template: `
    <mat-icon>{{ icon() }}</mat-icon>
    <p>{{ message() }}</p>
    <ng-content />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 48px 16px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }
    mat-icon {
      width: 48px;
      height: 48px;
      font-size: 48px;
    }
    p {
      margin: 0;
    }
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly message = input.required<string>();
}
