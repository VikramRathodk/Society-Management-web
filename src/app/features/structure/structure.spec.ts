import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { Structure } from './structure';
import { floorOf, groupByFloor, heatLevel } from './structure-ui';

describe('floorOf', () => {
  it('reads the floor from the usual numbering schemes', () => {
    expect(floorOf('101')).toBe(1);
    expect(floorOf('A-101')).toBe(1);
    expect(floorOf('1204')).toBe(12);
    expect(floorOf('G1')).toBe(0);
    expect(floorOf('g-02')).toBe(0);
    expect(floorOf('7')).toBeNull();
    expect(floorOf('Shop')).toBeNull();
  });

  it('groups flats top floor first, unparsed last', () => {
    const flat = (id: number, flatNumber: string) => ({ id, wingId: 1, flatNumber });
    const rows = groupByFloor([
      flat(1, '102'),
      flat(2, 'G1'),
      flat(3, '201'),
      flat(4, 'Shop'),
      flat(5, '101'),
    ]);
    expect(rows.map((r) => [r.floor, r.flats.map((f) => f.flatNumber)])).toEqual([
      [2, ['201']],
      [1, ['101', '102']],
      [0, ['G1']],
      [null, ['Shop']],
    ]);
  });

  it('grades heat from none to busiest', () => {
    expect(heatLevel(0, 'complaints')).toBe(0);
    expect(heatLevel(1, 'complaints')).toBe(1);
    expect(heatLevel(5, 'complaints')).toBe(4);
    expect(heatLevel(2, 'residents')).toBe(2);
  });
});

