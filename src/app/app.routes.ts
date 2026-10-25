import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';
import { permissionGuard, societyPermissionGuard } from './core/auth/permission.guard';
import { unsavedChangesGuard } from './core/unsaved-changes.guard';

// `title` is shown in the browser tab as "<title> · Society Management" (see AppTitleStrategy).
export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    canMatch: [guestGuard],
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
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
      // Before 'societies' so that route's guard doesn't run for settings URLs.
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
        path: 'visitors/new',
        title: 'Log visitor',
        canMatch: [permissionGuard],
        data: { permission: 'VISITOR.ENTRY.CREATE' },
        loadComponent: () =>
          import('./features/visitors/visitor-create').then((m) => m.VisitorCreate),
      },
      {
        path: 'visitors',
        title: 'Visitors',
        canMatch: [permissionGuard],
        data: { permission: 'VISITOR.ENTRY.VIEW' },
        loadComponent: () => import('./features/visitors/visitor-list').then((m) => m.VisitorList),
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
