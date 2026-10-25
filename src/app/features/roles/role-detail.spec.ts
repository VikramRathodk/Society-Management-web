import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { Permission, Role } from '../../core/models';
import { RoleDetail } from './role-detail';

const PERMISSIONS: Permission[] = [
  { code: 'VISITOR.ENTRY.VIEW', description: 'View visitor logs' },
  { code: 'VISITOR.ENTRY.CREATE', description: 'Log a visitor entry' },
  { code: 'VISITOR.APPROVAL.APPROVE', description: 'Approve visitor request' },
  { code: 'NOTICE.POST.VIEW', description: 'View notices' },
];

function role(code: string, inherits: string[], own: string[], effective = own): Role {
  return {
    code,
    name: code.charAt(0) + code.slice(1).toLowerCase(),
    description: null,
    scopeLevel: 'SOCIETY',
    requiresFlat: false,
    allPermissions: false,
    isSystem: code !== 'TREASURER',
    inherits,
    permissions: own,
    effectivePermissions: effective,
  };
}

const ROLES = [
  role('RESIDENT', [], ['NOTICE.POST.VIEW', 'VISITOR.APPROVAL.APPROVE']),
  role(
    'TREASURER',
    ['RESIDENT'],
    ['VISITOR.ENTRY.VIEW'],
    ['VISITOR.ENTRY.VIEW', 'NOTICE.POST.VIEW', 'VISITOR.APPROVAL.APPROVE'],
  ),
  role('COMMITTEE', ['TREASURER'], []),
];

describe('RoleDetail', () => {
  let fixture: ComponentFixture<RoleDetail>;
  let http: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const checkbox = (code: string) =>
    el().querySelector<HTMLInputElement>(`mat-checkbox[aria-label="${code}"] input`) ??
    el().querySelector<HTMLInputElement>(`input[aria-label="${code}"]`)!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [RoleDetail],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthStore, useValue: { canOnPlatform: () => true, can: () => true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RoleDetail);
    fixture.componentRef.setInput('code', 'TREASURER');
    await fixture.whenStable();
    http.expectOne('/api/roles').flush(ROLES);
    http.expectOne('/api/permissions').flush(PERMISSIONS);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows own permissions as editable and inherited ones as locked', () => {
    expect(checkbox('VISITOR.ENTRY.VIEW').checked).toBe(true);
    expect(checkbox('VISITOR.ENTRY.VIEW').disabled).toBe(false);
    expect(checkbox('NOTICE.POST.VIEW').checked).toBe(true);
    expect(checkbox('NOTICE.POST.VIEW').disabled).toBe(true);
    expect(checkbox('VISITOR.ENTRY.CREATE').checked).toBe(false);
  });

  it('saves the own permission list, then reloads every role', async () => {
    checkbox('VISITOR.ENTRY.CREATE').click();
    await fixture.whenStable();
    const save = [...el().querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Save permissions'),
    )!;
    save.click();

    const req = http.expectOne('/api/roles/TREASURER/permissions');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      permissions: ['VISITOR.ENTRY.CREATE', 'VISITOR.ENTRY.VIEW'],
    });
    req.flush(ROLES[1]);
    http.expectOne('/api/roles').flush(ROLES);
    await fixture.whenStable();
  });

  it("doesn't offer roles below this one as parents", () => {
    const options = (
      fixture.componentInstance as unknown as { inheritOptions: () => Role[] }
    ).inheritOptions();
    expect(options.map((r) => r.code)).toEqual(['RESIDENT']);
  });
});
