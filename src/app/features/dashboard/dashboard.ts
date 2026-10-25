import { Component, inject } from '@angular/core';

import { AuthStore } from '../../core/auth/auth.store';

/** Placeholder until the permission-driven cards are built. */
@Component({
  selector: 'app-dashboard',
  template: `
    @if (auth.user(); as user) {
      <h1>Welcome, {{ user.name }}</h1>
    } @else {
      <h1>Welcome</h1>
    }
    <p>Dashboard cards will appear here as features are built.</p>
  `,
})
export class Dashboard {
  protected readonly auth = inject(AuthStore);
}
