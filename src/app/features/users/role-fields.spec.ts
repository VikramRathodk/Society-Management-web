import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AssignableRole } from '../../core/models';
import { RoleFields } from './role-fields';

const RESIDENT: AssignableRole = {
  code: 'RESIDENT',
  name: 'Resident',
  scopeLevel: 'SOCIETY',
  requiresFlat: true,
};
const GUARD: AssignableRole = {
  code: 'GUARD',
  name: 'Guard',
  scopeLevel: 'SOCIETY',
  requiresFlat: false,
};
const ADMIN: AssignableRole = {
  code: 'ADMIN',
  name: 'Admin',
  scopeLevel: 'PLATFORM',
  requiresFlat: false,
};

describe('RoleFields', () => {
  let fixture: ComponentFixture<RoleFields>;
  let component: RoleFields;
  let http: HttpTestingController;

  async function setup(
    includePlatform: boolean,
    preset: { wingId: number; flatId: number } | null = null,
  ): Promise<void> {
    TestBed.configureTestingModule({
      imports: [RoleFields],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RoleFields);
    fixture.componentRef.setInput('societyId', 1);
    fixture.componentRef.setInput('includePlatform', includePlatform);
    fixture.componentRef.setInput('preset', preset);
    component = fixture.componentInstance;
    await fixture.whenStable();
    http.expectOne('/api/roles/assignable?societyId=1').flush([RESIDENT, GUARD]);
    if (includePlatform) http.expectOne('/api/roles/assignable').flush([ADMIN]);
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  it('sends societyId only for society-scoped roles', async () => {
    await setup(true);
    component.form.controls.role.setValue('ADMIN');
    expect(component.request()).toEqual({
      role: 'ADMIN',
      societyId: undefined,
      flatId: undefined,
      residentType: undefined,
    });
    component.form.controls.role.setValue('GUARD');
    expect(component.request().societyId).toBe(1);
    expect(component.form.valid).toBe(true);
  });

  it('asks for wing, flat and resident type when the role needs a flat', async () => {
    await setup(false);
    component.form.controls.role.setValue('RESIDENT');
    await fixture.whenStable();
    expect(component.form.valid).toBe(false);

    http.expectOne('/api/societies/1/wings').flush([{ id: 5, societyId: 1, name: 'Stark Wing' }]);
    component.form.controls.wingId.setValue(5);
    http.expectOne('/api/wings/5/flats').flush([{ id: 9, wingId: 5, flatNumber: '1001' }]);
    component.form.controls.flatId.setValue(9);
    component.form.controls.residentType.setValue('OWNER');

    expect(component.form.valid).toBe(true);
    expect(component.request()).toEqual({
      role: 'RESIDENT',
      societyId: 1,
      flatId: 9,
      residentType: 'OWNER',
    });
  });

  it('starts on the resident role for a preset flat', async () => {
    await setup(false, { wingId: 5, flatId: 9 });
    expect(component.form.controls.role.value).toBe('RESIDENT');
    http.expectOne('/api/societies/1/wings').flush([
      { id: 4, societyId: 1, name: 'Other Wing' },
      { id: 5, societyId: 1, name: 'Stark Wing' },
    ]);
    http.expectOne('/api/wings/5/flats').flush([
      { id: 8, wingId: 5, flatNumber: '1002' },
      { id: 9, wingId: 5, flatNumber: '1001' },
    ]);
    component.form.controls.residentType.setValue('TENANT');
    expect(component.request()).toEqual({
      role: 'RESIDENT',
      societyId: 1,
      flatId: 9,
      residentType: 'TENANT',
    });
  });

  it('drops the flat fields when switching to a role without a flat', async () => {
    await setup(false);
    component.form.controls.role.setValue('RESIDENT');
    await fixture.whenStable();
    http.expectOne('/api/societies/1/wings').flush([]);

    component.form.controls.role.setValue('GUARD');
    await fixture.whenStable();
    expect(component.form.valid).toBe(true);
    expect(component.request().flatId).toBeUndefined();
  });
});
