import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { StatementMapping } from '../models';
import { ReconciliationApi } from './reconciliation.api';

const mapping: StatementMapping = {
  delimiter: ',',
  headerRow: 1,
  dateColumn: 1,
  dateFormat: 'dd/MM/yyyy',
  descriptionColumn: 2,
  referenceColumn: null,
  amountStyle: 'DEBIT_CREDIT',
  debitColumn: 3,
  creditColumn: 4,
  amountColumn: null,
  typeColumn: null,
  balanceColumn: 5,
};

describe('ReconciliationApi', () => {
  let api: ReconciliationApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ReconciliationApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('previews a file with a mapping as a JSON part', async () => {
    const file = new File(['Date,Narration\n'], 'apr.csv', { type: 'text/csv' });
    api.preview(7, file, mapping).subscribe();
    const req = http.expectOne('/api/finance/bank-accounts/7/statement-preview');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect((body.get('file') as File).name).toBe('apr.csv');
    const part = body.get('mapping') as Blob;
    expect(part.type).toBe('application/json');
    expect(JSON.parse(await part.text())).toEqual(mapping);
    req.flush({});
  });

  it('previews without a mapping part when none is given', () => {
    api.preview(7, new File(['x'], 'a.csv')).subscribe();
    const req = http.expectOne('/api/finance/bank-accounts/7/statement-preview');
    expect((req.request.body as FormData).has('mapping')).toBe(false);
    req.flush({});
  });

  it("lists one account's statements", () => {
    api.statements(4, 7).subscribe();
    http.expectOne('/api/societies/4/finance/statements?accountId=7').flush([]);
  });

  it('asks for uncleared book entries by default', () => {
    api.bookEntries(12).subscribe();
    http.expectOne('/api/finance/statements/12/book-entries?cleared=false').flush([]);
    api.bookEntries(12, true).subscribe();
    http.expectOne('/api/finance/statements/12/book-entries?cleared=true').flush([]);
  });

  it('matches a bank line to several entries and unmatches it', () => {
    api.match(12, 40, [101, 102]).subscribe();
    const req = http.expectOne('/api/finance/statements/12/lines/40/match');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ bookLineIds: [101, 102] });
    req.flush({});
    api.unmatch(12, 40).subscribe();
    expect(http.expectOne('/api/finance/statements/12/lines/40/match').request.method).toBe(
      'DELETE',
    );
  });

  it('pairs two entries and reopens with a reason', () => {
    api.pair(12, 101, 102).subscribe();
    expect(http.expectOne('/api/finance/statements/12/pairs').request.body).toEqual({
      firstLineId: 101,
      secondLineId: 102,
    });
    api.reopen(12, 'Bank corrected a line').subscribe();
    expect(http.expectOne('/api/finance/statements/12/reopen').request.body).toEqual({
      reason: 'Bank corrected a line',
    });
  });

  it('downloads the BRS as CSV', () => {
    api.exportBrs(12).subscribe();
    const req = http.expectOne('/api/finance/statements/12/brs.csv');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob());
  });
});
