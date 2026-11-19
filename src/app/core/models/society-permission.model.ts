/** A permission a society may give or take away (locked platform codes never appear). */
export interface PermissionCatalogEntry {
  code: string;
  module: string;
  feature: string;
  action: string;
  description: string | null;
  /** The caller may add it here: may edit permissions and holds it themselves. */
  canGrant: boolean;
}

/** What a role may do in one society: the platform default with this society's changes. */
export interface RolePermissions {
  societyId: number;
  role: string;
  roleName: string;
  defaults: string[];
  granted: string[];
  revoked: string[];
  effective: string[];
  /** The caller may change it (a role below their own). */
  editable: boolean;
}

/** What one person may do in one society: their roles there, plus their own changes. */
export interface MemberPermissions {
  societyId: number;
  userId: number;
  roles: string[];
  /** What their roles give here, after the society's role changes. */
  fromRole: string[];
  added: string[];
  removed: string[];
  effective: string[];
  editable: boolean;
}

/** The full set of changes wanted (replaces what is stored). */
export interface PermissionChange {
  grant: string[];
  revoke: string[];
  reason?: string | null;
}

export interface PermissionPreset {
  id: number;
  societyId: number;
  name: string;
  description: string | null;
  grant: string[];
  revoke: string[];
  createdBy: number | null;
}

export interface SavePresetRequest {
  name: string;
  description?: string | null;
  grant: string[];
  revoke: string[];
}

export type PermissionChangeKind = 'GRANTED' | 'REVOKED' | 'RESET';

export interface PermissionHistoryEntry {
  id: number;
  targetType: 'ROLE' | 'USER';
  role: string | null;
  userId: number | null;
  userName: string | null;
  /** Null for a reset. */
  permission: string | null;
  change: PermissionChangeKind;
  reason: string | null;
  /** Null when the system did it (the person left the society). */
  changedById: number | null;
  changedByName: string | null;
  changedAt: string;
}

export interface PermissionHistoryQuery {
  userId?: number | null;
  role?: string | null;
  /** ISO dates, inclusive. */
  from?: string | null;
  to?: string | null;
}
