import { Account } from '../../core/models';
import {
  chartRows,
  entryAccounts,
  isProtected,
  journalAccounts,
  moneyAccounts,
  signedInr,
} from './finance-ui';

function account(
  id: number,
  code: string,
  name: string,
  parentId: number | null,
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    code,
    name,
    type: 'ASSET',
    parentId,
    group: false,
    systemKey: null,
    active: true,
    balance: 0,
    bank: null,
    ...extra,
  };
}

// Assets › Cash & bank › (Cash, Bank accounts › HDFC); Assets › Receivables › Member dues;
// Income › Hall rent; Liabilities › Member advance.
const chart: Account[] = [
  account(1, '1000', 'Assets', null, { group: true }),
  account(2, '1100', 'Cash & bank', 1, { group: true, systemKey: 'CASH_AND_BANK' }),
  account(3, '1110', 'Cash in hand', 2, { systemKey: 'CASH' }),
  account(4, '1120', 'Bank accounts', 2, { group: true, systemKey: 'BANK_ACCOUNTS' }),
  account(5, '1121', 'HDFC', 4),
  account(6, '1200', 'Receivables', 1, { group: true }),
  account(7, '1210', 'Member dues', 6, { systemKey: 'MEMBER_DUES' }),
  account(8, '4000', 'Income', null, { group: true, type: 'INCOME' }),
  account(9, '4210', 'Hall rent', 8, { type: 'INCOME' }),
  account(10, '2000', 'Liabilities', null, { group: true, type: 'LIABILITY' }),
  account(11, '2110', 'Member advance', 10, { type: 'LIABILITY', systemKey: 'MEMBER_ADVANCE' }),
  account(12, '1122', 'Old bank', 4, { active: false }),
];

describe('finance chart helpers', () => {
  it('orders the chart as a tree with depth and path', () => {
    const rows = chartRows(chart);
    expect(rows.map((r) => r.account.code)).toEqual([
      '1000',
      '1100',
      '1110',
      '1120',
      '1121',
      '1122',
      '1200',
      '1210',
      '2000',
      '2110',
      '4000',
      '4210',
    ]);
    const hdfc = rows.find((r) => r.account.id === 5)!;
    expect(hdfc.depth).toBe(3);
    expect(hdfc.path).toBe('Assets › Cash & bank › Bank accounts');
  });

  it('finds the cash and bank ledgers, active ones by default', () => {
    expect(moneyAccounts(chart).map((a) => a.id)).toEqual([3, 5]);
    expect(moneyAccounts(chart, false).map((a) => a.id)).toEqual([3, 5, 12]);
  });

  it('keeps money and member accounts out of receipt and payment lines', () => {
    expect(entryAccounts(chart).map((r) => r.account.id)).toEqual([9]);
    expect(entryAccounts(chart, ['ASSET'])).toEqual([]);
  });

  it('lets journals use cash and bank but never member accounts', () => {
    expect(journalAccounts(chart).map((r) => r.account.id)).toEqual([3, 5, 9]);
  });

  it('protects roots and system accounts', () => {
    expect(isProtected(chart[0])).toBe(true);
    expect(isProtected(chart[2])).toBe(true);
    expect(isProtected(chart[8])).toBe(false);
  });

  it('shows negative balances with a minus sign', () => {
    expect(signedInr(-1500)).toBe('−₹1,500.00');
    expect(signedInr(250)).toBe('₹250.00');
  });
});
