import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom, map } from 'rxjs';

import { AuthStore } from '../core/auth/auth.store';
import { PushService } from '../core/push';
import { SocietyContextStore } from '../core/society-context/society-context.store';
import { ThemeMode, ThemeStore } from '../core/theme';
import { inviteDialog } from '../features/invitations/invite-dialog';
import { canOpenMeetings } from '../features/governance/governance-ui';
import { canOpenInvitations } from '../features/invitations/invitation-ui';
import { PendingInvitations } from '../features/invitations/pending-invitations';
import { SetupBanner } from '../features/onboarding/setup-banner';
import { SubscriptionBanner } from '../features/subscription/subscription-banner';
import { PlanModule } from '../core/models';
import { SubscriptionAccessStore } from '../core/subscription/subscription-access.store';
import { confirmDialog } from '../shared/confirm-dialog';
import { Command, CommandPaletteService } from './command-palette';
import { Logo } from '../shared/ui';

interface NavItem {
  label: string;
  icon: string;
  link: string;
  /** Hidden unless the user holds this permission (in the selected society, or platform-wide). */
  permission?: string;
  platform?: boolean;
  /** Instead of a permission: shown when this returns true for the selected society. */
  visible?: (auth: AuthStore, societyId: number | null) => boolean;
  /** A paid module: hidden when the society's plan doesn't include it. */
  module?: PlanModule;
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
  { label: 'Users', icon: 'group', link: '/users', permission: 'USER.ACCOUNT.VIEW' },
  { label: 'Invitations', icon: 'mail', link: '/invitations', visible: canOpenInvitations },
  { label: 'Gate', icon: 'door_front', link: '/gate', permission: 'VISITOR.ENTRY.UPDATE' },
  { label: 'Visitors', icon: 'badge', link: '/visitors', permission: 'VISITOR.ENTRY.VIEW' },
  { label: 'Notices', icon: 'campaign', link: '/notices', permission: 'NOTICE.POST.VIEW' },
  {
    label: 'Rules',
    icon: 'gavel',
    link: '/policies',
    permission: 'POLICY.RULE.VIEW',
    module: 'POLICIES',
  },
  {
    label: 'Meetings',
    icon: 'groups',
    link: '/meetings',
    visible: canOpenMeetings,
    module: 'GOVERNANCE',
  },
  {
    label: 'Complaints',
    icon: 'report_problem',
    link: '/complaints',
    permission: 'COMPLAINT.TICKET.VIEW',
  },
  {
    label: 'Maintenance',
    icon: 'receipt_long',
    link: '/maintenance',
    permission: 'MAINTENANCE.BILL.VIEW',
    module: 'MAINTENANCE',
  },
  {
    label: 'Finance',
    icon: 'account_balance',
    link: '/finance',
    permission: 'FINANCE.ACCOUNT.VIEW',
    module: 'FINANCE',
  },
  {
    label: 'Permissions',
    icon: 'tune',
    link: '/permissions',
    permission: 'SOCIETY.PERMISSION.VIEW',
  },
  {
    label: 'Subscription',
    icon: 'workspace_premium',
    link: '/subscription',
    permission: 'SOCIETY.SUBSCRIPTION.VIEW',
  },
  {
    label: 'Billing',
    icon: 'request_quote',
    link: '/billing',
    permission: 'PLATFORM.BILLING.VIEW',
    platform: true,
  },
  {
    label: 'Registrations',
    icon: 'how_to_reg',
    link: '/registrations',
    permission: 'SOCIETY.APPLICATION.VIEW',
    platform: true,
  },
  {
    label: 'Roles',
    icon: 'admin_panel_settings',
    link: '/roles',
    permission: 'SYSTEM.ROLE.VIEW',
    platform: true,
  },
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
    MatMenuModule,
    MatSelectModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTooltipModule,
    PendingInvitations,
    SetupBanner,
    SubscriptionBanner,
    Logo,
  ],
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  protected readonly auth = inject(AuthStore);
  protected readonly ctx = inject(SocietyContextStore);
  protected readonly theme = inject(ThemeStore);
  private readonly plan = inject(SubscriptionAccessStore);

  protected readonly push = inject(PushService);
  private readonly palette = inject(CommandPaletteService);
  protected readonly modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  constructor() {
    // The shell only renders for a signed-in user, so this runs after login and on reload.
    this.push.resume();
    // Someone changed what this user may do: reload their access so menus and guards follow at once.
    this.push.messages$
      .pipe(
        filter((m) => m.data['type'] === 'PERMISSIONS_CHANGED'),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.auth.restore().subscribe());
  }

  protected readonly themes: { mode: ThemeMode; label: string; icon: string }[] = [
    { mode: 'light', label: 'Light', icon: 'light_mode' },
    { mode: 'dark', label: 'Dark', icon: 'dark_mode' },
    { mode: 'system', label: 'System', icon: 'contrast' },
  ];
  protected readonly themeIcon = computed(
    () => this.themes.find((t) => t.mode === this.theme.mode())!.icon,
  );

  protected readonly isHandset = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 959.98px)')
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  protected readonly navItems = computed(() => {
    const societyId = this.ctx.selectedSocietyId();
    return NAV_ITEMS.filter((item) => {
      if (item.module && !this.plan.allows(item.module)) return false;
      if (item.visible) return item.visible(this.auth, societyId);
      if (!item.permission) return true;
      return item.platform
        ? this.auth.canOnPlatform(item.permission)
        : this.auth.can(item.permission, societyId);
    });
  });

  /** Quick actions, shown when the user may perform them. */
  private readonly actions = computed<Command[]>(() => {
    const societyId = this.ctx.selectedSocietyId();
    const can = (p: string) => this.auth.can(p, societyId);
    const go = (link: string) => () => this.router.navigateByUrl(link);
    const list: Command[] = [];
    if (can('VISITOR.ENTRY.CREATE'))
      list.push({
        id: 'act:visitor',
        group: 'Actions',
        label: 'Log visitor',
        icon: 'person_add',
        keywords: 'new visitor gate entry',
        run: go('/visitors/new'),
      });
    if (can('COMPLAINT.TICKET.CREATE'))
      list.push({
        id: 'act:complaint',
        group: 'Actions',
        label: 'Raise complaint',
        icon: 'add_comment',
        keywords: 'new complaint ticket issue',
        run: go('/complaints/new'),
      });
    if (can('POLICY.RULE.CREATE'))
      list.push({
        id: 'act:policy',
        group: 'Actions',
        label: 'New policy',
        icon: 'gavel',
        keywords: 'rule rules policy by-laws bylaws draft',
        run: go('/policies/new'),
      });
    if (can('GOVERNANCE.MEETING.CREATE'))
      list.push({
        id: 'act:meeting',
        group: 'Actions',
        label: 'New meeting',
        icon: 'groups',
        keywords: 'meeting agm sgm committee agenda notice',
        run: go('/meetings/new'),
      });
    if (can('MAINTENANCE.PAYMENT.CREATE'))
      list.push({
        id: 'act:payment',
        group: 'Actions',
        label: 'Record maintenance payment',
        icon: 'add_card',
        keywords: 'receipt pay dues maintenance cash cheque upi',
        run: go('/maintenance/payments?record=1'),
      });
    if (can('FINANCE.VOUCHER.CREATE')) {
      list.push({
        id: 'act:income',
        group: 'Actions',
        label: 'Record income',
        icon: 'call_received',
        keywords: 'finance receipt income money in hall rent donation interest books',
        run: go('/finance/entries?new=RECEIPT'),
      });
      list.push({
        id: 'act:expense',
        group: 'Actions',
        label: 'Record expense',
        icon: 'call_made',
        keywords: 'finance payment expense bill money out vendor books',
        run: go('/finance/entries?new=PAYMENT'),
      });
    }
    if (can('FINANCE.REPORT.VIEW'))
      list.push({
        id: 'act:statements',
        group: 'Actions',
        label: 'Financial statements',
        icon: 'summarize',
        keywords:
          'balance sheet income expenditure receipts payments trial balance report accounts',
        run: go('/finance/reports'),
      });
    if (can('MAINTENANCE.BILL.CREATE'))
      list.push({
        id: 'act:cycle',
        group: 'Actions',
        label: 'Issue maintenance bills',
        icon: 'post_add',
        keywords: 'billing cycle new bills maintenance',
        run: go('/maintenance/cycles/new'),
      });
    if (can('USER.INVITE.CREATE') && societyId != null)
      list.push({
        id: 'act:invite',
        group: 'Actions',
        label: 'Invite someone',
        icon: 'person_add',
        keywords: 'invitation invite resident member qr link join',
        run: () => inviteDialog(this.dialog, { societyId }).subscribe(),
      });
    if (can('USER.ACCOUNT.CREATE'))
      list.push({
        id: 'act:user',
        group: 'Actions',
        label: 'New user',
        icon: 'group_add',
        keywords: 'add resident create user',
        run: go('/users/new'),
      });
    list.push({
      id: 'act:profile',
      group: 'Actions',
      label: 'My profile',
      icon: 'account_circle',
      keywords: 'password account',
      run: go('/profile'),
    });
    for (const t of this.themes) {
      if (t.mode !== this.theme.mode())
        list.push({
          id: 'theme:' + t.mode,
          group: 'Actions',
          label: t.label + ' theme',
          icon: t.icon,
          keywords: 'theme appearance mode',
          run: () => this.theme.set(t.mode),
        });
    }
    for (const s of this.ctx.societies()) {
      if (s.id !== societyId)
        list.push({
          id: 'society:' + s.id,
          group: 'Actions',
          label: 'Switch to ' + s.name,
          icon: 'swap_horiz',
          keywords: 'society change',
          run: () => this.selectSociety(s.id),
        });
    }
    list.push({
      id: 'act:logout',
      group: 'Actions',
      label: 'Log out',
      icon: 'logout',
      keywords: 'sign out',
      run: () => void this.logout(),
    });
    return list;
  });

  protected openPalette(): void {
    const pages = this.navItems().map<Command>((item) => ({
      id: 'page:' + item.link,
      group: 'Pages',
      label: item.label,
      icon: item.icon,
      hint: 'Page',
      run: () => this.router.navigateByUrl(item.link),
    }));
    this.palette.open([...pages, ...this.actions()]);
  }

  /** Ctrl/⌘+K anywhere, or / when not typing, opens the palette. */
  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing =
      !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (this.palette.isOpen) return;
      this.openPalette();
    } else if (event.key === '/' && !typing && !this.palette.isOpen) {
      event.preventDefault();
      this.openPalette();
    }
  }

  protected selectSociety(societyId: number): void {
    this.ctx.select(societyId);
    // Re-run route guards: the current page may need a permission the new society doesn't grant.
    this.router.navigateByUrl(this.router.url, { onSameUrlNavigation: 'reload' });
  }

  protected async logout(): Promise<void> {
    const confirmed = await firstValueFrom(
      confirmDialog(this.dialog, {
        title: 'Log out',
        message: 'Are you sure you want to log out?',
        confirmText: 'Log out',
      }),
    );
    if (!confirmed) return;
    await this.push.unregister(); // needs the JWT, so before auth.logout()
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
