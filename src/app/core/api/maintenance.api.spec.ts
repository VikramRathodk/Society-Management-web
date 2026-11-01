import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { MaintenanceApi } from './maintenance.api';

describe('MaintenanceApi', () => {
  let api: MaintenanceApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(MaintenanceApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists bills with only the filters that are set', () => {
    api
      .bills({
        societyId: 3,
        status: 'UNPAID',
        cycleId: null,
        flatId: undefined,
        page: 0,
        size: 20,
      })
      .subscribe();
    http.expectOne('/api/maintenance/bills?societyId=3&status=UNPAID&page=0&size=20').flush([]);
  });

  it('records a payment against the society', () => {
    api
      .recordPayment(3, { flatId: 7, amount: 1500, paidOn: '2026-10-05', method: 'UPI', billId: 9 })
      .subscribe();
    const req = http.expectOne('/api/societies/3/maintenance/payments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      flatId: 7,
      amount: 1500,
      paidOn: '2026-10-05',
      method: 'UPI',
      billId: 9,
    });
    req.flush({});
  });

  it('voids, waives and cancels with a reason', () => {
    api.voidPayment(5, 'Cheque bounced').subscribe();
    const v = http.expectOne('/api/maintenance/payments/5/void');
    expect(v.request.body).toEqual({ reason: 'Cheque bounced' });
    v.flush({});

    api.waiveBill(6, 'Hardship').subscribe();
    http.expectOne('/api/maintenance/bills/6/waive').flush({});

    api.cancelCycle(2, 'Wrong rate').subscribe();
    http.expectOne('/api/maintenance/cycles/2/cancel').flush({});
  });

  it('previews and issues a cycle for a period', () => {
    const period = { periodStart: '2026-11-01', periodEnd: '2026-11-30', dueDate: '2026-11-16' };
    api.preview(3, period).subscribe();
    const preview = http.expectOne('/api/societies/3/maintenance/cycles/preview');
    expect(preview.request.body).toEqual(period);
    preview.flush({});

    api.issue(3, period).subscribe();
    http.expectOne('/api/societies/3/maintenance/cycles').flush({});
  });

  it('reads dues and reminds all defaulters or chosen flats', () => {
    api.dues(3, true).subscribe();
    http.expectOne('/api/societies/3/maintenance/dues?overdueOnly=true').flush([]);

    api.remind(3).subscribe();
    expect(http.expectOne('/api/societies/3/maintenance/dues/remind').request.body).toEqual({});

    api.remind(3, [7, 8]).subscribe();
    expect(http.expectOne('/api/societies/3/maintenance/dues/remind').request.body).toEqual({
      flatIds: [7, 8],
    });
  });

  it('exports payments for a date range as a file', () => {
    api.exportPayments(3, '2026-10-01', '2026-10-31').subscribe();
    const req = http.expectOne(
      '/api/societies/3/maintenance/payments/export?from=2026-10-01&to=2026-10-31',
    );
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob());
  });
});
