import { OnboardingChecklist, SentInvitation } from '../../core/models';
import {
  linksCsv,
  listOf,
  missingProfileText,
  qrCardsHtml,
  sampleNumbers,
  setupProgress,
  sortedByFlat,
} from './onboarding-ui';
import { headerOf } from './resident-importer';

const sent = (row: number, flatLabel: string, name: string): SentInvitation => ({
  row,
  flatLabel,
  name,
  phone: '98765432' + String(row).padStart(2, '0'),
  invitationId: row,
  token: 't' + row,
  inviteUrl: 'http://app/invite/t' + row,
});

describe('onboarding-ui', () => {
  it('samples flat numbers as the backend makes them', () => {
    expect(sampleNumbers({ wing: 'A', floorsFrom: 1, floorsTo: 12, flatsPerFloor: 4 })).toEqual([
      '101',
      '102',
      '103',
      '104',
    ]);
    expect(
      sampleNumbers({
        wing: 'B',
        floorsFrom: 0,
        floorsTo: 1,
        flatsPerFloor: 1,
        numbering: '{wing}-{floor}{n}',
      }),
    ).toEqual(['B-01', 'B-11']);
  });

  it('splits comma-separated lists', () => {
    expect(listOf(' 1301, ,1302 ,Shop 1')).toEqual(['1301', '1302', 'Shop 1']);
    expect(listOf('')).toEqual([]);
  });

  it('names missing profile fields in plain words', () => {
    expect(missingProfileText(['city', 'pincode', 'contactPhone'])).toBe(
      'city, PIN code, contact phone',
    );
  });

  it('counts the four setup steps', () => {
    const c = {
      profile: { done: true },
      structure: { done: true },
      residents: { done: false },
      committee: { done: false },
    } as OnboardingChecklist;
    expect(setupProgress(c)).toEqual({ done: 2, total: 4 });
  });

  it('writes the links CSV by flat, quoting where needed and defusing formulas', () => {
    const csv = linksCsv([
      sent(3, 'B-101', 'Kiran'),
      sent(2, 'A-102', 'Rao, Jr.'),
      sent(4, 'A-101', '=cmd'),
    ]);
    expect(csv.split('\r\n')).toEqual([
      'Flat,Name,Phone,Link',
      "A-101,'=cmd,9876543204,http://app/invite/t4",
      'A-102,"Rao, Jr.",9876543202,http://app/invite/t2',
      'B-101,Kiran,9876543203,http://app/invite/t3',
      '',
    ]);
  });

  it('sorts flats naturally', () => {
    expect(
      sortedByFlat([sent(1, 'A-1001', 'x'), sent(2, 'A-201', 'y')]).map((s) => s.flatLabel),
    ).toEqual(['A-201', 'A-1001']);
  });

  it('escapes names on the QR cards', () => {
    const html = qrCardsHtml('Lake <View>', [{ sent: sent(1, 'A-101', '<b>x</b>'), qr: 'data:x' }]);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('Lake &lt;View&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('reads a sheet header with whichever separator it uses', () => {
    expect(headerOf(String.fromCharCode(0xfeff) + 'Flat,Name,"Phone"\r\n101,A,9')).toEqual([
      'Flat',
      'Name',
      'Phone',
    ]);
    expect(headerOf('Wing;Flat;Name;Phone\n')).toEqual(['Wing', 'Flat', 'Name', 'Phone']);
    expect(headerOf('Flat\tName\tPhone')).toEqual(['Flat', 'Name', 'Phone']);
  });
});
