import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter, switchMap } from 'rxjs';

import { OnboardingApi } from '../../core/api/onboarding.api';
import { errorMessage } from '../../core/auth/error.interceptor';
import { ImportRow, ResidentImport, SendResult, SheetColumns } from '../../core/models';
import { confirmDialog } from '../../shared/confirm-dialog';
import { saveFile } from '../../shared/export-dialog';
import { StatusPill } from '../../shared/ui';
import { residentTypeLabel } from '../invitations/invitation-ui';
import { SentInvitations } from './sent-invitations';

type RowFilter = 'all' | 'ready' | 'problems';

/** The first line's cells, split on whichever separator it uses most. */
export function headerOf(text: string): string[] {
  const first = text.replace(String.fromCharCode(0xfeff), '').split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t', '|'].reduce((best, d) =>
    first.split(d).length > first.split(best).length ? d : best,
  );
  return first.split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
}

const TEMPLATE =
  'Wing,Flat,Name,Phone,Type\r\nA,101,Meera Shah,9876543210,Owner\r\nA,102,Ravi Kumar,9876543211,Tenant\r\n';

/**
 * Setup step 3: residents from a CSV. Rows are staged, not sent, and checked again whenever the sheet
 * is opened. A live society sends them here; one being set up sends them when it goes live.
 */
@Component({
  selector: 'app-resident-importer',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    StatusPill,
    SentInvitations,
  ],
  template: `
    @if (result(); as r) {
      <app-sent-invitations [result]="r" [societyName]="societyName()" />
      <div class="actions">
        <span class="spacer"></span>
        <button mat-button type="button" (click)="result.set(null)">Import another sheet</button>
      </div>
    } @else {
      <div class="actions">
        <button mat-stroked-button type="button" (click)="fileInput.click()" [disabled]="busy()">
          <mat-icon>upload_file</mat-icon>
          {{ sheet() ? 'Upload a new sheet' : 'Upload residents sheet' }}
        </button>
        <button mat-button type="button" (click)="downloadTemplate()">
          <mat-icon>download</mat-icon> Template
        </button>
        <input
          #fileInput
          type="file"
          accept=".csv,text/csv"
          hidden
          (change)="pick($event)"
          data-testid="sheet-input"
        />
        <span class="spacer"></span>
        @if (sheet()) {
          <button mat-button type="button" (click)="discard()" [disabled]="busy()">
            Discard sheet
          </button>
        }
      </div>
      <p class="hint">
        A CSV with a header row: flat, name and phone, optionally wing and owner/tenant/family. From
        Excel or Google Sheets, save or download as CSV.
      </p>

      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }

      @if (header().length && file()) {
        <div class="columns" aria-label="Columns">
          @for (field of fields; track field.key) {
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>{{ field.label }}</mat-label>
              <mat-select
                [ngModel]="columns()[field.key]"
                (ngModelChange)="setColumn(field.key, $event)"
                [required]="!field.optional"
              >
                @if (field.optional) {
                  <mat-option [value]="null">None</mat-option>
                }
                @for (h of header(); track $index) {
                  <mat-option [value]="$index + 1">{{ h || 'Column ' + ($index + 1) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          <button mat-stroked-button type="button" (click)="reread()" [disabled]="busy()">
            Read again
          </button>
        </div>
      }

      @if (sheet(); as s) {
        <div class="summary">
          <app-status-pill tone="success">{{ s.ready }} ready</app-status-pill>
          @if (s.withErrors) {
            <app-status-pill tone="danger">{{ s.withErrors }} with problems</app-status-pill>
          }
          <span class="muted">{{ s.fileName ?? 'Sheet' }} · {{ s.total }} rows</span>
          <span class="spacer"></span>
          <mat-button-toggle-group
            [ngModel]="rowFilter()"
            (ngModelChange)="rowFilter.set($event)"
            aria-label="Show rows"
            hideSingleSelectionIndicator
          >
            <mat-button-toggle value="all">All</mat-button-toggle>
            <mat-button-toggle value="ready">Ready</mat-button-toggle>
            <mat-button-toggle value="problems">Problems</mat-button-toggle>
          </mat-button-toggle-group>
        </div>

        <div class="table-scroll">
          <table class="rows">
            <thead>
              <tr>
                <th>Row</th>
                <th>Flat</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Status</th>
                <th><span class="cdk-visually-hidden">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of shown(); track r.id) {
                <tr [class.problem]="r.error">
                  <td class="num">{{ r.row }}</td>
                  <td>{{ r.flatLabel ?? flatText(r) }}</td>
                  <td>{{ r.name ?? '—' }}</td>
                  <td>{{ r.phone ?? r.phoneText ?? '—' }}</td>
                  <td>{{ r.residentType ? typeLabel(r.residentType) : (r.typeText ?? '—') }}</td>
                  <td class="status">
                    @if (r.error) {
                      <span class="error-text">{{ r.error }}</span>
                    } @else {
                      Ready
                    }
                  </td>
                  <td>
                    <button
                      mat-icon-button
                      type="button"
                      (click)="remove(r)"
                      matTooltip="Leave this row out"
                      [attr.aria-label]="'Leave out row ' + r.row"
                    >
                      <mat-icon>close</mat-icon>
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="muted">Nothing to show.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="actions send">
          @if (live()) {
            <span class="muted">Each ready row gets an invitation link to share.</span>
            <span class="spacer"></span>
            <button
              mat-flat-button
              type="button"
              (click)="send()"
              [disabled]="busy() || s.ready === 0"
            >
              Send {{ s.ready }} invitations
            </button>
          } @else {
            <p class="muted" role="note">
              <mat-icon aria-hidden="true">schedule_send</mat-icon>
              The {{ s.ready }} ready rows become invitations when the society goes live. Until then
              you can fix and upload the sheet again.
            </p>
          }
        </div>
      }
    }
  `,
  styles: `
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .spacer {
      flex: 1;
    }
    .hint,
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .muted mat-icon {
      vertical-align: middle;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .form-error {
      color: var(--mat-sys-error);
    }
    .columns {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin: 8px 0 16px;
    }
    .columns mat-form-field {
      flex: 1 1 140px;
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 8px 0;
    }
    .table-scroll {
      overflow-x: auto;
    }
    table.rows {
      width: 100%;
      border-collapse: collapse;
      font: var(--mat-sys-body-medium);
    }
    .rows th,
    .rows td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .rows th {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }
    .rows .num {
      color: var(--mat-sys-on-surface-variant);
    }
    .rows tr.problem {
      background: color-mix(in srgb, var(--mat-sys-error-container) 40%, transparent);
    }
    .error-text {
      color: var(--mat-sys-error);
    }
    .send {
      margin-top: 12px;
    }
  `,
})
export class ResidentImporter {
  private readonly api = inject(OnboardingApi);
  private readonly dialog = inject(MatDialog);

