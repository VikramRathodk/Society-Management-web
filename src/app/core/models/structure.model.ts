export interface Complex {
  id: number;
  name: string;
  address: string | null;
}

/** SETUP until the secretary goes live; residents can only join a LIVE society. */
export type SocietyStatus = 'SETUP' | 'LIVE';
export type SocietySource = 'PLATFORM' | 'SELF_SIGNUP';

export interface Society {
  id: number;
  name: string;
  address: string | null;
  complexId: number | null;
  status: SocietyStatus;
  source: SocietySource;
  createdAt: string | null;
  wentLiveAt: string | null;
  registrationNumber: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  hasLogo: boolean;
  notes: string | null;
}

export interface CreateSocietyRequest {
  name: string;
  address?: string;
  complexId?: number;
  /** Skip Setup: for a running society moving in. */
  startLive?: boolean;
}

/** Fields left out stay as they are; an empty string clears one (except the name). */
export interface UpdateSocietyRequest {
  name?: string;
  address?: string;
  registrationNumber?: string;
  city?: string;
  state?: string;
  pincode?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
}

/** How a society setting's value is typed and edited (see the backend's SocietySettingCatalog). */
export type SettingType = 'BOOLEAN' | 'INTEGER' | 'TEXT' | 'CHOICE';
export type SettingValue = boolean | number | string;

/** One configurable rule of a society: its definition plus the society's value (or the default). */
export interface SocietySetting {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  value: SettingValue;
  defaultValue: SettingValue;
  /** True when the society changed it from the default. */
  customized: boolean;
  min: number | null;
  max: number | null;
  maxLength: number | null;
  options: string[];
  updatedAt: string | null;
  updatedById: number | null;
}

export interface SocietySettingGroup {
  key: string;
  label: string;
  settings: SocietySetting[];
}

export interface SocietySettings {
  societyId: number;
  groups: SocietySettingGroup[];
}

/** Only the keys that change; null puts a setting back to its default. */
export type SocietySettingChanges = Record<string, SettingValue | null>;

export interface Wing {
  id: number;
  societyId: number;
  name: string;
}

export interface Flat {
  id: number;
  wingId: number;
  flatNumber: string;
  /** Needed for per-sq-ft maintenance charges. */
  areaSqft?: number | null;
}
