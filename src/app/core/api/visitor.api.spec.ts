import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { VisitorApi } from './visitor.api';

describe('VisitorApi', () => {
  let api: VisitorApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(VisitorApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('logs a visitor as multipart, leaving out empty optional fields', () => {
    const photo = new File(['x'], 'face.jpg', { type: 'image/jpeg' });
    api.log({ flatId: 9, visitorName: 'Peter Parker', purpose: 'Delivery' }, photo).subscribe();

    const req = http.expectOne('/api/visitors');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('flatId')).toBe('9');
    expect(body.get('visitorName')).toBe('Peter Parker');
    expect(body.get('purpose')).toBe('Delivery');
    expect(body.has('visitorPhone')).toBe(false);
    expect((body.get('photo') as File).name).toBe('face.jpg');
    // The browser must set the multipart boundary itself.
    expect(req.request.headers.has('Content-Type')).toBe(false);
    req.flush({});
  });

  it('skips null filters when listing', () => {
    api.list({ societyId: 1, status: null, page: 0, size: 20 }).subscribe();
    http.expectOne('/api/visitors?societyId=1&page=0&size=20').flush([]);
  });
});
