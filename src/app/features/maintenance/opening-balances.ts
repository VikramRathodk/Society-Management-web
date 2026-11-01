import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, of, switchMap, tap } from 'rxjs';

import { MaintenanceApi } from '../../core/api/maintenance.api';
import { StructureApi } from '../../core/api/structure.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton } from '../../shared/ui';
import { FlatOption, dayLabel, inr, societyFlats, todayIso } from './maintenance-ui';

interface Entry {
  flat: FlatOption;
  /** As typed; blank means the flat owes nothing. */
  amount: string;
  note: string;
}

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * One-off entry of what each flat owed before the society started billing here. Each flat with an
 * amount gets an opening-balance bill; payments then settle those first (oldest due).
 */
@Component({
  selector: 'app-opening-balances',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
  ],
  templateUrl: './opening-balances.html',
  styleUrl: './maintenance.scss',
})
export class OpeningBalances {
  private readonly api = inject(MaintenanceApi);
  private readonly structure = inject(StructureApi);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly ctx = inject(SocietyContextStore);

  protected readonly inr = inr;
  protected readonly today = todayIso();

  protected asOf = this.today;
  protected dueDate = this.today;
  protected readonly entries = signal<Entry[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Bumped on every keystroke so the totals recompute (entries are edited in place). */
  private readonly edits = signal(0);
  private readonly attempt = signal(0);

  protected readonly filled = computed(() => {
    this.edits();
    return this.entries().filter((e) => e.amount.trim() !== '');
  });
  protected readonly invalid = computed(() => this.filled().filter((e) => !validAmount(e.amount)));
  protected readonly total = computed(
    () =>
      this.filled()
        .filter((e) => validAmount(e.amount))
        .reduce((sum, e) => sum + Math.round(Number(e.amount) * 100), 0) / 100,
  );

  constructor() {
    toObservable(computed(() => [this.ctx.selectedSocietyId(), this.attempt()] as const))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(([societyId]) =>
          societyId == null
            ? of([])
            : societyFlats(this.structure, societyId).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((flats) => {
        this.loadError.set(flats === null);
        this.entries.set((flats ?? []).map((flat) => ({ flat, amount: '', note: '' })));
        this.loading.set(false);
      });
  }

  protected changed(): void {
    this.edits.update((n) => n + 1);
  }

  protected invalidAmount(entry: Entry): boolean {
    return entry.amount.trim() !== '' && !validAmount(entry.amount);
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected async submit(): Promise<void> {
    const societyId = this.ctx.selectedSocietyId();
    const filled = this.filled();
    if (societyId == null || this.saving()) return;
    if (!this.asOf || !this.dueDate) {
      this.error.set('Choose both dates.');
      return;
    }
    if (this.asOf > this.today) {
      this.error.set('"Balance as of" must not be in the future.');
      return;
    }
    if (this.invalid().length) {
      this.error.set('Fix the highlighted amounts (above zero, up to 2 decimals).');
      return;
    }
    if (filled.length === 0) {
      this.error.set('Enter an amount for at least one flat.');
      return;
    }
    const ok = await firstValueFrom(
      confirmDialog(this.dialog, {
        title: 'Save opening balances',
        message:
          `${filled.length} flat(s) get an opening-balance bill, ${inr(this.total())} in total, ` +
          `due ${dayLabel(this.dueDate)}. This can be done only once; to correct it, cancel it from billing cycles and enter it again.`,
        confirmText: 'Save balances',
      }),
    );
    if (!ok) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .openingBalances(societyId, {
        asOf: this.asOf,
        dueDate: this.dueDate,
        entries: filled.map((e) => ({
          flatId: e.flat.id,
          amount: Number(e.amount),
          note: e.note.trim() || undefined,
        })),
      })
      .subscribe({
        next: (cycle) => {
          this.snack.open(`Opening balances saved for ${cycle.billCount} flat(s)`, undefined, {
            duration: 3000,
          });
          this.router.navigate(['/maintenance/cycles', cycle.id]);
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }
}

function validAmount(value: string): boolean {
  const v = value.trim();
  return AMOUNT.test(v) && Number(v) > 0;
}
