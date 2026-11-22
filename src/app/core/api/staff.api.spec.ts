import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { StaffApi } from './staff.api';

describe('StaffApi', () => {
  let api: StaffApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(StaffApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('adds help as multipart, with days joined and empty fields left out', () => {
    const photo = new File(['x'], 'face.jpg', { type: 'image/jpeg' });
    api
      .addHelp(
        7,
        {
          name: 'Sunita',
          phone: '9876543210',
          staffType: 'MAID',
          idType: null,
          idNumber: '',
          work: 'Cleaning',
          days: ['MONDAY', 'WEDNESDAY'],
          timeFrom: '08:00',
          timeTo: null,
          notify: false,
        },
        photo,
        null,
      )
      .subscribe();

    const req = http.expectOne('/api/flats/7/staff');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body.get('name')).toBe('Sunita');
    expect(body.get('staffType')).toBe('MAID');
    expect(body.get('days')).toBe('MONDAY,WEDNESDAY');
    expect(body.get('timeFrom')).toBe('08:00');
    expect(body.get('notify')).toBe('false');
    expect(body.has('idType')).toBe(false);
    expect(body.has('idNumber')).toBe(false);
    expect(body.has('timeTo')).toBe(false);
    expect(body.has('idProof')).toBe(false);
    expect((body.get('photo') as File).name).toBe('face.jpg');
    expect(req.request.headers.has('Content-Type')).toBe(false);
    req.flush({});
  });

  it('skips empty directory filters', () => {
    api.directory(3, { status: 'PENDING', type: null, q: '' }).subscribe();
    http.expectOne('/api/societies/3/staff?status=PENDING').flush([]);
  });

  it('looks a phone up for a flat', () => {
    api.lookup(3, '98765 43210', 7).subscribe();
    const req = http.expectOne((r) => r.url === '/api/societies/3/staff/lookup');
    expect(req.request.params.get('phone')).toBe('98765 43210');
    expect(req.request.params.get('flatId')).toBe('7');
    req.flush({});
  });

  it('searches the gate by code or name', () => {
    api.gate(3, { code: '123456' }).subscribe();
    http.expectOne('/api/societies/3/staff/gate?code=123456').flush([]);
    api.gate(3, { q: 'suni' }).subscribe();
    http.expectOne('/api/societies/3/staff/gate?q=suni').flush([]);
  });

  it('checks in and out', () => {
    api.checkIn(5).subscribe();
    expect(http.expectOne('/api/staff/5/check-in').request.method).toBe('POST');
    api.checkOut(5).subscribe();
    expect(http.expectOne('/api/staff/5/check-out').request.method).toBe('POST');
  });

  it('reads a month of attendance, for a flat when given', () => {
    api.attendance(3, '2026-11', 7).subscribe();
    http.expectOne('/api/societies/3/staff/attendance?month=2026-11&flatId=7').flush([]);
    api.attendance(3, '2026-11').subscribe();
    http.expectOne('/api/societies/3/staff/attendance?month=2026-11').flush([]);
  });

  it('sends a block reason and an optional unblock note', () => {
    api.block(5, 'Theft').subscribe();
    expect(http.expectOne('/api/staff/5/block').request.body).toEqual({ reason: 'Theft' });
    api.unblock(5, '').subscribe();
    expect(http.expectOne('/api/staff/5/unblock').request.body).toEqual({ reason: null });
  });
});
