import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

import { EmptyState } from '../../shared/ui';

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink, MatButtonModule, EmptyState],
  template: `
    <h1>Access denied</h1>
    <app-empty-state icon="lock" message="You don't have permission to view this page.">
      <a mat-flat-button routerLink="/dashboard">Back to dashboard</a>
    </app-empty-state>
  `,
  styles: `
    h1 {
      margin: 48px 0 0;
      text-align: center;
      font: var(--mat-sys-headline-small);
      font-weight: 600;
    }
  `,
})
export class Forbidden {}