describe('Structure', () => {
  let fixture: ComponentFixture<Structure>;
  let http: HttpTestingController;
  let permissions: string[];

  const el = () => fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el().querySelectorAll(selector)].map((e) => e.textContent?.trim());

  async function setup(granted: string[]): Promise<void> {
    permissions = granted;
    localStorage.clear();
    localStorage.setItem('sm.societyId', '1');
    TestBed.configureTestingModule({
      imports: [Structure],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        // Without animations dialogs close (and report their result) synchronously.
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: AuthStore,
          useValue: { can: (p: string) => permissions.includes(p), canOnPlatform: () => false },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Structure);
    await fixture.whenStable();
  }

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    http.verify();
  });

  async function flushWings(societyId: number): Promise<void> {
    http.expectOne(`/api/societies/${societyId}/wings`).flush([
      { id: 11, societyId, name: 'Wing B' },
      { id: 10, societyId, name: 'Wing A' },
    ]);
    await fixture.whenStable();
  }

  async function flushFlats(wingId: number): Promise<void> {
    http.expectOne(`/api/wings/${wingId}/flats`).flush([
      { id: 3, wingId, flatNumber: '201' },
      { id: 1, wingId, flatNumber: '101' },
      { id: 2, wingId, flatNumber: '102' },
    ]);
    await fixture.whenStable();
  }

  describe('without activity permissions', () => {
    beforeEach(() => setup(['FLAT.DIRECTORY.VIEW']));

    it('shows wings as tabs by name and opens the first one', async () => {
      await flushWings(1);
      await flushFlats(10);
      expect(texts('.wing-tab-name')).toEqual(['Wing A', 'Wing B']);
      expect(el().querySelector('.wing-tab.active')?.textContent).toContain('Wing A');
    });

    it('draws flats floor by floor, top floor first', async () => {
      await flushWings(1);
      await flushFlats(10);
      expect(texts('.floor-label')).toEqual(['2', '1']);
      expect(texts('.unit-number')).toEqual(['201', '101', '102']);
      expect(el().textContent).toContain('3 flats · 2 floors');
    });

    it('loads another wing when its tab is picked', async () => {
      await flushWings(1);
      await flushFlats(10);
      el().querySelectorAll<HTMLElement>('.wing-tab')[1].click();
      await fixture.whenStable();
      await flushFlats(11);
      expect(el().querySelector('.building-title h2')?.textContent).toContain('Wing B');
    });

    it('reloads when the society changes', async () => {
      await flushWings(1);
      await flushFlats(10);
      TestBed.inject(SocietyContextStore).select(2);
      await fixture.whenStable();
      await flushWings(2);
      await flushFlats(10);
    });
  });

  describe('editing a flat', () => {
    beforeEach(() => setup(['FLAT.DIRECTORY.VIEW', 'FLAT.STRUCTURE.UPDATE']));

    const dialog = () => document.querySelector<HTMLElement>('app-flat-dialog')!;
    const input = (index: number) => dialog().querySelectorAll('input')[index];

    async function pickFlat101(): Promise<void> {
      await flushWings(1);
      await flushFlats(10);
      el().querySelector<HTMLElement>('[aria-label="Flat 101"]')!.click();
      await fixture.whenStable();
    }

    it('shows the area in the flat panel', async () => {
      await pickFlat101();
      expect(el().querySelector('app-flat-panel .area')?.textContent).toContain('Area not set');
    });

    it('saves a new area along with the flat number', async () => {
      await pickFlat101();
      el().querySelector<HTMLElement>('[aria-label="Edit flat"]')!.click();
      await fixture.whenStable();
      expect(input(0).value).toBe('101');
      input(1).value = '1050.5';
      input(1).dispatchEvent(new Event('input'));
      dialog().querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();

      const req = http.expectOne('/api/flats/1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ flatNumber: '101', areaSqft: 1050.5 });
      req.flush({ id: 1, wingId: 10, flatNumber: '101', areaSqft: 1050.5 });
      await fixture.whenStable();
      // The dialog reports its result after it has closed, which schedules another render.
      await fixture.whenStable();
      expect(el().querySelector('app-flat-panel .area')?.textContent).toContain('1,050.5 sq ft');
    });
  });

  describe('adding a resident', () => {
    const overlay = () => document.querySelector<HTMLElement>('.cdk-overlay-container')!;
    const clickText = async (selector: string, text: string) => {
      [...overlay().querySelectorAll<HTMLElement>(selector)]
        .find((e) => e.textContent?.includes(text))!
        .click();
      await fixture.whenStable();
    };
    const pepper = {
      id: 42,
      name: 'Pepper Potts',
      phone: '9000000042',
      email: null,
      isActive: true,
      roles: [],
    };

    async function openFlat101(): Promise<void> {
      http.expectOne('/api/users?societyId=1').flush([pepper]);
      await flushWings(1);
      await flushFlats(10);
      el().querySelector<HTMLElement>('[aria-label^="Flat 101"]')!.click();
      await fixture.whenStable();
    }

    it('opens New user with the flat filled in', async () => {
      await setup(['FLAT.DIRECTORY.VIEW', 'USER.ACCOUNT.VIEW', 'USER.ACCOUNT.CREATE']);
      await openFlat101();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      el().querySelector<HTMLElement>('.add-resident')!.click();
      await fixture.whenStable();
      // Only "New user": this viewer may not assign roles to existing users.
      expect(overlay().querySelectorAll('[mat-menu-item]').length).toBe(1);
      await clickText('[mat-menu-item]', 'New user');
      expect(navigate).toHaveBeenCalledWith(['/users/new'], {
        queryParams: { wingId: 10, flatId: 1 },
      });
    });

    it('gives an existing user a resident role and lists them on the flat', async () => {
      await setup(['FLAT.DIRECTORY.VIEW', 'USER.ACCOUNT.VIEW', 'USER.ROLE.ASSIGN']);
      await openFlat101();
      expect(el().querySelector('app-flat-panel')?.textContent).toContain('Nobody is registered');

      el().querySelector<HTMLElement>('.add-resident')!.click();
      await fixture.whenStable();
      await clickText('[mat-menu-item]', 'Existing user');

      http
        .expectOne('/api/roles/assignable?societyId=1')
        .flush([{ code: 'RESIDENT', name: 'Resident', scopeLevel: 'SOCIETY', requiresFlat: true }]);
      await fixture.whenStable();
      http.expectOne('/api/societies/1/wings').flush([{ id: 10, societyId: 1, name: 'Wing A' }]);
      await fixture.whenStable();
      http.expectOne('/api/wings/10/flats').flush([{ id: 1, wingId: 10, flatNumber: '101' }]);
      await fixture.whenStable();

      const search = document.querySelector<HTMLInputElement>('app-add-resident-dialog input')!;
      search.focus();
      search.value = 'pep';
      search.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      await clickText('mat-option', 'Pepper Potts');

      const selects = document.querySelectorAll<HTMLElement>('app-add-resident-dialog mat-select');
      selects[selects.length - 1].click(); // resident type
      await fixture.whenStable();
      await clickText('mat-option', 'Tenant');

      await clickText('app-add-resident-dialog button', 'Add');
      const req = http.expectOne('/api/users/42/roles');
      expect(req.request.body).toEqual({
        role: 'RESIDENT',
        societyId: 1,
        flatId: 1,
        residentType: 'TENANT',
      });
      req.flush({
        id: 7,
        role: 'RESIDENT',
        roleName: 'Resident',
        societyId: 1,
        flatId: 1,
        residentType: 'TENANT',
      });
      await fixture.whenStable();
      await fixture.whenStable();
      expect(el().querySelector('app-flat-panel .resident-name')?.textContent).toContain(
        'Pepper Potts',
      );
    });
  });

  describe('with complaints', () => {
    beforeEach(() => setup(['FLAT.DIRECTORY.VIEW', 'COMPLAINT.TICKET.VIEW']));

    it('colours flats by open complaints and shows them for the picked flat', async () => {
      const complaint = (id: number, flatId: number) => ({
        id,
        societyId: 1,
        flatId,
        flatNumber: '101',
        category: 'PLUMBING',
        description: 'Leak',
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      });
      http
        .expectOne((r) => r.url === '/api/complaints' && r.params.get('status') === 'OPEN')
        .flush([complaint(7, 1), complaint(8, 1)]);
      http
        .expectOne((r) => r.url === '/api/complaints' && r.params.get('status') === 'IN_PROGRESS')
        .flush([]);
      await flushWings(1);
      await flushFlats(10);

      const tile = el().querySelector<HTMLElement>('[aria-label="Flat 101: 2 open complaints"]')!;
      expect(tile.dataset['heat']).toBe('2');
      tile.click();
      await fixture.whenStable();
      expect(el().querySelector('app-flat-panel h2')?.textContent).toContain('Flat 101');
      expect(el().querySelectorAll('app-flat-panel app-complaint-row').length).toBe(2);
    });
  });
});
