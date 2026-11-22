import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SocietyPermissionApi } from './society-permission.api';

describe('SocietyPermissionApi', () => {
  let api: SocietyPermissionApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(SocietyPermissionApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads and saves a role in the society, and resets it with a reason', () => {
    api.roles(3).subscribe();
    http.expectOne('/api/societies/3/roles/permissions').flush([]);

    const change = { grant: ['NOTICE.POST.CREATE'], revoke: [], reason: 'Gate notices' };
    api.saveRole(3, 'GUARD', change).subscribe();
    const put = http.expectOne('/api/societies/3/roles/GUARD/permissions');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(change);
    put.flush({});

    api.resetRole(3, 'GUARD', '').subscribe();
    const reset = http.expectOne('/api/societies/3/roles/GUARD/permissions/reset');
    expect(reset.request.method).toBe('POST');
    expect(reset.request.body).toEqual({ reason: null });
    reset.flush({});
  });

  it('changes a person, copies from another and applies a preset', () => {
    api.member(3, 7).subscribe();
    http.expectOne('/api/societies/3/members/7/permissions').flush({});

    api.saveMember(3, 7, { grant: [], revoke: ['VISITOR.ENTRY.EXPORT'] }).subscribe();
    expect(http.expectOne('/api/societies/3/members/7/permissions').request.method).toBe('PUT');

    api.copyFrom(3, 7, 9).subscribe();
    expect(
      http.expectOne('/api/societies/3/members/7/permissions/copy-from/9').request.method,
    ).toBe('POST');

    api.applyPreset(3, 7, 2).subscribe();
    expect(
      http.expectOne('/api/societies/3/members/7/permissions/apply-preset/2').request.method,
    ).toBe('POST');

    api.resetMember(3, 7, 'Left the committee').subscribe();
    expect(http.expectOne('/api/societies/3/members/7/permissions/reset').request.body).toEqual({
      reason: 'Left the committee',
    });
  });

  it('keeps presets and filters the history with only the filters given', () => {
    const body = { name: 'Treasurer', grant: ['MAINTENANCE.PAYMENT.CREATE'], revoke: [] };
    api.createPreset(3, body).subscribe();
    const post = http.expectOne('/api/societies/3/permission-presets');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(body);
    post.flush({});

    api.updatePreset(2, body).subscribe();
    expect(http.expectOne('/api/permission-presets/2').request.method).toBe('PUT');
    api.deletePreset(2).subscribe();
    expect(http.expectOne('/api/permission-presets/2').request.method).toBe('DELETE');

    api.history(3).subscribe();
    http.expectOne('/api/societies/3/permissions/history').flush([]);
    api.history(3, { userId: 7, role: null, from: '2026-11-01', to: '' }).subscribe();
    http.expectOne('/api/societies/3/permissions/history?userId=7&from=2026-11-01').flush([]);
    api.exportHistory(3, { role: 'GUARD' }).subscribe();
    const csv = http.expectOne('/api/societies/3/permissions/history/export?role=GUARD');
    expect(csv.request.responseType).toBe('blob');
  });
});
