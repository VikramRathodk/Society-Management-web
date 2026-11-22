import { durationLabel, hhmm, monthOf, scheduleLabel, staffState, typeLabel } from './staff-ui';
import { canOpenMyStaff, canOpenStaff } from './staff-access';
import { AuthStore } from '../../core/auth/auth.store';

describe('staff labels', () => {
  it('describes the usual days and times', () => {
    expect(scheduleLabel({ days: ['WEDNESDAY', 'MONDAY'], timeFrom: '08:00:00', timeTo: '09:30:00' })).toBe(
      'Mon, Wed · 08:00–09:30',
    );
    expect(
      scheduleLabel({
        days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
        timeFrom: null,
        timeTo: null,
      }),
    ).toBe('Every day');
    expect(scheduleLabel({ days: [], timeFrom: '17:00:00', timeTo: null })).toBe('17:00');
    expect(scheduleLabel({ days: [], timeFrom: null, timeTo: null })).toBe('');
  });

  it('formats durations, times and months', () => {
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(120)).toBe('2 h');
    expect(durationLabel(210)).toBe('3 h 30 min');
    expect(hhmm('08:05:00')).toBe('08:05');
    expect(hhmm(null)).toBe('');
    expect(monthOf(new Date(2026, 0, 31))).toBe('2026-01');
    expect(typeLabel('DRIVER')).toBe('Driver');
  });

  it('shows blocked before the verification status', () => {
    expect(staffState({ blocked: true, status: 'VERIFIED' }).label).toBe('Blocked');
    expect(staffState({ blocked: false, status: 'PENDING' }).tone).toBe('warning');
    expect(staffState({ blocked: false, status: 'VERIFIED' }).tone).toBe('success');
    expect(staffState({ blocked: false, status: 'REJECTED' }).label).toBe('Not verified');
  });
});

describe('staff access', () => {
  const auth = (permissions: string[], flatId: number | null) =>
    ({
      can: (p: string, societyId?: number | null) => societyId === 1 && permissions.includes(p),
      user: () => ({ roles: [{ societyId: 1, flatId }] }),
    }) as unknown as AuthStore;

  it('opens "My staff" only for someone with a flat here', () => {
    expect(canOpenMyStaff(auth(['STAFF.MEMBER.VIEW'], 7), 1)).toBe(true);
    expect(canOpenMyStaff(auth(['STAFF.MEMBER.VIEW'], null), 1)).toBe(false);
    expect(canOpenMyStaff(auth([], 7), 1)).toBe(false);
  });

  it('opens a person for residents, the committee and guards', () => {
    expect(canOpenStaff(auth(['STAFF.ENTRY.VIEW'], null), 1)).toBe(true);
    expect(canOpenStaff(auth(['STAFF.DIRECTORY.VIEW'], null), 1)).toBe(true);
    expect(canOpenStaff(auth(['NOTICE.POST.VIEW'], null), 1)).toBe(false);
  });
});
