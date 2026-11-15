import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PolicyApi } from './policy.api';

describe('PolicyApi', () => {
  let api: PolicyApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(PolicyApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists a society’s policies with only the filters given', () => {
    api.list(3).subscribe();
    http.expectOne('/api/societies/3/policies?filter=published').flush([]);

    api.list(3, { filter: 'awaiting-approval', categoryId: 5, q: '  parking ' }).subscribe();
    http
      .expectOne('/api/societies/3/policies?filter=awaiting-approval&categoryId=5&q=parking')
      .flush([]);

    api.list(3, { filter: 'drafts', q: '   ' }).subscribe();
    http.expectOne('/api/societies/3/policies?filter=drafts').flush([]);
  });

  it('creates in the society, saves a draft whole, and moves versions through approval', () => {
    api.create(3, { categoryId: 2, title: 'Pets' }).subscribe();
    const create = http.expectOne('/api/societies/3/policies');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ categoryId: 2, title: 'Pets' });
    create.flush({});

    const draft = { body: 'Leash', changeSummary: null, effectiveFrom: null, materialChange: true };
    api.saveDraft(9, draft).subscribe();
    const put = http.expectOne('/api/policy-versions/9');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(draft);
    put.flush({});

    for (const step of ['submit', 'withdraw', 'approve', 'publish'] as const) {
      api[step](9).subscribe();
      expect(http.expectOne(`/api/policy-versions/9/${step}`).request.method).toBe('POST');
    }
    api.sendBack(9, 'Add timings').subscribe();
    expect(http.expectOne('/api/policy-versions/9/send-back').request.body).toEqual({
      reason: 'Add timings',
    });

    api.startVersion(4).subscribe();
    expect(http.expectOne('/api/policies/4/versions').request.method).toBe('POST');
  });

  it('uploads the attachment as a file part', () => {
    const file = new File(['%PDF-'], 'bylaws.pdf', { type: 'application/pdf' });
    api.setAttachment(9, file).subscribe();
    const req = http.expectOne('/api/policy-versions/9/attachment');
    expect(req.request.method).toBe('PUT');
    expect((req.request.body as FormData).get('file')).toBe(file);
    req.flush({});
  });

  it('acknowledges by version and follows up by policy', () => {
    api.acknowledge(9).subscribe();
    expect(http.expectOne('/api/policy-versions/9/acknowledge').request.method).toBe('POST');

    api.acknowledgements(4, 'pending').subscribe();
    http.expectOne('/api/policies/4/acknowledgements?state=pending').flush({});

    api.remind(4).subscribe();
    expect(http.expectOne('/api/policies/4/acknowledgements/remind').request.method).toBe('POST');

    api.pendingAcknowledgements(3).subscribe();
    http.expectOne('/api/societies/3/policies/pending-acknowledgements').flush([]);
  });
});
