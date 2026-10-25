import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, of, throwError } from 'rxjs';

import { nameDialog } from './name-dialog';

describe('nameDialog', () => {
  let dialog: MatDialog;

  beforeEach(() => {
    // Without animations the dialog closes (and reports its result) synchronously.
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    dialog = TestBed.inject(MatDialog);
  });

  afterEach(() => dialog.closeAll());

  function overlay(): HTMLElement {
    return document.querySelector('.cdk-overlay-container') as HTMLElement;
  }

  async function submit(value: string): Promise<void> {
    const input = overlay().querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    overlay().querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await TestBed.inject(ApplicationRef).whenStable();
  }

  it('shows a 400 inline and closes with the result once saved', async () => {
    let attempt = 0;
    const save = (name: string): Observable<{ name: string }> =>
      attempt++ === 0
        ? throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: { message: 'Flat number already exists in this wing' },
              }),
          )
        : of({ name });

    let result: { name: string } | undefined;
    nameDialog(dialog, { title: 'Add flat', label: 'Flat number', save }).subscribe(
      (r) => (result = r),
    );
    await TestBed.inject(ApplicationRef).whenStable();

    await submit('101');
    expect(overlay().textContent).toContain('Flat number already exists in this wing');
    expect(result).toBeUndefined();

    await submit('  102 ');
    expect(result).toEqual({ name: '102' });
  });
});
