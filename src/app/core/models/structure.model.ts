export interface Complex {
  id: number;
  name: string;
  address: string | null;
}

export interface Society {
  id: number;
  name: string;
  address: string | null;
  complexId: number | null;
}

export interface CreateSocietyRequest {
  name: string;
  address?: string;
  complexId?: number;
}

export interface UpdateSocietyRequest {
  name?: string;
  address?: string;
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
