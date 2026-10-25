import { Component, computed, input, output } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Permission } from '../../core/models';
import { compareNatural } from '../../shared/sort';

interface MatrixRow {
  resource: string;
  /** One cell per action column; null where that permission doesn't exist. */
  cells: (Permission | null)[];
}

interface MatrixGroup {
  module: string;
  actions: string[];
  rows: MatrixRow[];
}

const ACTION_ORDER = ['VIEW', 'CREATE', 'UPDATE', 'DELETE'];

/** Permission codes are MODULE.RESOURCE.ACTION: one grid per module, resources × actions. */
@Component({
  selector: 'app-permission-matrix',
  imports: [MatCheckboxModule, MatTooltipModule],
  templateUrl: './permission-matrix.html',
  styleUrl: './permission-matrix.scss',
})
export class PermissionMatrix {
  readonly permissions = input.required<readonly Permission[]>();
  /** The role's own permissions (editable). */
  readonly selected = input.required<ReadonlySet<string>>();
  /** Permissions it gets from inherited roles (shown ticked, not editable). */
  readonly inherited = input<ReadonlySet<string>>(new Set());
  readonly readonly = input(false);
  readonly toggled = output<string>();

  protected readonly groups = computed<MatrixGroup[]>(() => {
    const byModule = new Map<string, Permission[]>();
    for (const p of this.permissions()) {
      const module = p.code.split('.')[0];
      byModule.set(module, [...(byModule.get(module) ?? []), p]);
    }
    return [...byModule.keys()].sort(compareNatural).map((module) => {
      const perms = byModule.get(module)!;
      const actions = [...new Set(perms.map((p) => action(p.code)))].sort(compareActions);
      const resources = [...new Set(perms.map((p) => resource(p.code)))].sort(compareNatural);
      return {
        module,
        actions,
        rows: resources.map((res) => ({
          resource: res,
          cells: actions.map(
            (act) => perms.find((p) => resource(p.code) === res && action(p.code) === act) ?? null,
          ),
        })),
      };
    });
  });

  protected isInherited(code: string): boolean {
    return this.inherited().has(code) && !this.selected().has(code);
  }

  protected label(part: string): string {
    return part.charAt(0) + part.slice(1).toLowerCase();
  }

  protected tooltip(p: Permission): string {
    const text = p.description ?? p.code;
    return this.isInherited(p.code) ? `${text} (inherited)` : text;
  }
}

function resource(code: string): string {
  return code.split('.')[1] ?? '';
}

function action(code: string): string {
  return code.split('.')[2] ?? '';
}

function compareActions(a: string, b: string): number {
  const ia = ACTION_ORDER.indexOf(a);
  const ib = ACTION_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return compareNatural(a, b);
}
