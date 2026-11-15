import { lineDiff, parseRules } from './policy-ui';

describe('parseRules', () => {
  it('reads headings, bullets, numbered items and paragraphs', () => {
    const text = [
      '# Parking',
      'Each flat has one slot.',
      'Visitors park at the gate.',
      '',
      '- No parking on the ramp',
      '* Two-wheelers in the basement',
      '',
      '## Fines',
      '1. First time: a warning',
      '2) Then ₹500',
    ].join('\r\n');

    expect(parseRules(text)).toEqual([
      { kind: 'heading', level: 1, text: 'Parking' },
      { kind: 'paragraph', text: 'Each flat has one slot.\nVisitors park at the gate.' },
      { kind: 'bullets', items: ['No parking on the ramp', 'Two-wheelers in the basement'] },
      { kind: 'heading', level: 2, text: 'Fines' },
      { kind: 'numbered', items: ['First time: a warning', 'Then ₹500'] },
    ]);
  });

  it('keeps anything else as text, including markup', () => {
    expect(parseRules('<b>loud</b>\n#not a heading')).toEqual([
      { kind: 'paragraph', text: '<b>loud</b>\n#not a heading' },
    ]);
    expect(parseRules('   \n\n')).toEqual([]);
  });
});

describe('lineDiff', () => {
  it('marks added and removed lines around what stayed', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('treats an empty "before" as all added', () => {
    expect(lineDiff('', 'x').filter((l) => l.kind !== 'removed')).toEqual([
      { kind: 'added', text: 'x' },
    ]);
  });
});
