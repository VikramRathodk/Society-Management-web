import { Account, ImportResult, Ledger } from '../../core/models';
import { importSummary } from './reconcile-statement';
import {
  addDays,
  booksOpening,
  bankAccounts,
  columnOptions,
  endOfMonth,
  flowLabel,
  lineNet,
  nextPeriod,
  sumNet,
} from './reconcile-ui';

describe('reconcile helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('finds the end of a month', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-01')).toBe('2028-02-29');
    expect(endOfMonth('2026-04-01')).toBe('2026-04-30');
  });

  it('proposes the month after the latest statement, up to today', () => {
    expect(nextPeriod({ periodTo: '2026-04-30' }, '2026-11-13', '2026-04-01')).toEqual({
      from: '2026-05-01',
      to: '2026-05-31',
    });
    expect(nextPeriod({ periodTo: '2026-10-31' }, '2026-11-13', null)).toEqual({
      from: '2026-11-01',
      to: '2026-11-13',
    });
  });

  it('proposes last month for a first statement, not before the books start', () => {
    expect(nextPeriod(null, '2026-11-13', '2026-04-01')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(nextPeriod(null, '2026-11-13', '2026-10-15')).toEqual({
      from: '2026-10-15',
      to: '2026-10-31',
    });
    // Books started this month: the period starts and ends within it.
    expect(nextPeriod(null, '2026-11-13', '2026-11-05')).toEqual({
      from: '2026-11-05',
      to: '2026-11-05',
    });
  });

  it('nets money in against money out', () => {
    expect(lineNet({ debit: 0, credit: 1500 })).toBe(1500);
    expect(lineNet({ debit: 250.5, credit: 0 })).toBe(-250.5);
    expect(
      sumNet([
        { moneyIn: 0.1, moneyOut: 0 },
        { moneyIn: 0.2, moneyOut: 0 },
      ]),
    ).toBe(0.3);
    expect(
      sumNet([
        { moneyIn: 5000, moneyOut: 0 },
        { moneyIn: 0, moneyOut: 5000 },
      ]),
    ).toBe(0);
  });

  it('labels the direction of money', () => {
    expect(flowLabel(1000)).toMatch(/^\+₹1,000\.00$/);
    expect(flowLabel(-500)).toMatch(/^−₹500\.00$/);
  });

  it('names columns from the header row', () => {
    const rows = [
      ['ACME BANK statement'],
      ['Date', 'Narration', '', 'Deposit'],
      ['01/04/2026', 'NEFT', '10', ''],
    ];
    expect(columnOptions(rows, 2)).toEqual([
      { value: 1, label: '1 · Date' },
      { value: 2, label: '2 · Narration' },
      { value: 3, label: 'Column 3' },
      { value: 4, label: '4 · Deposit' },
    ]);
    expect(columnOptions([], 1)).toEqual([]);
  });

  it('keeps only bank ledgers', () => {
    const base = { type: 'ASSET', group: false, active: true, balance: 0, bank: null } as const;
    const accounts: Account[] = [
      {
        ...base,
        id: 1,
        code: '1100',
        name: 'Cash & bank',
        parentId: null,
        group: true,
        systemKey: 'CASH_AND_BANK',
      },
      { ...base, id: 2, code: '1110', name: 'Cash', parentId: 1, systemKey: 'CASH' },
      {
        ...base,
        id: 3,
        code: '1121',
        name: 'HDFC',
        parentId: 1,
        systemKey: null,
        bank: { bankName: 'HDFC', accountType: 'SAVINGS', last4: '1234', ifsc: null },
      },
    ];
    expect(bankAccounts(accounts).map((a) => a.name)).toEqual(['HDFC']);
  });

  it('summarises an import', () => {
    const result = {
      import: { rowsImported: 23, rowsDuplicate: 2, rowsIgnored: 0 },
      outsidePeriod: [{ row: 30, message: '' }],
      autoMatched: 18,
      autoPaired: 0,
    } as unknown as ImportResult;
    expect(importSummary(result)).toBe(
      'Imported 23 line(s), 2 already imported, 1 outside the period; matched 18 automatically',
    );
  });
});

describe('booksOpening', () => {
  const line = (voucherType: 'OPENING' | 'RECEIPT', debit: number, credit = 0) =>
    ({ voucherType, debit, credit }) as Ledger['lines'][number];

  it('counts the opening balances entry on the first day as before it', () => {
    const ledger = { opening: 0, lines: [line('OPENING', 50000), line('RECEIPT', 5000)] };
    expect(booksOpening(ledger as Ledger)).toBe(50000);
  });

  it("is the ledger's opening on a later day", () => {
    expect(booksOpening({ opening: 54200, lines: [line('RECEIPT', 1000)] } as Ledger)).toBe(54200);
  });
});
