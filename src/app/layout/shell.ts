import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';

import { AuthStore } from '../core/auth/auth.store';
import { SocietyContextStore } from '../core/society-context/society-context.store';

interface NavItem {
  label: string;
  icon: string;
  link: string;
  /** Hidden unless the user holds this permission (in the selected society, or platform-wide). */
  permission?: string;
  platform?: boolean;
}

/** Add an entry here as each feature route lands. */
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'dashboard', link: '/dashboard' },
  {
    label: 'Societies',
    icon: 'apartment',
    link: '/societies',
    permission: 'SOCIETY.SETTINGS.VIEW',
  },
  { label: 'Structure', icon: 'domain', link: '/structure', permission: 'FLAT.DIRECTORY.VIEW' },
];

/** Frame for signed-in pages: top bar with society switcher, side nav and content. */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatListModule,
    MatSelectModule,
    MatSidenavModule,
    MatToolbarModule,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly isHandset = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 959.98px)')
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  protected readonly navItems = computed(() =>
    NAV_ITEMS.filter(
      (item) =>
        !item.permission ||
        (item.platform
          ? this.auth.canOnPlatform(item.permission)
          : this.auth.can(item.permission, this.ctx.selectedSocietyId())),
    ),
  );

  protected selectSociety(societyId: number): void {
    this.ctx.select(societyId);
    // Re-run route guards: the current page may need a permission the new society doesn't grant.
    this.router.navigateByUrl(this.router.url, { onSameUrlNavigation: 'reload' });
  }

  protected logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
