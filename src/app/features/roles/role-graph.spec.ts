import { Role } from '../../core/models';
import {
  ancestorsOf,
  cycleConflicts,
  descendantsOf,
  inheritCandidates,
  inheritedPermissions,
} from './role-graph';

function role(code: string, inherits: string[], effective: string[] = []): Role {
  return {
    code,
    name: code,
    description: null,
    scopeLevel: 'SOCIETY',
    requiresFlat: false,
    allPermissions: false,
    isSystem: true,
    inherits,
    permissions: [],
    effectivePermissions: effective,
  };
}

// The seeded hierarchy: SUPER_ADMIN > ADMIN > SECRETARY > { COMMITTEE > RESIDENT, GUARD }
const roles = [
  role('SUPER_ADMIN', ['ADMIN']),
  role('ADMIN', ['SECRETARY']),
  role('SECRETARY', ['COMMITTEE', 'GUARD']),
  role('COMMITTEE', ['RESIDENT'], ['NOTICE.POST.CREATE', 'NOTICE.POST.VIEW']),
  role('RESIDENT', [], ['NOTICE.POST.VIEW']),
  role('GUARD', [], ['VISITOR.ENTRY.CREATE']),
];

describe('role graph', () => {
  it('finds everything above and below a role', () => {
    expect([...descendantsOf('COMMITTEE', roles)].sort()).toEqual([
      'ADMIN',
      'SECRETARY',
      'SUPER_ADMIN',
    ]);
    expect([...ancestorsOf('SECRETARY', roles)].sort()).toEqual(['COMMITTEE', 'GUARD', 'RESIDENT']);
  });

  it('only offers parents that keep the hierarchy loop-free', () => {
    expect(inheritCandidates('COMMITTEE', roles).map((r) => r.code)).toEqual(['RESIDENT', 'GUARD']);
  });

  it('flags a new role placed both above and below the same role', () => {
    // Inherits SECRETARY (so RESIDENT is above it) but is included in RESIDENT: a loop.
    expect(cycleConflicts(['SECRETARY'], ['RESIDENT', 'ADMIN'], roles)).toEqual(['RESIDENT']);
    expect(cycleConflicts(['RESIDENT'], ['COMMITTEE'], roles)).toEqual([]);
  });

  it('unions what the parents can do', () => {
    expect([...inheritedPermissions(['COMMITTEE', 'GUARD'], roles)].sort()).toEqual([
      'NOTICE.POST.CREATE',
      'NOTICE.POST.VIEW',
      'VISITOR.ENTRY.CREATE',
    ]);
  });
});
