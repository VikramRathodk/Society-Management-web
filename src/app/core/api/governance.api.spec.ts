import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { GovernanceApi } from './governance.api';

describe('GovernanceApi', () => {
  let api: GovernanceApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(GovernanceApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists meetings by view and kind', () => {
    api.list(3).subscribe();
    http.expectOne('/api/societies/3/meetings?view=upcoming').flush([]);
    api.list(3, 'past', 'COMMITTEE').subscribe();
    http.expectOne('/api/societies/3/meetings?view=past&kind=COMMITTEE').flush([]);
  });

  it('announces, adjourns and cancels by meeting id', () => {
    api.sendNotice(7, 'Urgent repair').subscribe();
    const notice = http.expectOne('/api/meetings/7/send-notice');
    expect(notice.request.body).toEqual({ shortNoticeReason: 'Urgent repair' });
    notice.flush({});

    api.adjourn(7, { scheduledAt: '2026-12-01T10:00:00Z', reason: 'No quorum' }).subscribe();
    expect(http.expectOne('/api/meetings/7/adjourn').request.method).toBe('POST');

    api.cancel(7, 'Hall flooded').subscribe();
    expect(http.expectOne('/api/meetings/7/cancel').request.body).toEqual({
      reason: 'Hall flooded',
    });
  });

  it('runs the meeting: attendance, voting, register', () => {
    api.setAttendance(7, [1, 2]).subscribe();
    const put = http.expectOne('/api/meetings/7/attendance');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ userIds: [1, 2] });
    put.flush({});

    api.openVoting(11, 1, 2).subscribe();
    expect(http.expectOne('/api/agenda-items/11/open-voting').request.body).toEqual({
      proposedBy: 1,
      secondedBy: 2,
    });

    api.vote(11, 'FOR', 5).subscribe();
    expect(http.expectOne('/api/agenda-items/11/vote').request.body).toEqual({
      choice: 'FOR',
      flatId: 5,
    });

    api.resolutions(3, ' paint ', 'all').subscribe();
    http.expectOne('/api/societies/3/resolutions?outcome=all&q=paint').flush([]);
  });

  it('moves minutes through approval', () => {
    api.saveMinutes(7, 'Text').subscribe();
    expect(http.expectOne('/api/meetings/7/minutes').request.method).toBe('PUT');
    for (const [call, path] of [
      [() => api.submitMinutes(7), 'submit'],
      [() => api.approveMinutes(7), 'approve'],
      [() => api.announceMinutes(7), 'announce'],
    ] as const) {
      call().subscribe();
      expect(http.expectOne(`/api/meetings/7/minutes/${path}`).request.method).toBe('POST');
    }
    api.sendBackMinutes(7, 'Add names').subscribe();
    expect(http.expectOne('/api/meetings/7/minutes/send-back').request.body).toEqual({
      reason: 'Add names',
    });
  });
});
