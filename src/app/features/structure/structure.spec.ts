import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuthStore } from '../../core/auth/auth.store';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { Structure } from './structure';

describe('Structure', () => {
  let fixture: ComponentFixture<Structure>;
  let http: HttpTestingController;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('sm.societyId', '1');
    TestBed.configureTestingModule({
      imports: [Structure],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { can: () => true, canOnPlatform: () => false } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Structure);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  async function flushWings(societyId: number): Promise<void> {
    http.expectOne(`/api/societies/${societyId}/wings`).flush([
      { id: 11, societyId, name: 'Wing B' },
      { id: 10, societyId, name: 'Wing A' },
    ]);
    await fixture.whenStable();
  }

  it('lists wings of the selected society by name', async () => {
    await flushWings(1);
    const titles = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('mat-panel-title'),
    ].map((el) => el.textContent?.trim());
    expect(titles).toEqual(['Wing A', 'Wing B']);
  });

  it('loads flats when a wing is opened, in natural order', async () => {
    await flushWings(1);
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('mat-expansion-panel-header')!
      .click();
    await fixture.whenStable();
    http.expectOne('/api/wings/10/flats').flush([
      { id: 3, wingId: 10, flatNumber: '1001' },
      { id: 1, wingId: 10, flatNumber: '101' },
      { id: 2, wingId: 10, flatNumber: '102' },
    ]);
    await fixture.whenStable();
    const tiles = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.flat-tile')].map(
      (el) => el.textContent?.trim(),
    );
    expect(tiles).toEqual(['101', '102', '1001']);
    expect(text()).toContain('3 flats');
  });

  it('reloads when the society changes', async () => {
    await flushWings(1);
    TestBed.inject(SocietyContextStore).select(2);
    await fixture.whenStable();
    await flushWings(2);
  });
});
