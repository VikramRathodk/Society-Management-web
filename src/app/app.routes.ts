import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';
import { permissionGuard, societyPermissionGuard } from './core/auth/permission.guard';

export const routes: Routes = [
  {
    path: 'login',
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
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      // Before 'societies' so that route's guard doesn't run for settings URLs.
      {
        path: 'societies/:id/settings',
        canActivate: [societyPermissionGuard],
        data: { permission: 'SOCIETY.SETTINGS.UPDATE' },
        loadComponent: () =>
          import('./features/societies/society-settings').then((m) => m.SocietySettings),
      },
      {
        path: 'societies',
        canMatch: [permissionGuard],
        data: { permission: 'SOCIETY.SETTINGS.VIEW' },
        loadComponent: () => import('./features/societies/society-list').then((m) => m.SocietyList),
      },
      {
        path: 'structure',
        canMatch: [permissionGuard],
        data: { permission: 'FLAT.DIRECTORY.VIEW' },
        loadComponent: () => import('./features/structure/structure').then((m) => m.Structure),
      },
      {
        path: 'users/new',
        canMatch: [permissionGuard],
        data: { permission: 'USER.ACCOUNT.CREATE' },
        loadComponent: () => import('./features/users/user-create').then((m) => m.UserCreate),
      },
      {
        path: 'users/:id',
        canMatch: [permissionGuard],
        data: { permission: 'USER.ACCOUNT.VIEW' },
        loadComponent: () => import('./features/users/user-detail').then((m) => m.UserDetail),
      },
      {
        path: 'users',
        canMatch: [permissionGuard],
        data: { permission: 'USER.ACCOUNT.VIEW' },
        loadComponent: () => import('./features/users/user-list').then((m) => m.UserList),
      },
      {
        path: 'visitors/new',
        canMatch: [permissionGuard],
        data: { permission: 'VISITOR.ENTRY.CREATE' },
        loadComponent: () =>
          import('./features/visitors/visitor-create').then((m) => m.VisitorCreate),
      },
      {
        path: 'visitors',
        canMatch: [permissionGuard],
        data: { permission: 'VISITOR.ENTRY.VIEW' },
        loadComponent: () => import('./features/visitors/visitor-list').then((m) => m.VisitorList),
      },
      {
        path: 'roles/:code',
        canMatch: [permissionGuard],
        data: { permission: 'SYSTEM.ROLE.VIEW', platform: true },
        loadComponent: () => import('./features/roles/role-detail').then((m) => m.RoleDetail),
      },
      {
        path: 'roles',
        canMatch: [permissionGuard],
        data: { permission: 'SYSTEM.ROLE.VIEW', platform: true },
        loadComponent: () => import('./features/roles/role-list').then((m) => m.RoleList),
      },
      {
        path: 'forbidden',
        loadComponent: () => import('./features/forbidden/forbidden').then((m) => m.Forbidden),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
