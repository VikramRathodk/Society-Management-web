import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { FlatInviteOption } from '../../core/models';
import { InviteDialog } from './invite-dialog';
import { issued } from './invitation-test-data';

describe('InviteDialog', () => {
  let fixture: ComponentFixture<InviteDialog>;
  let http: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
      HTMLButtonElement | undefined;
  const type = (label: string, value: string) => {
    const field = [...el().querySelectorAll('mat-form-field')].find((f) =>
      f.querySelector('mat-label')?.textContent?.includes(label),
    )!;
    const input = field.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function setup(data: {
    societyId: number;
    issued?: ReturnType<typeof issued>;
    flatOptions?: FlatInviteOption[];
  }) {
    TestBed.configureTestingModule({
      imports: [InviteDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: () => {} } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InviteDialog);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  it('offers the roles the caller may invite to and shows the QR once created', async () => {
    await setup({ societyId: 4 });
    http
      .expectOne((r) => r.url.endsWith('/api/societies/4/invitations/roles'))
      .flush([
        { code: 'GUARD', name: 'Security Guard', scopeLevel: 'SOCIETY', requiresFlat: false },
      ]);
    await fixture.whenStable();
    fixture.detectChanges();

    type('Name', 'Gopal');
    type('Phone', '9876543210');
    const roleFields = fixture.debugElement.query(
      (d) => d.name === 'app-role-fields',
    ).componentInstance;
    roleFields.form.controls.role.setValue('GUARD');
    fixture.detectChanges();
    (el().querySelector('button[type="submit"]') as HTMLButtonElement).click();

    const req = http.expectOne(
      (r) => r.url.endsWith('/api/societies/4/invitations') && r.method === 'POST',
    );
    expect(req.request.body).toEqual({ name: 'Gopal', phone: '9876543210', role: 'GUARD' });
    req.flush(
      issued({ name: 'Gopal', roleName: 'Security Guard', flatLabel: null, residentType: null }),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().querySelector('h2')?.textContent).toContain('Invitation ready');
    expect(el().querySelector('[data-testid="invite-link"]')?.textContent).toContain(
      '/invite/tok123',
    );
    expect(el().querySelector('a[href^="https://wa.me/"]')).not.toBeNull();
    expect(button('Invite another')).toBeDefined();
  });

  it('shows why an invitation was refused', async () => {
    await setup({ societyId: 4 });
    http
      .expectOne((r) => r.url.endsWith('/invitations/roles'))
      .flush([
        { code: 'GUARD', name: 'Security Guard', scopeLevel: 'SOCIETY', requiresFlat: false },
      ]);
    await fixture.whenStable();
    type('Name', 'Gopal');
    type('Phone', '9876543210');
    fixture.debugElement
      .query((d) => d.name === 'app-role-fields')
      .componentInstance.form.controls.role.setValue('GUARD');
    fixture.detectChanges();
    (el().querySelector('button[type="submit"]') as HTMLButtonElement).click();
    http
      .expectOne((r) => r.method === 'POST')
      .flush(
        { message: 'Gopal already has this role here' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('already has this role');
  });

  it('opens straight on the QR of a resent link', async () => {
    await setup({ societyId: 4, issued: issued() });
    expect(el().querySelector('h2')?.textContent).toContain('Invitation ready');
    expect(button('Invite another')).toBeUndefined();
  });

  const ownFlat: FlatInviteOption = {
    flatId: 9,
    flatLabel: 'A-101',
    role: 'RESIDENT',
    roleName: 'Resident',
    residentTypes: ['FAMILY', 'TENANT'],
    needsApproval: true,
  };

  it('lets a resident invite to their own flat without choosing a role', async () => {
    await setup({ societyId: 4, flatOptions: [ownFlat] });
    http.expectNone((r) => r.url.endsWith('/invitations/roles'));
    expect(el().querySelector('h2')?.textContent).toContain('Invite to your flat');
    expect(el().querySelector('app-role-fields')).toBeNull();
    expect(el().textContent).toContain('approves it before the link works');

    type('Name', 'Pepper');
    type('Phone', '9876543210');
    (
      fixture.componentInstance as unknown as {
        form: { controls: { residentType: { setValue(v: string): void } } };
      }
    ).form.controls.residentType.setValue('FAMILY');
    fixture.detectChanges();
    (el().querySelector('button[type="submit"]') as HTMLButtonElement).click();

    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({
      name: 'Pepper',
      phone: '9876543210',
      role: 'RESIDENT',
      flatId: 9,
      residentType: 'FAMILY',
    });
    req.flush(issued({ name: 'Pepper', status: 'AWAITING_APPROVAL', residentType: 'FAMILY' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role="status"]')?.textContent).toContain(
      'works once a committee member approves',
    );
  });

  it('needs a resident type before sending', async () => {
    await setup({ societyId: 4, flatOptions: [ownFlat] });
    type('Name', 'Pepper');
    type('Phone', '9876543210');
    fixture.detectChanges();
    (el().querySelector('button[type="submit"]') as HTMLButtonElement).click();
    http.expectNone((r) => r.method === 'POST');
  });

  it("picks a tenant's only type for them", async () => {
    await setup({ societyId: 4, flatOptions: [{ ...ownFlat, residentTypes: ['TENANT'] }] });
    type('Name', 'Happy');
    type('Phone', '9876543210');
    fixture.detectChanges();
    (el().querySelector('button[type="submit"]') as HTMLButtonElement).click();
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body.residentType).toBe('TENANT');
    req.flush(issued());
  });
});
