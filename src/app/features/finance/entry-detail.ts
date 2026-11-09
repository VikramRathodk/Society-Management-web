import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { FinanceApi } from '../../core/api/finance.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { DocumentType, FinanceDocument, Voucher } from '../../core/models';
import { Notifier } from '../../core/notifier';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { dayLabel, inr, reasonDialog } from '../maintenance/maintenance-ui';
import { FinanceAccess, VOUCHER_STATUS, VOUCHER_TYPE, entryDialog } from './finance-ui';

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'INVOICE', label: 'Invoice / bill' },
  { value: 'RECEIPT', label: 'Receipt' },
  { value: 'APPROVAL', label: 'Approval' },
  { value: 'BANK_PROOF', label: 'Bank proof' },
  { value: 'OTHER', label: 'Other' },
];

const MANUAL = new Set(['RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL']);

/**
 * One entry: its lines, documents and history. Waiting entries can be approved or rejected by someone
 * other than their maker, who may edit or withdraw them instead. Posted hand-made entries can be
 * voided (a reversal dated today). Entries from maintenance are undone in maintenance.
 */
@Component({
  selector: 'app-entry-detail',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    EmptyState,
    PageHeader,
    Section,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './entry-detail.html',
  styleUrls: ['../maintenance/maintenance.scss', './finance.scss'],
})
export class EntryDetail {
  private readonly api = inject(FinanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly notifier = inject(Notifier);
  protected readonly access = inject(FinanceAccess);

  protected readonly inr = inr;
  protected readonly dayLabel = dayLabel;
  protected readonly voucherType = VOUCHER_TYPE;
  protected readonly documentTypes = DOCUMENT_TYPES;

  protected readonly voucher = signal<Voucher | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  protected readonly busy = signal(false);
  protected readonly uploadType = signal<DocumentType>('INVOICE');
  protected readonly uploadError = signal<string | null>(null);
  private readonly attempt = signal(0);

  protected readonly status = computed(() => {
    const v = this.voucher();
    return v ? VOUCHER_STATUS[v.status] : null;
  });
  protected readonly isMaker = computed(() => this.voucher()?.createdBy === this.access.userId());
  protected readonly waiting = computed(() => this.voucher()?.status === 'PENDING_APPROVAL');
  protected readonly canDecide = computed(
    () => this.waiting() && this.access.canApprove() && !this.isMaker(),
  );
  protected readonly canEdit = computed(() => {
    const v = this.voucher();
    if (!v || !this.waiting() || !this.isMaker()) return false;
    return v.type === 'JOURNAL'
      ? this.access.canJournal()
      : v.type === 'PAYMENT' && this.access.canRecord();
  });
  protected readonly canVoid = computed(() => {
    const v = this.voucher();
    return (
      !!v &&
      v.status === 'POSTED' &&
      MANUAL.has(v.type) &&
      !v.reversesVoucherId &&
      this.access.canVoid()
    );
  });
  protected readonly canAttach = computed(() => {
    const v = this.voucher();
    return !!v && v.status !== 'REJECTED' && this.access.canRecord();
  });
  protected readonly totals = computed(() => {
    const lines = this.voucher()?.lines ?? [];
    return {
      debit: lines.reduce((s, l) => s + l.debit, 0),
      credit: lines.reduce((s, l) => s + l.credit, 0),
    };
  });

  constructor() {
    const route = inject(ActivatedRoute);
    route.paramMap
      .pipe(
        map((p) => Number(p.get('id'))),
        switchMap((id) => this.reload$(id)),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  private reload$(id: number) {
    this.loading.set(true);
    return this.api.voucher(id).pipe(
      tap((v) => {
        this.voucher.set(v);
        this.loadError.set(null);
        this.loading.set(false);
      }),
      catchError((err) => {
        this.loadError.set(err?.status === 404 || err?.status === 403 ? 'missing' : 'failed');
        this.loading.set(false);
        return of(null);
      }),
    );
  }

  protected retry(): void {
    const id = this.voucher()?.id ?? Number(this.router.url.split('/').pop());
    this.reload$(id).subscribe();
  }

  private replace(v: Voucher): void {
    this.voucher.set(v);
  }

  protected approve(): void {
    const v = this.voucher();
    if (!v) return;
    confirmDialog(this.dialog, {
      title: `Approve ${v.number}?`,
      message: `${inr(v.amount)}${v.payee ? ' to ' + v.payee : ''} goes into the books.`,
      confirmText: 'Approve',
    }).subscribe((ok) => {
      if (!ok) return;
      this.busy.set(true);
      this.api.approve(v.id).subscribe({
        next: (saved) => {
          this.busy.set(false);
          this.replace(saved);
          this.notifier.show(`${saved.number} approved`);
        },
        error: () => this.busy.set(false),
      });
    });
  }

  protected reject(): void {
    const v = this.voucher();
    if (!v) return;
    reasonDialog(this.dialog, {
      title: `Reject ${v.number}?`,
      message: 'It stays as rejected, with your reason, and never counts in the books.',
      label: 'Reason',
      confirmText: 'Reject',
      save: (reason) => this.api.reject(v.id, reason),
    }).subscribe((saved) => this.replace(saved));
  }

  protected withdraw(): void {
    const v = this.voucher();
    if (!v) return;
    confirmDialog(this.dialog, {
      title: `Withdraw ${v.number}?`,
      message: 'It stays as rejected (so its number is kept) and never counts in the books.',
      confirmText: 'Withdraw',
    }).subscribe((ok) => {
      if (!ok) return;
      this.api.withdraw(v.id).subscribe((saved) => this.replace(saved));
    });
  }

  protected edit(): void {
    const v = this.voucher();
    if (!v) return;
    this.api
      .accounts(v.societyId)
      .subscribe((accounts) =>
        entryDialog(this.dialog, {
          societyId: v.societyId,
          kind: v.type as 'PAYMENT' | 'JOURNAL',
          accounts,
          voucher: v,
        }).subscribe((saved) => this.replace(saved)),
      );
  }

  protected voidEntry(): void {
    const v = this.voucher();
    if (!v) return;
    reasonDialog(this.dialog, {
      title: `Void ${v.number}?`,
      message:
        'A reversal dated today is booked; this entry stays in the books, marked void, so earlier reports don’t change.',
      label: 'Reason',
      confirmText: 'Void',
      save: (reason) => this.api.void(v.id, reason),
    }).subscribe((saved) => this.replace(saved));
  }

  protected upload(event: Event): void {
    const v = this.voucher();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!v || !file) return;
    this.uploadError.set(null);
    this.busy.set(true);
    this.api.addDocument(v.id, file, this.uploadType()).subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.replace(saved);
      },
      error: (err) => {
        this.busy.set(false);
        this.uploadError.set(errorMessage(err));
      },
    });
  }

  protected open(doc: FinanceDocument): void {
    this.api.document(doc.id).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  protected removeDocument(doc: FinanceDocument): void {
    const v = this.voucher();
    if (!v) return;
    confirmDialog(this.dialog, {
      title: 'Remove this document?',
      message: doc.filename ?? 'The file is deleted.',
      confirmText: 'Remove',
    }).subscribe((ok) => {
      if (!ok) return;
      this.api.removeDocument(doc.id).subscribe(() => this.retry());
    });
  }

  protected size(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
