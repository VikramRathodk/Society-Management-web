import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { FinanceApi } from './finance.api';

describe('FinanceApi', () => {
  let api: FinanceApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(FinanceApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists vouchers with repeated filters and drops empty ones', () => {
    api
      .vouchers({
        societyId: 4,
        status: ['PENDING_APPROVAL'],
        type: ['PAYMENT', 'JOURNAL'],
        q: null,
        from: '',
        size: 30,
      })
      .subscribe();
    http
      .expectOne(
        '/api/societies/4/finance/vouchers?status=PENDING_APPROVAL&type=PAYMENT&type=JOURNAL&size=30',
      )
      .flush([]);
  });

  it('starts the books with openings', () => {
    api.start(4, '2026-04-01', [{ accountId: 9, amount: 5000 }]).subscribe();
    const req = http.expectOne('/api/societies/4/finance/start');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      startDate: '2026-04-01',
      openings: [{ accountId: 9, amount: 5000 }],
    });
    req.flush({});
  });

  it('records a journal and voids an entry with a reason', () => {
    api
      .recordJournal(4, {
        date: '2026-05-01',
        narration: 'Fix',
        lines: [
          { accountId: 1, debit: 10 },
          { accountId: 2, credit: 10 },
        ],
      })
      .subscribe();
    const journal = http.expectOne('/api/societies/4/finance/journals');
    expect(journal.request.body.lines).toHaveLength(2);
    journal.flush({});
    api.void(7, 'Entered twice').subscribe();
    const req = http.expectOne('/api/finance/vouchers/7/void');
    expect(req.request.body).toEqual({ reason: 'Entered twice' });
    req.flush({});
  });

  it('asks for statements with only the dates given', () => {
    api.incomeExpenditure(4, { from: '2026-04-01', to: null }).subscribe();
    http.expectOne('/api/societies/4/finance/reports/income-expenditure?from=2026-04-01').flush({});
    api.balanceSheet(4).subscribe();
    http.expectOne('/api/societies/4/finance/reports/balance-sheet').flush({});
  });

  it('exports the day book and statements as files', () => {
    api.exportReport(4, 'day-book', { from: '2026-04-01' }).subscribe();
    http.expectOne('/api/societies/4/finance/day-book/export?from=2026-04-01').flush(new Blob());
    api.exportReport(4, 'trial-balance', { asOf: '2026-11-10' }).subscribe();
    http
      .expectOne('/api/societies/4/finance/reports/trial-balance/export?asOf=2026-11-10')
      .flush(new Blob());
  });

  it('uploads a document as multipart with its kind', () => {
    const file = new File(['%PDF-1.4'], 'bill.pdf', { type: 'application/pdf' });
    api.addDocument(7, file, 'INVOICE').subscribe();
    const req = http.expectOne('/api/finance/vouchers/7/documents?documentType=INVOICE');
    expect(req.request.body instanceof FormData).toBe(true);
    expect((req.request.body as FormData).get('file')).toBeTruthy();
    req.flush({});
  });

  it('maps charge heads and clears a mapping with null', () => {
    api.setChargeHeadMappings(4, [{ chargeHeadId: 3, accountId: null }]).subscribe();
    const req = http.expectOne('/api/societies/4/finance/charge-head-accounts');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ mappings: [{ chargeHeadId: 3, accountId: null }] });
    req.flush([]);
  });
});
