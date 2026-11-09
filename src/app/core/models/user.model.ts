import { ResidentType } from './common.model';

export interface LoginRequest {
  phone: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  userId: number;
  name: string;
  roles: RoleAssignment[];
  access: Access;
}

export interface Access {
  platformRoles: string[];
  platformPermissions: string[];
  societies: SocietyAccess[];
}

export interface SocietyAccess {
  societyId: number;
  roles: string[];
  permissions: string[];
}

export interface RoleAssignment {
  id: number;
  role: string;
  roleName: string;
  societyId: number | null;
  /** Always given for the user's own roles, even without permission to view the society. */
  societyName: string | null;
  flatId: number | null;
  residentType: ResidentType | null;
}

export interface User {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  roles: RoleAssignment[];
}

export interface MeResponse {
  user: User;
  access: Access;
}

export interface CreateUserRequest {
  name: string;
  phone: string;
  email?: string;
  password: string;
  role: string;
  societyId?: number;
  flatId?: number;
  residentType?: ResidentType;
}

export interface AssignRoleRequest {
  role: string;
  societyId?: number;
  flatId?: number;
  residentType?: ResidentType;
}

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  fcmToken?: string;
}

export interface ResetPasswordRequest {
  newPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
