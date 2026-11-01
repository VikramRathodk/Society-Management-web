import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../core/auth/auth.store';
import { Command, CommandPalette, matchScore, splitMatch } from './command-palette';

describe('matchScore', () => {
  it('ranks prefix over word start over substring over letters in order', () => {
    const prefix = matchScore('Visitors', 'vis');
    const word = matchScore('Log visitor', 'vis');
    const inside = matchScore('Devise', 'vis');
    const fuzzy = matchScore('Log visitor', 'lgv');
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
    expect(matchScore('Notices', 'xyz')).toBe(0);
  });

  it('splits out the matched part for highlighting', () => {
    expect(splitMatch('Wing A · 101', '101')).toEqual(['Wing A · ', '101', '']);
    expect(splitMatch('Users', 'zz')).toEqual(['Users', '', '']);
  });
});

describe('CommandPalette', () => {
  let ran: string[];
  let closed: boolean;
  let http: HttpTestingController;

  const command = (id: string, group: Command['group'], label: string): Command => ({
    id,
    group,
    label,
    icon: 'circle',
    run: () => ran.push(id),
  });

  async function create() {
    localStorage.clear();
    localStorage.setItem('sm.societyId', '1');
    ran = [];
    closed = false;
    TestBed.configureTestingModule({
      imports: [CommandPalette],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { can: () => true, canOnPlatform: () => false } },
        { provide: MatDialogRef, useValue: { close: () => (closed = true) } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            commands: [
              command('page:/visitors', 'Pages', 'Visitors'),
              command('page:/notices', 'Pages', 'Notices'),
              command('act:visitor', 'Actions', 'Log visitor'),
            ],
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CommandPalette);
    await fixture.whenStable();
    http
      .expectOne('/api/users?societyId=1')
      .flush([
        { id: 5, name: 'Vikram Rao', phone: '9000000001', email: null, isActive: true, roles: [] },
      ]);
    http.expectOne('/api/societies/1/wings').flush([{ id: 10, societyId: 1, name: 'A' }]);
    http.expectOne('/api/wings/10/flats').flush([{ id: 3, wingId: 10, flatNumber: '101' }]);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  async function type(fixture: Awaited<ReturnType<typeof create>>, value: string) {
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    return input;
  }

  const labels = (fixture: Awaited<ReturnType<typeof create>>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('.item-label')].map((e) =>
      e.textContent?.trim(),
    );

  it('shows actions and pages before anything is typed', async () => {
    const fixture = await create();
    expect(labels(fixture)).toEqual(['Log visitor', 'Visitors', 'Notices']);
  });

  it('finds people and flats, best match first', async () => {
    const fixture = await create();
    await type(fixture, 'vik');
    expect(labels(fixture)[0]).toBe('Vikram Rao');
    await type(fixture, '101');
    expect(labels(fixture)).toEqual(['A · 101']);
  });

  it('runs the highlighted command with the keyboard and remembers it', async () => {
    const fixture = await create();
    const input = await type(fixture, 'vis');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await fixture.whenStable();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(closed).toBe(true);
    expect(ran.length).toBe(1);
    expect(JSON.parse(localStorage.getItem('sm.palette.recent')!)).toEqual(ran);
  });
});