  readonly societyId = input.required<number>();
  readonly societyName = input.required<string>();
  /** Live societies send from here; in Setup the sheet goes out at go-live. */
  readonly live = input(false);
  /** The staged sheet changed (uploaded, edited, discarded or sent). */
  readonly changed = output<void>();

  protected readonly fields: { key: keyof SheetColumns; label: string; optional: boolean }[] = [
    { key: 'flat', label: 'Flat', optional: false },
    { key: 'name', label: 'Name', optional: false },
    { key: 'phone', label: 'Phone', optional: false },
    { key: 'wing', label: 'Wing', optional: true },
    { key: 'type', label: 'Owner / tenant', optional: true },
  ];

  protected readonly sheet = signal<ResidentImport | null>(null);
  protected readonly file = signal<File | null>(null);
  protected readonly header = signal<string[]>([]);
  protected readonly columns = signal<SheetColumns>({
    flat: 1,
    name: 2,
    phone: 3,
    wing: null,
    type: null,
  });
  protected readonly result = signal<SendResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly rowFilter = signal<RowFilter>('all');

  protected readonly shown = computed(() => {
    const rows = this.sheet()?.rows ?? [];
    const show = this.rowFilter();
    if (show === 'ready') return rows.filter((r) => !r.error);
    if (show === 'problems') return rows.filter((r) => r.error);
    return rows;
  });

  protected readonly typeLabel = residentTypeLabel;

  constructor() {
    effect(() => {
      const id = this.societyId();
      untracked(() => this.load(id));
    });
  }

  protected setColumn(key: keyof SheetColumns, value: number | null): void {
    this.columns.update((c) => ({ ...c, [key]: value }));
  }

  protected flatText(r: ImportRow): string {
    return [r.wingText, r.flatText].filter(Boolean).join(' ') || '—';
  }

  protected pick(event: Event): void {
    const field = event.target as HTMLInputElement;
    const file = field.files?.[0];
    field.value = '';
    if (!file) return;
    this.file.set(file);
    // The header is read here too, so the columns can be chosen even when the server can't guess them.
    void file.text().then((text) => this.header.set(headerOf(text)));
    this.upload(file, null);
  }

  /** The same file with the columns as chosen. */
  protected reread(): void {
    const file = this.file();
    if (file) this.upload(file, { ...this.columns() });
  }

  protected remove(row: ImportRow): void {
    this.busy.set(true);
    this.api.removeResidentRow(this.societyId(), row.id).subscribe({
      next: (sheet) => this.staged(sheet),
      error: () => this.busy.set(false),
    });
  }

  protected discard(): void {
    confirmDialog(this.dialog, {
      title: 'Discard sheet',
      message: 'Remove the uploaded residents? Nobody has been invited from it yet.',
      confirmText: 'Discard',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.discardResidents(this.societyId())),
      )
      .subscribe({
        next: () => {
          this.sheet.set(null);
          this.file.set(null);
          this.header.set([]);
          this.changed.emit();
        },
        error: () => {},
      });
  }

  protected send(): void {
    const ready = this.sheet()?.ready ?? 0;
    confirmDialog(this.dialog, {
      title: 'Send invitations',
      message: `Invite ${ready} residents? You'll get their links as a CSV and printable QR cards.`,
      confirmText: 'Send',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.busy.set(true);
          return this.api.sendResidents(this.societyId());
        }),
      )
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.result.set(result);
          this.sheet.set(null);
          this.file.set(null);
          this.header.set([]);
          this.changed.emit();
        },
        error: () => this.busy.set(false),
      });
  }

  protected downloadTemplate(): void {
    saveFile(new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' }), 'residents-template.csv');
  }

  private load(societyId: number): void {
    this.api.currentResidents(societyId).subscribe({
      next: (sheet) => this.sheet.set(sheet),
      error: () => {},
    });
  }

  private upload(file: File, columns: SheetColumns | null): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.uploadResidents(this.societyId(), file, columns).subscribe({
      next: (uploaded) => {
        this.header.set(uploaded.header);
        this.columns.set({ ...uploaded.columns });
        this.staged(uploaded.sheet);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  private staged(sheet: ResidentImport): void {
    this.busy.set(false);
    this.sheet.set(sheet);
    this.changed.emit();
  }
}
