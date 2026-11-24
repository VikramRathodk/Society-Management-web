import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PaymentApi } from './payment.api';

describe('PaymentApi', () => {
  let api: PaymentApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(PaymentApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends the linked-account form, first as a POST and to correct it as a PUT', () => {
    const body = {
      legalName: 'Green CHS',
      businessType: 'society',
      pan: 'AABAA1234C',
      contactName: 'Asha',
      email: 'a@example.com',
      phone: '9876543210',
      signatoryPan: null,
      street1: '1 Road',
      street2: null,
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      accountNumber: '50100123456789',
      ifsc: 'HDFC0001234',
      beneficiaryName: 'Green CHS',
    };
    api.submitAccount(3, body, false).subscribe();
    expect(http.expectOne('/api/societies/3/payment-account').request.method).toBe('POST');
    api.submitAccount(3, body, true).subscribe();
    const put = http.expectOne('/api/societies/3/payment-account');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body.accountNumber).toBe('50100123456789');
  });

  it('quotes, orders and verifies a resident payment', () => {
    api.quote(7, 2000).subscribe();
    expect(http.expectOne('/api/flats/7/online-payments/quote').request.body).toEqual({ amount: 2000, billId: null });
    api.order(7, null, 12).subscribe();
    expect(http.expectOne('/api/flats/7/online-payments/order').request.body).toEqual({ amount: null, billId: 12 });
    api.verify(7, 'order_1', 'pay_1', 'sig').subscribe();
    expect(http.expectOne('/api/flats/7/online-payments/verify').request.body).toEqual({
      orderId: 'order_1',
      paymentId: 'pay_1',
      signature: 'sig',
    });
  });

  it('lists payments for a range, refunds a payment and retries a transfer', () => {
    api.payments(3, '2026-11-01', null).subscribe();
    http.expectOne('/api/societies/3/online-payments?from=2026-11-01').flush([]);
    api.refundPayment(3, 44, 'Paid twice').subscribe();
    expect(http.expectOne('/api/societies/3/maintenance/payments/44/gateway-refund').request.body).toEqual({
      reason: 'Paid twice',
    });
    api.retryTransfer(9).subscribe();
    expect(http.expectOne('/api/platform/payment-transfers/9/retry').request.method).toBe('POST');
  });
});
