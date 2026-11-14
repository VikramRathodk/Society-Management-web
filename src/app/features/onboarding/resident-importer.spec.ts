import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';

import { ImportRow, ResidentImport } from '../../core/models';
import { ResidentImporter } from './resident-importer';

const row = (id: number, over: Partial<ImportRow> = {}): ImportRow => ({
  id,
  row: id + 1,
  wingText: 'A',
  flatText: '10' + id,
  name: 'Person ' + id,
  phoneText: '981110000' + id,
  typeText: 'Owner',
  flatId: id,
  flatLabel: 'A-10' + id,
  phone: '981110000' + id,
  residentType: 'OWNER',
  error: null,
  invitationId: null,
  ...over,
});

const sheet = (rows: ImportRow[]): ResidentImport => ({
  id: 1,
  fileName: 'residents.csv',
  status: 'OPEN',
  uploadedAt: '2026-11-14T10:00:00Z',
  uploadedByName: 'Sec',
  sentAt: null,
  total: rows.length,
  ready: rows.filter((r) => !r.error).length,
  withErrors: rows.filter((r) => r.error).length,
  sent: 0,
  rows,
});

describe('ResidentImporter', () => {
  let fixture: ComponentFixture<ResidentImporter>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  async function setup(live: boolean, current: ResidentImport | null): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ResidentImporter],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ResidentImporter);
    fixture.componentRef.setInput('societyId', 7);
    fixture.componentRef.setInput('societyName', 'Lake View');
    fixture.componentRef.setInput('live', live);
    await fixture.whenStable();
    http
      .expectOne('/api/societies/7/resident-imports/current')
      .flush(current, current ? {} : { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
  }

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    http.verify();
  });

  it('uploads a sheet and shows each row with its problem', async () => {
    await setup(false, null);
    const input = el().querySelector<HTMLInputElement>('[data-testid="sheet-input"]')!;
    const file = new File(['Flat,Name,Phone\nA-101,Meera,9811100001\n'], 'residents.csv', {
      type: 'text/csv',
    });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    http
      .expectOne((r) => r.url === '/api/societies/7/resident-imports')
      .flush({
        sheet: sheet([
          row(1),
          row(2, { error: 'No flat A-999 in this society', flatId: null, flatLabel: null }),
        ]),
        header: ['Flat', 'Name', 'Phone'],
        columns: { flat: 1, name: 2, phone: 3, wing: null, type: null },
      });
    await fixture.whenStable();
    expect(el().textContent).toContain('1 ready');
    expect(el().textContent).toContain('1 with problems');
    expect(el().textContent).toContain('No flat A-999 in this society');
    // In Setup nothing is sent from here.
    expect(el().textContent).toContain('become invitations when the society goes live');
    expect([...el().querySelectorAll('button')].some((b) => b.textContent?.includes('Send'))).toBe(
      false,
    );
  });

  it('leaves a row out', async () => {
    await setup(false, sheet([row(1), row(2)]));
    el().querySelector<HTMLButtonElement>('[aria-label="Leave out row 3"]')!.click();
    http.expectOne('/api/societies/7/resident-imports/current/rows/2').flush(sheet([row(1)]));
    await fixture.whenStable();
    expect(el().querySelectorAll('tbody tr').length).toBe(1);
  });

  it('in a live society sends the ready rows and offers the links', async () => {
    await setup(true, sheet([row(1), row(2)]));
    [...el().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Send 2 invitations'))!
      .click();
    await fixture.whenStable();
    [...document.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')]
      .find((b) => b.textContent?.includes('Send'))!
      .click();
    await fixture.whenStable();
    http.expectOne('/api/societies/7/resident-imports/current/send').flush({
      sent: [
        {
          row: 2,
          flatLabel: 'A-101',
          name: 'Person 1',
          phone: '9811100001',
          invitationId: 5,
          token: 't',
          inviteUrl: 'http://app/invite/t',
        },
      ],
      skipped: [row(2, { error: 'A-102 is full (2 people allowed per flat)' })],
    });
    await fixture.whenStable();
    expect(el().textContent).toContain('1 invitations sent');
    expect(el().textContent).toContain('1 rows were left out');
    expect(el().textContent).toContain('A-102 is full');
  });
});
