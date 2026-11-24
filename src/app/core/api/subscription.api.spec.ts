import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SubscriptionApi } from './subscription.api';

describe('SubscriptionApi', () => {
  let api: SubscriptionApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(SubscriptionApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the society’s subscription, its access state and its invoices', () => {
    api.get(3).subscribe();
    http.expectOne('/api/societies/3/subscription').flush({});
    api.access(3).subscribe();
    http.expectOne('/api/societies/3/subscription/access').flush({});
    api.invoicesOf(3).subscribe();
    http.expectOne('/api/societies/3/subscription/invoices').flush([]);
    api.invoice(9).subscribe();
    http.expectOne('/api/platform-invoices/9').flush({});
  });

  it('lists every invoice with only the filters given', () => {
    api.allInvoices().subscribe();
    http.expectOne('/api/platform/invoices').flush([]);
    api.allInvoices({ overdue: true }).subscribe();
    http.expectOne('/api/platform/invoices?overdue=true').flush([]);
    api.allInvoices({ status: 'PAID', overdue: false }).subscribe();
    http.expectOne('/api/platform/invoices?status=PAID').flush([]);
  });

  it('creates a Razorpay order and verifies the checkout signature', () => {
    api.razorpayOrder(9).subscribe();
    const order = http.expectOne('/api/platform-invoices/9/razorpay-order');
    expect(order.request.method).toBe('POST');
    order.flush({});

    api.razorpayVerify(9, 'order_1', 'pay_1', 'sig').subscribe();
    const verify = http.expectOne('/api/platform-invoices/9/razorpay-verify');
    expect(verify.request.body).toEqual({ orderId: 'order_1', paymentId: 'pay_1', signature: 'sig' });
    verify.flush({});
  });

  it('changes plans, discounts, the billing contact and records payments', () => {
    api.changePlan(3, 2, 'YEARLY').subscribe();
    const change = http.expectOne('/api/societies/3/subscription/plan');
    expect(change.request.method).toBe('PATCH');
    expect(change.request.body).toEqual({ planId: 2, cycle: 'YEARLY' });
    change.flush({});

    api.setDiscount(3, 10, 3, null).subscribe();
    expect(http.expectOne('/api/societies/3/subscription/discount').request.body).toEqual({
      percent: 10,
      periods: 3,
      note: null,
    });

    api.setBillingContact(3, 7).subscribe();
    expect(http.expectOne('/api/societies/3/subscription/billing-contact').request.body).toEqual({ userId: 7 });

    api.requestChange(3, 1, null, 'cheaper please').subscribe();
    expect(http.expectOne('/api/societies/3/subscription/request-change').request.body).toEqual({
      planId: 1,
      cycle: null,
      note: 'cheaper please',
    });

    api.recordPayment(9, { amount: 590, mode: 'UPI', paidOn: '2026-11-17' }).subscribe();
    const pay = http.expectOne('/api/platform-invoices/9/payments');
    expect(pay.request.body).toEqual({ amount: 590, mode: 'UPI', paidOn: '2026-11-17' });
    pay.flush({});

    api.creditNote(9, 100, 'Goodwill').subscribe();
    expect(http.expectOne('/api/platform-invoices/9/credit-notes').request.body).toEqual({
      amount: 100,
      reason: 'Goodwill',
    });
  });

  it('runs billing, starts subscriptions and issues the due invoice', () => {
    api.run().subscribe();
    expect(http.expectOne('/api/platform/billing/run').request.method).toBe('POST');
    api.startAll().subscribe();
    http.expectOne('/api/platform/subscriptions/start-all').flush({ started: 2 });
    api.issueDue(3).subscribe();
    http.expectOne('/api/societies/3/subscription/invoices/issue-due').flush(null, {
      status: 204,
      statusText: 'No Content',
    });
  });
});
