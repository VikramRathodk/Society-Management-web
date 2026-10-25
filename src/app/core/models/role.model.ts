import { RoleScope } from './common.model';

export interface Role {
  code: string;
  name: string;
  description: string | null;
  scopeLevel: RoleScope;
  requiresFlat: boolean;
  allPermissions: boolean;
  isSystem: boolean;
  inherits: string[];
  permissions: string[];
  effectivePermissions: string[];
}

export interface CreateRoleRequest {
  code: string;
  name: string;
  description?: string;
  scopeLevel: RoleScope;
  requiresFlat?: boolean;
  inherits?: string[];
  includedIn?: string[];
  permissions?: string[];
}

export interface AssignableRole {
  code: string;
  name: string;
  scopeLevel: RoleScope;
  requiresFlat: boolean;
}

export interface Permission {
  code: string;
  description: string | null;
}
