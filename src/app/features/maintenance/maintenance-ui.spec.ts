import { inr, localDate, paidPercent, periodLabel, upiPayLink } from './maintenance-ui';

describe('maintenance formatting', () => {
  it('formats rupees with Indian grouping and two decimals', () => {
    expect(inr(262500)).toBe('₹2,62,500.00');
    expect(inr(0)).toBe('₹0.00');
    expect(inr(null)).toBe('₹0.00');
  });

  it('names whole-month periods by month', () => {
    expect(periodLabel('2026-04-01', '2026-04-30')).toBe('Apr 2026');
    expect(periodLabel('2026-04-01', '2026-06-30')).toBe('Apr 2026 – Jun 2026');
  });

  it('names other periods by day', () => {
    expect(periodLabel('2026-04-10', '2026-05-09')).toBe('10 Apr 2026 – 9 May 2026');
  });

  it('reads ISO dates as local calendar dates', () => {
    const d = localDate('2026-01-31');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 31]);
  });

  it('caps the paid share at 100%', () => {
    expect(paidPercent(500, 2000)).toBe(25);
    expect(paidPercent(2500, 2000)).toBe(100);
    expect(paidPercent(0, 0)).toBe(0);
  });
});

describe('upiPayLink', () => {
  it('builds a upi://pay link with the amount and an encoded note', () => {
    expect(
      upiPayLink({
        upiId: 'stark.tower@okhdfc',
        payeeName: 'Stark Tower CHS',
        amount: 2625,
        note: 'Maintenance 202611-0004 Stark Wing-1001',
      }),
    ).toBe(
      'upi://pay?pa=stark.tower%40okhdfc&pn=Stark%20Tower%20CHS&am=2625.00&cu=INR' +
        '&tn=Maintenance%20202611-0004%20Stark%20Wing-1001',
    );
  });

  it('keeps the note short for UPI apps', () => {
    const link = upiPayLink({ upiId: 'a@b', payeeName: 'X', amount: 1, note: 'n'.repeat(80) });
    expect(decodeURIComponent(link.split('&tn=')[1])).toHaveLength(50);
  });
});
