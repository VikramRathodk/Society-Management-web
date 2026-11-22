import { PermissionCatalogEntry } from '../../core/models';
import {
  EMPTY_DRAFT,
  canToggle,
  cellState,
  changeOf,
  codeLabel,
  cycle,
  draftOf,
  groupCatalog,
  sameDraft,
  toggle,
} from './permission-draft';

function entry(code: string, canGrant = true): PermissionCatalogEntry {
  const [module, feature, action] = code.split('.');
  return { code, module, feature, action, description: null, canGrant };
}

describe('permission draft', () => {
  const base = new Set(['NOTICE.POST.VIEW', 'NOTICE.POST.CREATE']);

  it('ticks and unticks against the base', () => {
    let draft = toggle(EMPTY_DRAFT, base, 'NOTICE.POST.CREATE');
    expect(cellState('NOTICE.POST.CREATE', base, draft)).toBe('removed');
    draft = toggle(draft, base, 'NOTICE.POST.CREATE');
    expect(cellState('NOTICE.POST.CREATE', base, draft)).toBe('base');
    expect(sameDraft(draft, EMPTY_DRAFT)).toBe(true);

    draft = toggle(draft, base, 'NOTICE.POST.MODERATE');
    expect(cellState('NOTICE.POST.MODERATE', base, draft)).toBe('added');
    draft = toggle(draft, base, 'NOTICE.POST.MODERATE');
    expect(cellState('NOTICE.POST.MODERATE', base, draft)).toBe('off');
    expect(sameDraft(draft, EMPTY_DRAFT)).toBe(true);
  });

  it('lets anyone untick but only a holder tick', () => {
    expect(canToggle('base', false)).toBe(true);
    expect(canToggle('added', false)).toBe(true);
    expect(canToggle('off', false)).toBe(false);
    expect(canToggle('removed', false)).toBe(false);
    expect(canToggle('off', true)).toBe(true);
  });

  it('cycles a preset box none, add, remove, none', () => {
    let draft = cycle(EMPTY_DRAFT, 'A.B.VIEW');
    expect([...draft.added]).toEqual(['A.B.VIEW']);
    draft = cycle(draft, 'A.B.VIEW');
    expect([...draft.added]).toEqual([]);
    expect([...draft.removed]).toEqual(['A.B.VIEW']);
    draft = cycle(draft, 'A.B.VIEW');
    expect(sameDraft(draft, EMPTY_DRAFT)).toBe(true);
  });

  it('sends the full sorted change', () => {
    expect(changeOf(draftOf(['B.X.VIEW', 'A.X.VIEW'], ['C.X.VIEW']))).toEqual({
      grant: ['A.X.VIEW', 'B.X.VIEW'],
      revoke: ['C.X.VIEW'],
    });
  });

  it('groups the catalog into module grids with known actions first', () => {
    const groups = groupCatalog([
      entry('VISITOR.ENTRY.EXPORT'),
      entry('VISITOR.ENTRY.VIEW'),
      entry('VISITOR.APPROVAL.APPROVE'),
      entry('NOTICE.POST.CREATE'),
    ]);
    expect(groups.map((g) => g.module)).toEqual(['NOTICE', 'VISITOR']);
    const visitor = groups[1];
    expect(visitor.actions).toEqual(['VIEW', 'EXPORT', 'APPROVE']);
    expect(visitor.rows.map((r) => r.feature)).toEqual(['APPROVAL', 'ENTRY']);
    expect(visitor.rows[0].cells.map((c) => c?.code ?? null)).toEqual([
      null,
      null,
      'VISITOR.APPROVAL.APPROVE',
    ]);
  });

  it('labels codes for people', () => {
    expect(codeLabel('POLICY.RULE.SELF_APPROVE')).toBe('Policy rule self approve');
  });
});
