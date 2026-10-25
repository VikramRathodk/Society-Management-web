import { Role } from '../../core/models';

/** Codes of every role that inherits `code`, directly or through other roles. */
export function descendantsOf(code: string, roles: readonly Role[]): Set<string> {
  const result = new Set<string>();
  const queue = [code];
  while (queue.length) {
    const current = queue.shift()!;
    for (const role of roles) {
      if (role.inherits.includes(current) && !result.has(role.code)) {
        result.add(role.code);
        queue.push(role.code);
      }
    }
  }
  return result;
}

/** Codes of every role `code` inherits from, directly or through other roles. */
export function ancestorsOf(code: string, roles: readonly Role[]): Set<string> {
  const result = new Set<string>();
  const queue = [code];
  while (queue.length) {
    const next = queue.shift()!;
    const current = roles.find((r) => r.code === next);
    for (const parent of current?.inherits ?? []) {
      if (!result.has(parent)) {
        result.add(parent);
        queue.push(parent);
      }
    }
  }
  return result;
}

/**
 * For a new role that inherits `inherits` and is included in `includedIn`: the roles that would end
 * up both above and below it (a cycle).
 */
export function cycleConflicts(
  inherits: readonly string[],
  includedIn: readonly string[],
  roles: readonly Role[],
): string[] {
  const above = new Set(inherits);
  for (const code of inherits) ancestorsOf(code, roles).forEach((a) => above.add(a));
  return includedIn.filter((code) => above.has(code));
}

/** Roles `code` may inherit from without creating a cycle (excludes itself and its descendants). */
export function inheritCandidates(code: string, roles: readonly Role[]): Role[] {
  const blocked = descendantsOf(code, roles);
  return roles.filter((r) => r.code !== code && !blocked.has(r.code));
}

/** Permissions a role gets from the roles it inherits (their effective sets). */
export function inheritedPermissions(
  inherits: readonly string[],
  roles: readonly Role[],
): Set<string> {
  const result = new Set<string>();
  for (const role of roles) {
    if (inherits.includes(role.code)) role.effectivePermissions.forEach((p) => result.add(p));
  }
  return result;
}
