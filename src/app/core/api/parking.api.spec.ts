import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ParkingApi } from './parking.api';

describe('ParkingApi', () => {
  let api: ParkingApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ParkingApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('filters slots, leaving out empty filters', () => {
    api.slots(3, { purpose: 'RESIDENT', type: null, state: 'FREE' }).subscribe();
    http.expectOne('/api/societies/3/parking/slots?purpose=RESIDENT&state=FREE').flush([]);
  });

  it('allots from the waitlist with a note', () => {
    api.allot(9, { flatId: 4, requestId: 12, note: 'Covered asked for' }).subscribe();
    const req = http.expectOne('/api/parking/slots/9/allot');
    expect(req.request.body).toEqual({ flatId: 4, requestId: 12, note: 'Covered asked for' });
    req.flush({});
  });

  it('registers a vehicle as multipart with its RC', () => {
    const rc = new File(['%PDF'], 'rc.pdf', { type: 'application/pdf' });
    api.registerVehicle(4, { registrationNumber: 'MH12AB1234', vehicleType: 'CAR', make: '', slotId: null }, rc).subscribe();
    const req = http.expectOne('/api/flats/4/vehicles');
    const body = req.request.body as FormData;
    expect(body.get('registrationNumber')).toBe('MH12AB1234');
    expect(body.get('vehicleType')).toBe('CAR');
    expect(body.has('make')).toBe(false);
    expect(body.has('slotId')).toBe(false);
    expect((body.get('rc') as File).name).toBe('rc.pdf');
    req.flush({});
  });

  it('searches vehicles at the gate', () => {
    api.searchVehicles(3, 'AB12').subscribe();
    http.expectOne('/api/societies/3/vehicles/search?number=AB12').flush([]);
  });

  it('parks a visitor and frees the slot', () => {
    api.parkVisitor(7, 2, '').subscribe();
    expect(http.expectOne('/api/visitors/7/parking').request.body).toEqual({ slotId: 2, vehicleNumber: null });
    api.freeVisitorSlot(5).subscribe();
    expect(http.expectOne('/api/parking/visitor/5/free').request.method).toBe('POST');
  });

  it('decides a report, with a fine amount only when fining', () => {
    api.decide(8, 'FINE', 300, '').subscribe();
    expect(http.expectOne('/api/parking/violations/8/decide').request.body).toEqual({ outcome: 'FINE', amount: 300, note: null });
    api.decide(8, 'WARN').subscribe();
    expect(http.expectOne('/api/parking/violations/8/decide').request.body).toEqual({ outcome: 'WARN', amount: null, note: null });
  });
});
