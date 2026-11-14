import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';

import { StructureGenerator } from './structure-generator';

describe('StructureGenerator', () => {
  let fixture: ComponentFixture<StructureGenerator>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    )!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [StructureGenerator],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StructureGenerator);
    fixture.componentRef.setInput('societyId', 7);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows a sample of the numbering as it is typed', async () => {
    expect(el().querySelector('[data-testid="sample"]')?.textContent).toContain(
      '101, 102, 103, 104 … 404',
    );
  });

  it('previews, then creates only what is new', async () => {
    button('Another wing').click();
    await fixture.whenStable();
    button('Preview').click();
    const preview = http.expectOne('/api/societies/7/structure/preview');
    expect(preview.request.body.wings.map((w: { wing: string }) => w.wing)).toEqual(['A', 'B']);
    expect(preview.request.body.wings[0]).toEqual({
      wing: 'A',
      floorsFrom: 1,
      floorsTo: 4,
      flatsPerFloor: 4,
      numbering: '{floor}{nn}',
      skip: [],
      extraUnits: [],
    });
    const plan = [
      {
        name: 'A',
        exists: true,
        newFlats: 15,
        existingFlats: 1,
        flats: [
          { number: '101', exists: true },
          { number: '102', exists: false },
        ],
      },
      {
        name: 'B',
        exists: false,
        newFlats: 16,
        existingFlats: 0,
        flats: [{ number: '101', exists: false }],
      },
    ];
    preview.flush(plan);
    await fixture.whenStable();
    expect(el().textContent).toContain('31 new flats, 1 already there');
    expect(el().querySelectorAll('.flat.exists').length).toBe(1);

    let generated = false;
    fixture.componentInstance.generated.subscribe(() => (generated = true));
    button('Create 31 flats').click();
    http.expectOne('/api/societies/7/structure/generate').flush(plan);
    await fixture.whenStable();
    expect(el().textContent).toContain('Created 31 flats');
    expect(generated).toBe(true);
  });

  it('shows why a pattern was refused', async () => {
    button('Preview').click();
    http
      .expectOne('/api/societies/7/structure/preview')
      .flush(
        { message: 'Wing A: the numbering gives 111 more than once' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('111 more than once');
  });
});
