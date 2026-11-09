import { FormControl } from '@angular/forms';

import { SocietySetting } from '../../core/models';
import { changedSettings, limitText, settingValidators, valueText } from './society-rules-ui';

function setting(overrides: Partial<SocietySetting> = {}): SocietySetting {
  return {
    key: 'tenantsSeeMaintenance',
    label: 'Tenants see maintenance bills',
    description: 'Off: only owners and family.',
    type: 'BOOLEAN',
    value: false,
    defaultValue: false,
    customized: false,
    min: null,
    max: null,
    maxLength: null,
    options: [],
    updatedAt: null,
    updatedById: null,
    ...overrides,
  };
}

describe('society rules helpers', () => {
  it('sends only the settings that changed, in their JSON types', () => {
    const settings = [
      setting(),
      setting({ key: 'expiryDays', type: 'INTEGER', value: 7, defaultValue: 7 }),
      setting({ key: 'prefix', type: 'TEXT', value: 'R-', defaultValue: 'R-' }),
    ];
    expect(
      changedSettings(settings, { tenantsSeeMaintenance: false, expiryDays: 7, prefix: 'R-' }),
    ).toEqual({});
    expect(
      changedSettings(settings, { tenantsSeeMaintenance: true, expiryDays: '14', prefix: ' R- ' }),
    ).toEqual({
      tenantsSeeMaintenance: true,
      expiryDays: 14,
    });
  });

  it('validates numbers against their range', () => {
    const days = setting({ type: 'INTEGER', value: 7, min: 1, max: 30 });
    const control = new FormControl<unknown>(7, settingValidators(days));
    expect(control.valid).toBe(true);
    control.setValue(31);
    expect(control.hasError('max')).toBe(true);
    control.setValue(2.5);
    expect(control.hasError('integer')).toBe(true);
    control.setValue(null);
    expect(control.hasError('required')).toBe(true);
    expect(limitText(days)).toBe('A whole number from 1 to 30');
  });

  it('describes values in words', () => {
    expect(valueText(setting(), false)).toBe('Off');
    expect(valueText(setting(), true)).toBe('On');
    expect(valueText(setting({ type: 'INTEGER' }), 7)).toBe('7');
  });
});
