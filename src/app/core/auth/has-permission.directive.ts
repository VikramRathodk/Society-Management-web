import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';

import { SocietyContextStore } from '../society-context/society-context.store';
import { AuthStore } from './auth.store';

/**
 * Renders its content only when the user holds the permission.
 *
 *   <button *hasPermission="'FLAT.STRUCTURE.CREATE'">Add wing</button>
 *   <button *hasPermission="'SYSTEM.ROLE.CREATE'; platform: true">New role</button>
 *   <button *hasPermission="'VISITOR.APPROVAL.APPROVE'; society: v.societyId">Approve</button>
 *
 * Without `society` it checks the currently selected society.
 */
@Directive({ selector: '[hasPermission]' })
export class HasPermission {
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly templateRef = inject(TemplateRef);
  private readonly viewContainer = inject(ViewContainerRef);
  private hasView = false;

  readonly hasPermission = input.required<string>();
  readonly hasPermissionSociety = input<number | null>();
  readonly hasPermissionPlatform = input(false);

  constructor() {
    effect(() => {
      const permission = this.hasPermission();
      const ok = this.hasPermissionPlatform()
        ? this.auth.canOnPlatform(permission)
        : this.auth.can(permission, this.hasPermissionSociety() ?? this.ctx.selectedSocietyId());
      if (ok && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!ok && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }
    });
  }
}
