import { inject } from '@angular/core';
import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';
import { AuthStore } from './core/auth/auth.store';
import { permissionGuard, societyPermissionGuard } from './core/auth/permission.guard';
import { unsavedChangesGuard } from './core/unsaved-changes.guard';
import { invitationsGuard } from './features/invitations/invitation-ui';

// `title` is shown in the browser tab as "<title> · Sahvasa" (see AppTitleStrategy).
export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    canMatch: [guestGuard],
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  // Public home for signed-out visitors. Signed-in users don't match it and fall through to the
  // shell below, which sends them to the dashboard.
  {
    path: '',
    pathMatch: 'full',
    title: 'Society management platform',
    canMatch: [() => !inject(AuthStore).isAuthenticated()],
    loadComponent: () => import('./features/landing/landing').then((m) => m.Landing),
  },
  // Public: where invitation links and QR codes land, signed in or not.
  {
    path: 'invite/:token',
    title: 'Invitation',
    loadComponent: () =>
      import('./features/invitations/accept-invitation').then((m) => m.AcceptInvitation),
  },
  // Public: a society registers itself (signed in or not), and checks on its registration.
  {
    path: 'register-society',
    title: 'Register your society',
    loadComponent: () =>
      import('./features/onboarding/register-society').then((m) => m.RegisterSociety),
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'profile',
        title: 'My profile',
        loadComponent: () => import('./features/profile/profile').then((m) => m.Profile),
      },
      // Before 'societies' so that route's guard doesn't run for settings and setup URLs.
      {
        path: 'societies/:id/setup',
        title: 'Society setup',
        canActivate: [societyPermissionGuard],
        data: { permission: 'SOCIETY.SETTINGS.UPDATE' },
        loadComponent: () =>
          import('./features/onboarding/setup-wizard').then((m) => m.SetupWizard),
      },
      {
        path: 'societies/:id/settings',
        title: 'Society settings',
        canActivate: [societyPermissionGuard],
        data: { permission: 'SOCIETY.SETTINGS.UPDATE' },
        loadComponent: () =>
          import('./features/societies/society-settings').then((m) => m.SocietySettings),
      },
      {
        path: 'societies',
        title: 'Societies',
        canMatch: [permissionGuard],
        data: { permission: 'SOCIETY.SETTINGS.VIEW' },
        loadComponent: () => import('./features/societies/society-list').then((m) => m.SocietyList),
      },
      {
        path: 'structure',
        title: 'Structure',
        canMatch: [permissionGuard],
        data: { permission: 'FLAT.DIRECTORY.VIEW' },
        loadComponent: () => import('./features/structure/structure').then((m) => m.Structure),
      },
      {
        path: 'users/new',
        title: 'New user',
        canMatch: [permissionGuard],
        data: { permission: 'USER.ACCOUNT.CREATE' },
        loadComponent: () => import('./features/users/user-create').then((m) => m.UserCreate),
      },
      {
        path: 'users/:id',
        title: 'User',
        canMatch: [permissionGuard],
        data: { permission: 'USER.ACCOUNT.VIEW' },
        loadComponent: () => import('./features/users/user-detail').then((m) => m.UserDetail),
      },
      {
        path: 'users',
        title: 'Users',
        canMatch: [permissionGuard],
        data: { permission: 'USER.ACCOUNT.VIEW' },
        loadComponent: () => import('./features/users/user-list').then((m) => m.UserList),
      },
      {
        path: 'invitations',
        title: 'Invitations',
        // Committee and above see all invitations; residents the ones they sent.
        canMatch: [invitationsGuard],
        loadComponent: () =>
          import('./features/invitations/invitation-list').then((m) => m.InvitationList),
      },
      {
        path: 'visitors/new',
        title: 'Log visitor',
        canMatch: [permissionGuard],
        data: { permission: 'VISITOR.ENTRY.CREATE' },
        loadComponent: () =>
          import('./features/visitors/visitor-create').then((m) => m.VisitorCreate),
      },
      {
        path: 'gate',
        title: 'Gate',
        canMatch: [permissionGuard],
        data: { permission: 'VISITOR.ENTRY.UPDATE' },
        loadComponent: () => import('./features/visitors/gate-board').then((m) => m.GateBoard),
      },
      {
        path: 'visitors',
        title: 'Visitors',
        canMatch: [permissionGuard],
        data: { permission: 'VISITOR.ENTRY.VIEW' },
        loadComponent: () => import('./features/visitors/visitor-list').then((m) => m.VisitorList),
      },
      {
        path: 'notices',
        title: 'Notices',
        canMatch: [permissionGuard],
        data: { permission: 'NOTICE.POST.VIEW' },
        loadComponent: () => import('./features/notices/notice-list').then((m) => m.NoticeList),
      },
      {
        path: 'policies/new',
        title: 'New policy',
        canMatch: [permissionGuard],
        canDeactivate: [unsavedChangesGuard],
        data: { permission: 'POLICY.RULE.CREATE' },
        loadComponent: () =>
          import('./features/policies/policy-editor').then((m) => m.PolicyEditor),
      },
      {
        path: 'policies/:id/edit',
        title: 'Edit policy',
        canMatch: [permissionGuard],
        canDeactivate: [unsavedChangesGuard],
        data: { permission: 'POLICY.RULE.UPDATE' },
        loadComponent: () =>
          import('./features/policies/policy-editor').then((m) => m.PolicyEditor),
      },
      {
        path: 'policies/:id/acknowledgements',
        title: 'Who has accepted',
        canMatch: [permissionGuard],
        data: { permission: 'POLICY.ACKNOWLEDGEMENT.VIEW' },
        loadComponent: () =>
          import('./features/policies/acknowledgement-report').then((m) => m.AcknowledgementReport),
      },
      {
        path: 'policies/:id',
        title: 'Policy',
        canMatch: [permissionGuard],
        data: { permission: 'POLICY.RULE.VIEW' },
        loadComponent: () =>
          import('./features/policies/policy-detail').then((m) => m.PolicyDetail),
      },
      {
        path: 'policies',
        title: 'Rules & policies',
        canMatch: [permissionGuard],
        data: { permission: 'POLICY.RULE.VIEW' },
        loadComponent: () => import('./features/policies/policy-list').then((m) => m.PolicyList),
      },
      {
        path: 'complaints/new',
        title: 'Raise complaint',
        canMatch: [permissionGuard],
        data: { permission: 'COMPLAINT.TICKET.CREATE' },
        loadComponent: () =>
          import('./features/complaints/complaint-create').then((m) => m.ComplaintCreate),
      },
      {
        path: 'complaints/:id',
        title: 'Complaint',
        canMatch: [permissionGuard],
        data: { permission: 'COMPLAINT.TICKET.VIEW' },
        loadComponent: () =>
          import('./features/complaints/complaint-detail').then((m) => m.ComplaintDetail),
      },
      {
        path: 'complaints',
        title: 'Complaints',
        canMatch: [permissionGuard],
        data: { permission: 'COMPLAINT.TICKET.VIEW' },
        loadComponent: () =>
          import('./features/complaints/complaint-list').then((m) => m.ComplaintList),
      },
      {
        path: 'maintenance',
        canMatch: [permissionGuard],
        data: { permission: 'MAINTENANCE.BILL.VIEW' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            title: 'Maintenance dues',
            loadComponent: () =>
              import('./features/maintenance/maintenance-dues').then((m) => m.MaintenanceDues),
          },
          {
            path: 'bills/:id',
            title: 'Bill',
            loadComponent: () =>
              import('./features/maintenance/bill-detail').then((m) => m.BillDetail),
          },
          {
            path: 'bills',
            title: 'Maintenance bills',
            loadComponent: () => import('./features/maintenance/bill-list').then((m) => m.BillList),
          },
          {
            path: 'payments/:id',
            title: 'Receipt',
            canMatch: [permissionGuard],
            data: { permission: 'MAINTENANCE.PAYMENT.VIEW' },
            loadComponent: () =>
              import('./features/maintenance/payment-detail').then((m) => m.PaymentDetail),
          },
          {
            path: 'payments',
            title: 'Maintenance payments',
            canMatch: [permissionGuard],
            data: { permission: 'MAINTENANCE.PAYMENT.VIEW' },
            loadComponent: () =>
              import('./features/maintenance/payment-list').then((m) => m.PaymentList),
          },
          {
            path: 'cycles/new',
            title: 'New billing cycle',
            canMatch: [permissionGuard],
            data: { permission: 'MAINTENANCE.BILL.CREATE' },
            loadComponent: () => import('./features/maintenance/cycle-new').then((m) => m.CycleNew),
          },
          {
            path: 'cycles/:id',
            title: 'Billing cycle',
            loadComponent: () =>
              import('./features/maintenance/cycle-detail').then((m) => m.CycleDetail),
          },
          {
            path: 'cycles',
            title: 'Billing cycles',
            loadComponent: () =>
              import('./features/maintenance/cycle-list').then((m) => m.CycleList),
          },
          {
            path: 'opening-balances',
            title: 'Opening balances',
            canMatch: [permissionGuard],
            data: { permission: 'MAINTENANCE.BILL.CREATE' },
            loadComponent: () =>
              import('./features/maintenance/opening-balances').then((m) => m.OpeningBalances),
          },
          {
            path: 'settings',
            title: 'Maintenance settings',
            canMatch: [permissionGuard],
            data: { permission: 'MAINTENANCE.CHARGE.VIEW' },
            loadComponent: () =>
              import('./features/maintenance/maintenance-settings').then(
                (m) => m.MaintenanceSettings,
              ),
          },
          {
            path: 'refunds',
            title: 'Maintenance refunds',
            canMatch: [permissionGuard],
            data: { permission: 'MAINTENANCE.PAYMENT.VIEW' },
            loadComponent: () =>
              import('./features/maintenance/refund-list').then((m) => m.RefundList),
          },
        ],
      },
      {
        path: 'finance',
        canMatch: [permissionGuard],
        data: { permission: 'FINANCE.ACCOUNT.VIEW' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            title: 'Finance',
            loadComponent: () =>
              import('./features/finance/finance-overview').then((m) => m.FinanceOverview),
          },
          {
            path: 'entries/:id',
            title: 'Entry',
            canMatch: [permissionGuard],
            data: { permission: 'FINANCE.VOUCHER.VIEW' },
            loadComponent: () =>
              import('./features/finance/entry-detail').then((m) => m.EntryDetail),
          },
          {
            path: 'entries',
            title: 'Entries',
            canMatch: [permissionGuard],
            data: { permission: 'FINANCE.VOUCHER.VIEW' },
            loadComponent: () => import('./features/finance/entry-list').then((m) => m.EntryList),
          },
          {
            path: 'accounts/:id',
            title: 'Ledger',
            canMatch: [permissionGuard],
            data: { permission: 'FINANCE.VOUCHER.VIEW' },
            loadComponent: () => import('./features/finance/ledger').then((m) => m.LedgerPage),
          },
          {
            path: 'accounts',
            title: 'Chart of accounts',
            loadComponent: () =>
              import('./features/finance/account-list').then((m) => m.AccountList),
          },
          {
            path: 'reconcile/statements/:id',
            title: 'Bank statement',
            canMatch: [permissionGuard],
            data: { permission: 'FINANCE.RECONCILIATION.VIEW' },
            loadComponent: () =>
              import('./features/finance/reconcile-statement').then((m) => m.ReconcileStatement),
          },
          {
            path: 'reconcile/:accountId',
            title: 'Bank reconciliation',
            canMatch: [permissionGuard],
            data: { permission: 'FINANCE.RECONCILIATION.VIEW' },
            loadComponent: () =>
              import('./features/finance/reconcile-list').then((m) => m.ReconcileList),
          },
          {
            path: 'reconcile',
            title: 'Bank reconciliation',
            canMatch: [permissionGuard],
            data: { permission: 'FINANCE.RECONCILIATION.VIEW' },
            loadComponent: () =>
              import('./features/finance/reconcile-list').then((m) => m.ReconcileList),
          },
          {
            path: 'reports',
            title: 'Financial statements',
            canMatch: [permissionGuard],
            data: { permission: 'FINANCE.REPORT.VIEW' },
            loadComponent: () =>
              import('./features/finance/finance-reports').then((m) => m.FinanceReports),
          },
          {
            path: 'settings',
            title: 'Finance settings',
            loadComponent: () =>
              import('./features/finance/finance-settings').then((m) => m.FinanceSettings),
          },
          {
            path: 'audit',
            title: 'Finance audit log',
            canMatch: [permissionGuard],
            data: { permission: 'FINANCE.AUDIT.VIEW' },
            loadComponent: () => import('./features/finance/audit-log').then((m) => m.AuditLog),
          },
        ],
      },
      {
        path: 'registrations',
        title: 'Registrations',
        canMatch: [permissionGuard],
        data: { permission: 'SOCIETY.APPLICATION.VIEW', platform: true },
        loadComponent: () =>
          import('./features/onboarding/application-list').then((m) => m.ApplicationList),
      },
      {
        path: 'roles/:code',
        title: 'Role',
        canMatch: [permissionGuard],
        canDeactivate: [unsavedChangesGuard],
        data: { permission: 'SYSTEM.ROLE.VIEW', platform: true },
        loadComponent: () => import('./features/roles/role-detail').then((m) => m.RoleDetail),
      },
      {
        path: 'roles',
        title: 'Roles',
        canMatch: [permissionGuard],
        data: { permission: 'SYSTEM.ROLE.VIEW', platform: true },
        loadComponent: () => import('./features/roles/role-list').then((m) => m.RoleList),
      },
      {
        path: 'forbidden',
        title: 'Access denied',
        loadComponent: () => import('./features/forbidden/forbidden').then((m) => m.Forbidden),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
