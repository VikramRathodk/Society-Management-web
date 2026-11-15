import { AgendaItem, Meeting } from '../../core/models';
import { daysUntil, fromLocalInput, toLocalInput, turnoutText } from './governance-ui';
import { minutesTemplate } from './minutes-editor';

const item = (over: Partial<AgendaItem>): AgendaItem => ({
  id: 1,
  position: 1,
  title: 'Accounts',
  description: null,
  resolutionText: null,
  proposedBy: null,
  secondedBy: null,
  votingStatus: 'NOT_OPEN',
  outcome: null,
  resolutionNumber: null,
  turnout: 0,
  results: null,
  youVoted: false,
  canVote: false,
  yourVotes: 0,
  yourFlats: [],
  ...over,
});

describe('governance-ui', () => {
  it('turns datetime-local values into instants and back', () => {
    const iso = fromLocalInput('2026-12-01T18:30');
    expect(toLocalInput(iso)).toBe('2026-12-01T18:30');
  });

  it('counts whole days to a meeting', () => {
    expect(daysUntil(new Date().toISOString())).toBe(0);
    expect(daysUntil(new Date(Date.now() + 3 * 86_400_000).toISOString())).toBe(3);
  });

  it('describes turnout', () => {
    expect(turnoutText(item({ turnout: 3 }), 12)).toBe('3 of 12 voted (25%)');
    expect(turnoutText(item({ turnout: 0 }), 0)).toBe('0 of 0 voted (0%)');
  });

  it('drafts minutes from the meeting', () => {
    const meeting = {
      kind: 'AGM',
      title: 'AGM 2026',
      scheduledAt: '2026-09-20T05:00:00Z',
      place: 'Clubhouse',
      general: true,
      chairperson: { id: 1, name: 'Ravi' },
      quorumRequired: 20,
      quorumPresent: 24,
      agenda: [
        item({
          title: 'Accounts',
          resolutionText: 'Adopt the accounts',
          resolutionNumber: 'AGM/2026-27/1',
          proposedBy: { id: 2, name: 'Asha' },
          outcome: 'PASSED',
          results: { votesFor: 30, votesAgainst: 2, abstained: 1 },
        }),
        item({ position: 2, title: 'Repainting', outcome: 'DEFERRED' }),
      ],
    } as unknown as Meeting;
    const text = minutesTemplate(meeting, 'en-US');
    expect(text).toContain('# Minutes of the annual general meeting');
    expect(text).toContain('at Clubhouse');
    expect(text).toContain('Chaired by Ravi.');
    expect(text).toContain('24 member flats present; 20 needed. The quorum was present.');
    expect(text).toContain('## 1. Accounts');
    expect(text).toContain('Resolution AGM/2026-27/1: Adopt the accounts');
    expect(text).toContain('Proposed by Asha.');
    expect(text).toContain('- Passed (for 30, against 2, abstained 1)');
    expect(text).toContain('## 2. Repainting');
    expect(text).toContain('- Deferred');
  });
});
