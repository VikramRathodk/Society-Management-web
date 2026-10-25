export type ResidentType = 'OWNER' | 'FAMILY' | 'TENANT';
export type RoleScope = 'PLATFORM' | 'SOCIETY';

export interface ErrorResponse {
  timestamp: string;
  status: number;
  error: string;
  message: string | null;
  path: string;
}
