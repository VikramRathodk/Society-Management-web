import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ComplaintApi } from './complaint.api';

describe('ComplaintApi', () => {
  let api: ComplaintApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ComplaintApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('skips null filters when listing', () => {
    api.list({ societyId: 1, status: 'OPEN', category: null, page: 0, size: 20 }).subscribe();
    http.expectOne('/api/complaints?societyId=1&status=OPEN&page=0&size=20').flush([]);
  });

  it('sends a status change with its note, or no body without one', () => {
    api.move(7, 'resolve', 'Washer replaced').subscribe();
    const withNote = http.expectOne('/api/complaints/7/resolve');
    expect(withNote.request.method).toBe('POST');
    expect(withNote.request.body).toEqual({ note: 'Washer replaced' });
    withNote.flush({});

    api.move(7, 'close').subscribe();
    const bare = http.expectOne('/api/complaints/7/close');
    expect(bare.request.body).toBeNull();
    bare.flush({});
  });

  it('downloads the export as a blob with the full response', () => {
    let filename: string | null = null;
    api.export(1, '2026-10-01', '2026-10-28').subscribe((res) => {
      filename = res.headers.get('Content-Disposition');
      expect(res.body).toBeInstanceOf(Blob);
    });
    const req = http.expectOne('/api/complaints/export?societyId=1&from=2026-10-01&to=2026-10-28');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['id\r\n']), {
      headers: { 'Content-Disposition': 'attachment; filename="complaints-1.csv"' },
    });
    expect(filename).toContain('complaints-1.csv');
  });
});
