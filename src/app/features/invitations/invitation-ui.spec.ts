import { invitedAs, inviteMessage, printCardHtml, qrFileName, whatsappLink } from './invitation-ui';
import { invitation, issued } from './invitation-test-data';

describe('invitation helpers', () => {
  it('describes what someone is invited as', () => {
    expect(invitedAs(invitation())).toBe('Resident · A-101 · Tenant');
    expect(
      invitedAs(invitation({ roleName: 'Security Guard', flatLabel: null, residentType: null })),
    ).toBe('Security Guard');
  });

  it('writes a share message with the link and expiry', () => {
    expect(inviteMessage(issued())).toBe(
      "Hi Priya, you're invited to join Green Park as Resident (flat A-101). " +
        'Open this link to accept: http://localhost:4200/invite/tok123 (valid until 16 Nov 2026)',
    );
    expect(whatsappLink('a b&c')).toBe('https://wa.me/?text=a%20b%26c');
  });

  it('names the QR file after the person and flat', () => {
    expect(qrFileName(invitation())).toBe('invite-priya-a-101.png');
    expect(qrFileName(invitation({ name: 'Mr. R K', flatLabel: null, roleName: 'Guard' }))).toBe(
      'invite-mr-r-k-guard.png',
    );
  });

  it('escapes names in the printable card', () => {
    const html = printCardHtml(issued({ name: '<b>Eve</b>' }), 'data:image/png;base64,AA');
    expect(html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
    expect(html).not.toContain('<b>Eve</b>');
    expect(html).toContain('Scan to join');
    expect(html).toContain('http://localhost:4200/invite/tok123');
  });
});
