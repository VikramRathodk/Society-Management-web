import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { INLINE_ERRORS } from '../auth/error.interceptor';
import { OnboardingApi } from './onboarding.api';

describe('OnboardingApi', () => {
  let api: OnboardingApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(OnboardingApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a society with its secretary, showing errors inline', () => {
    const body = { name: 'Sunrise', secretary: { name: 'Ravi', phone: '9876543210' } };
    api.createWithSecretary(body).subscribe();
    const req = http.expectOne('/api/onboarding/societies');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    expect(req.request.context.get(INLINE_ERRORS)).toBe(true);
    req.flush({});
  });

  it('reads whether registration is open', () => {
    let enabled: boolean | undefined;
    api.selfSignupEnabled().subscribe((on) => (enabled = on));
    http.expectOne('/api/society-applications/public/enabled').flush({ enabled: false });
    expect(enabled).toBe(false);
  });

  it('looks a registration up by number and phone', () => {
    api.applicationStatus(12, '9876543210').subscribe();
    const req = http.expectOne((r) => r.url === '/api/society-applications/public/status');
    expect(req.request.params.get('number')).toBe('12');
    expect(req.request.params.get('phone')).toBe('9876543210');
    req.flush({});
  });

  it('lists registrations by status, and all without one', () => {
    api.applications('PENDING').subscribe();
    expect(
      http.expectOne((r) => r.url === '/api/society-applications').request.params.get('status'),
    ).toBe('PENDING');
    api.applications(null).subscribe();
    expect(
      http.expectOne((r) => r.url === '/api/society-applications').request.params.has('status'),
    ).toBe(false);
    http.match(() => true).forEach((r) => r.flush([]));
  });

  it('rejects with the reason', () => {
    api.reject(3, 'Not reachable').subscribe();
    const req = http.expectOne('/api/society-applications/3/reject');
    expect(req.request.body).toEqual({ reason: 'Not reachable' });
    req.flush({});
  });

  it('previews and generates wings with the same body', () => {
    const wings = [{ wing: 'A', floorsFrom: 1, floorsTo: 2, flatsPerFloor: 2 }];
    api.previewStructure(4, wings).subscribe();
    expect(http.expectOne('/api/societies/4/structure/preview').request.body).toEqual({ wings });
    api.generateStructure(4, wings).subscribe();
    expect(http.expectOne('/api/societies/4/structure/generate').request.body).toEqual({ wings });
    http.match(() => true).forEach((r) => r.flush([]));
  });

  it('uploads a residents sheet, with chosen columns as parameters', () => {
    const file = new File(['Flat,Name,Phone\n'], 'r.csv', { type: 'text/csv' });
    api.uploadResidents(4, file).subscribe();
    const guessed = http.expectOne((r) => r.url === '/api/societies/4/resident-imports');
    expect((guessed.request.body as FormData).get('file')).toBeInstanceOf(File);
    expect(guessed.request.params.keys()).toEqual([]);
    guessed.flush({});

    api.uploadResidents(4, file, { flat: 2, name: 1, phone: 3, wing: null, type: 5 }).subscribe();
    const chosen = http.expectOne((r) => r.url === '/api/societies/4/resident-imports');
    expect(chosen.request.params.get('flatColumn')).toBe('2');
    expect(chosen.request.params.get('nameColumn')).toBe('1');
    expect(chosen.request.params.get('phoneColumn')).toBe('3');
    expect(chosen.request.params.has('wingColumn')).toBe(false);
    expect(chosen.request.params.get('typeColumn')).toBe('5');
    chosen.flush({});
  });

  it('reads the current sheet as null when there is none', () => {
    let current: unknown = 'unset';
    api.currentResidents(4).subscribe((c) => (current = c));
    http.expectOne('/api/societies/4/resident-imports/current').flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    expect(current).toBeNull();
  });

  it('goes live and sends the sheet', () => {
    api.goLive(4).subscribe();
    expect(http.expectOne('/api/societies/4/go-live').request.method).toBe('POST');
    api.sendResidents(4).subscribe();
    expect(http.expectOne('/api/societies/4/resident-imports/current/send').request.method).toBe(
      'POST',
    );
    http.match(() => true).forEach((r) => r.flush({}));
  });
});
