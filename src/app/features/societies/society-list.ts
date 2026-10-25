import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { filter, finalize, switchMap } from 'rxjs';

import { SocietyApi } from '../../core/api/society.api';
import { HasPermission } from '../../core/auth/has-permission.directive';
import { Society } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState } from '../../shared/empty-state';
import { sortBy } from '../../shared/sort';
import { SocietyCreateDialog } from './society-create-dialog';

@Component({
  selector: 'app-society-list',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    MatTooltipModule,
    HasPermission,
    EmptyState,
  ],
  templateUrl: './society-list.html',
  styleUrl: './society-list.scss',
})
export class SocietyList {
  private readonly api = inject(SocietyApi);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly societies = signal<Society[]>([]);
  protected readonly loading = signal(true);
  protected readonly columns = ['name', 'address', 'actions'];

  protected readonly loadError = signal(false);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.api
      .list()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => this.societies.set(sortBy(list, (s) => s.name)),
        error: () => this.loadError.set(true), // also reported by the error interceptor
      });
  }

  protected create(): void {
    this.dialog
      .open<SocietyCreateDialog, void, Society>(SocietyCreateDialog, { width: '480px' })
      .afterClosed()
      .pipe(filter((society) => society !== undefined))
      .subscribe((society) => {
        this.societies.update((list) => sortBy([...list, society], (s) => s.name));
        this.refreshSwitcher();
      });
  }

  protected remove(society: Society): void {
    confirmDialog(this.dialog, {
      title: 'Delete society',
      message: `Delete "${society.name}"? This cannot be undone.`,
      confirmText: 'Delete',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.delete(society.id)),
      )
      .subscribe({
        next: () => {
          this.societies.update((list) => list.filter((s) => s.id !== society.id));
          this.snack.open(`Deleted ${society.name}`, undefined, { duration: 3000 });
          this.refreshSwitcher();
        },
        error: () => {}, // e.g. 409 "has history" — reported by the error interceptor
      });
  }

  private refreshSwitcher(): void {
    this.ctx.load().subscribe();
  }
}
