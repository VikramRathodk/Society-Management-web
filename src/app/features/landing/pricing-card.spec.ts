import { Plan, PlanQuote } from '../../core/models';
import { cardQuote, pricingCard } from './landing';

const STANDARD: Plan = {
  id: 2,
  code: 'STANDARD',
  name: 'Standard',
  description: null,
  priceMonthly: 699,
  priceYearly: 6990,
  includedFlats: 50,
  extraFlatMonthly: 12,
  extraFlatYearly: 120,
  maxFlats: null,
  modules: ['MAINTENANCE', 'FINANCE', 'POLICIES'],
  active: true,
  sortOrder: 2,
  featured: true,
  recommendedFromFlats: 31,
  onlinePaymentCommissionPercent: 0,
};

const FREE: Plan = {
  ...STANDARD,
  id: 1,
  code: 'FREE',
  name: 'Free',
  priceMonthly: 0,
  priceYearly: 0,
  includedFlats: 15,
  extraFlatMonthly: null,
  extraFlatYearly: null,
  maxFlats: 15,
  modules: [],
  featured: false,
  recommendedFromFlats: 1,
};

describe('pricingCard', () => {
  it('shows the society price a month, the flats included, extra flats, the yearly saving and GST', () => {
    const card = pricingCard(STANDARD);
    expect(card.name).toBe('Standard');
    expect(card.price).toBe('₹699');
    expect(card.per).toBe('/ month');
    expect(card.featured).toBe(true);
    expect(card.blurb).toBe('+ 18% GST');
    expect(card.points[0]).toBe('Up to 50 flats included');
    expect(card.points).toContain('₹12 a month for each extra flat');
    expect(card.points).toContain('Accounts, approvals, reports and bank reconciliation');
    expect(card.points).not.toContain('Meetings, e-voting and minutes');
    expect(card.points).toContain('Yearly: ₹6,990 (2 months free)');
  });

  it('shows the yearly price and extra-flat rate in the yearly view', () => {
    const card = pricingCard(STANDARD, 'YEARLY');
    expect(card.price).toBe('₹6,990');
    expect(card.per).toBe('/ year');
    expect(card.points).toContain('₹120 a year for each extra flat');
    expect(card.points.some((p) => p.startsWith('Yearly:'))).toBe(false);
  });

  it('a free plan says Free and its flat limit, without GST', () => {
    const card = pricingCard(FREE);
    expect(card.price).toBe('Free');
    expect(card.per).toBe('');
    expect(card.points[0]).toBe('Up to 15 flats');
    expect(card.blurb).toBe('Free for good');
  });

  it('ALL includes every module and the ones added later', () => {
    const points = pricingCard({ ...STANDARD, modules: ['ALL'] }).points;
    expect(points).toContain('Meetings, e-voting and minutes');
    expect(points).toContain('Every module we add later');
  });
});

describe('cardQuote', () => {
  const quote = (over: Partial<PlanQuote>): PlanQuote => ({
    plan: STANDARD,
    flats: 58,
    extraFlats: 8,
    fits: true,
    monthly: 795,
    yearly: 7950,
    recommended: true,
    ...over,
  });

  it('shows the total for the flats typed in, with the extra flats', () => {
    const q = cardQuote(quote({}), 'MONTHLY');
    expect(q.total).toBe('₹795 / month for your 58 flats');
    expect(q.breakdown).toBe('₹699 + 8 extra flats × ₹12');
    expect(q.recommended).toBe(true);
    expect(cardQuote(quote({}), 'YEARLY').total).toBe('₹7,950 / year for your 58 flats');
  });

  it('says when a plan is too small or free', () => {
    expect(cardQuote(quote({ plan: FREE, fits: false, recommended: false }), 'MONTHLY').total).toBe(
      'Too small for 58 flats',
    );
    expect(cardQuote(quote({ plan: FREE, flats: 10, extraFlats: 0, monthly: 0, yearly: 0 }), 'MONTHLY').total).toBe(
      'Free for your 10 flats',
    );
  });
});
