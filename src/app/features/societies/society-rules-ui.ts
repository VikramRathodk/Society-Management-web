import { ValidatorFn, Validators } from '@angular/forms';

import { SettingValue, SocietySetting, SocietySettingChanges } from '../../core/models';

/** Form validators matching the limits the backend enforces for a setting. */
export function settingValidators(setting: SocietySetting): ValidatorFn[] {
  switch (setting.type) {
    case 'INTEGER': {
      const validators: ValidatorFn[] = [
        Validators.required,
        (control) => (Number.isInteger(Number(control.value)) ? null : { integer: true }),
      ];
      if (setting.min != null) validators.push(Validators.min(setting.min));
      if (setting.max != null) validators.push(Validators.max(setting.max));
      return validators;
    }
    case 'TEXT':
      return setting.maxLength != null ? [Validators.maxLength(setting.maxLength)] : [];
    case 'CHOICE':
      return [Validators.required];
    default:
      return [];
  }
}

/** The form value in the JSON type the backend expects. */
export function settingValue(setting: SocietySetting, raw: unknown): SettingValue {
  switch (setting.type) {
    case 'BOOLEAN':
      return raw === true;
    case 'INTEGER':
      return Number(raw);
    case 'TEXT':
      return String(raw ?? '').trim();
    default:
      return String(raw ?? '');
  }
}

/** Only the settings whose form value differs from what the society has now. */
export function changedSettings(
  settings: SocietySetting[],
  values: Record<string, unknown>,
): SocietySettingChanges {
  const changes: SocietySettingChanges = {};
  for (const setting of settings) {
    const value = settingValue(setting, values[setting.key]);
    if (value !== setting.value) changes[setting.key] = value;
  }
  return changes;
}

/** How a value reads in text, e.g. "Off" for a false toggle. */
export function valueText(setting: SocietySetting, value: SettingValue): string {
  if (setting.type === 'BOOLEAN') return value ? 'On' : 'Off';
  if (setting.type === 'TEXT' && value === '') return 'empty';
  return String(value);
}

/** The error shown under a number field, e.g. "A whole number from 1 to 30". */
export function limitText(setting: SocietySetting): string {
  const { min, max } = setting;
  if (min != null && max != null) return `A whole number from ${min} to ${max}`;
  if (min != null) return `A whole number of at least ${min}`;
  if (max != null) return `A whole number of at most ${max}`;
  return 'A whole number';
}
