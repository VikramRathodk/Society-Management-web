import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, catchError, forkJoin, of, switchMap } from 'rxjs';

import { PolicyApi } from '../../core/api/policy.api';
import { AuthStore } from '../../core/auth/auth.store';
import { errorMessage } from '../../core/auth/error.interceptor';
import { Policy, PolicyCategory } from '../../core/models';
import { SocietyContextStore } from '../../core/society-context/society-context.store';
import { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton } from '../../shared/ui';
import { RulesText, fileSize, openAttachment, todayIso } from './policy-ui';

const MAX_BODY = 50_000;
const MAX_FILE = 5 * 1024 * 1024;

type Next = 'stay' | 'submit' | 'publish';

/**
 * Writes a new policy, or edits one: its draft text (while it is a draft) and its title, category and
 * whether residents must accept it (approvers only, once published).
 */
@Component({
  selector: 'app-policy-editor',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    EmptyState,
    PageHeader,
    RulesText,
    Section,
    Skeleton,
  ],
  templateUrl: './policy-editor.html',
  styleUrl: './policy-editor.scss',
})
export class PolicyEditor implements HasUnsavedChanges {
  private readonly api = inject(PolicyApi);
  private readonly auth = inject(AuthStore);
  private readonly ctx = inject(SocietyContextStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Absent for a new policy. */
  readonly id = input<string | undefined>(undefined);

  protected readonly form = inject(NonNullableFormBuilder).group({
    title: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(200)]],
    categoryId: [null as number | null, Validators.required],
    requiresAcknowledgement: [false],
    body: ['', Validators.maxLength(MAX_BODY)],
    changeSummary: ['', Validators.maxLength(500)],
    effectiveFrom: [''],
    materialChange: [true],
  });

  protected readonly policy = signal<Policy | null>(null);
  protected readonly categories = signal<PolicyCategory[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly mode = signal<'write' | 'preview'>('write');
  /** A file chosen to attach on save, or 'remove' to drop the current one. */
  protected readonly file = signal<File | 'remove' | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly fileSize = fileSize;
  protected readonly today = todayIso();
  protected readonly maxBody = MAX_BODY;
  private saved = false;

  protected readonly isNew = computed(() => this.id() == null);
  private readonly societyId = computed(
    () => this.policy()?.summary.societyId ?? this.ctx.selectedSocietyId(),
  );
  private readonly canApprove = computed(() =>
    this.auth.can('POLICY.RULE.APPROVE', this.societyId()),
  );
  /** The draft being edited, if the policy has one and the user may edit it. */
  protected readonly draft = computed(() => {
    const p = this.policy();
    const o = p?.open;
    if (!o || o.status !== 'DRAFT') return null;
    return o.createdBy.id === this.auth.user()?.id || this.canApprove() ? o : null;
  });
  /** Title, category and acknowledgement: author or approver before publication, approvers after. */
  protected readonly detailsEditable = computed(() => {
    const p = this.policy();
    if (!p) return true;
    if (p.summary.status === 'DRAFT')
      return p.createdBy.id === this.auth.user()?.id || this.canApprove();
    return this.canApprove();
  });
  protected readonly textEditable = computed(() => this.isNew() || this.draft() != null);
  protected readonly versionNumber = computed(() => this.draft()?.number ?? 1);
  protected readonly approvalRequired = computed(
    () => this.policy()?.workflow?.approvalRequired ?? true,
  );
  protected readonly isAuthor = computed(
    () => this.isNew() || this.draft()?.createdBy.id === this.auth.user()?.id,
  );
  /** Categories to choose from: shown ones, plus the policy's own even if hidden since. */
  protected readonly choices = computed(() =>
    this.categories().filter((c) => !c.hidden || c.id === this.policy()?.summary.category.id),
  );
  protected readonly currentAttachment = computed(() => this.draft()?.attachment ?? null);

  constructor() {
    toObservable(computed(() => ({ id: this.id(), societyId: this.ctx.selectedSocietyId() })))
      .pipe(
        switchMap(({ id, societyId }) => {
          this.loading.set(true);
          this.loadError.set(null);
          const policy$: Observable<Policy | null> = id ? this.api.get(Number(id)) : of(null);
          return policy$.pipe(
            switchMap((policy) => {
              const sid = policy?.summary.societyId ?? societyId;
              return forkJoin({
                policy: of(policy),
                categories: sid == null ? of([] as PolicyCategory[]) : this.api.categories(sid),
              });
            }),
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(
                err.status === 404 || err.status === 403
                  ? "This policy doesn't exist or isn't yours to edit."
                  : "Couldn't load the policy.",
              );
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if (!result) return;
        this.categories.set(result.categories);
        this.policy.set(result.policy);
        this.fill(result.policy);
      });
  }

  canLeave(): boolean | Observable<boolean> {
    if (this.saved || (!this.form.dirty && this.file() == null)) return true;
    return confirmDialog(this.dialog, {
      title: 'Leave without saving?',
      message: 'Your changes to this policy will be lost.',
      confirmText: 'Leave',
    });
  }

  protected chooseFile(event: Event): void {
    const target = event.target as HTMLInputElement;
    const chosen = target.files?.[0];
    target.value = '';
    this.fileError.set(null);
    if (!chosen) return;
    if (chosen.size > MAX_FILE) {
      this.fileError.set('Files can be at most 5 MB.');
      return;
    }
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(chosen.type)) {
      this.fileError.set('Attach a PDF, JPEG, PNG or WebP file.');
      return;
    }
    this.file.set(chosen);
  }

  protected chosenFile(): File | null {
    const f = this.file();
    return f instanceof File ? f : null;
  }

  protected openCurrentFile(): void {
    const d = this.draft();
    if (d) openAttachment(this.api, d.id);
  }

  protected save(next: Next = 'stay'): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (next !== 'stay' && !this.form.controls.body.value.trim()) {
      this.error.set('Write the policy’s text before sending it on.');
      return;
    }
    const societyId = this.societyId();
    if (societyId == null) return;
    this.saving.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const text = {
      body: v.body.trim(),
      changeSummary: v.changeSummary.trim() || null,
      effectiveFrom: v.effectiveFrom || null,
      materialChange: v.materialChange,
    };

    let chain: Observable<Policy>;
    const existing = this.policy();
    if (!existing) {
      chain = this.api.create(societyId, {
        categoryId: v.categoryId!,
        title: v.title.trim(),
        requiresAcknowledgement: v.requiresAcknowledgement,
        ...text,
      });
    } else {
      const id = existing.summary.id;
      const details =
        this.detailsEditable() && this.detailsChanged(existing)
          ? this.api.update(id, {
              title: v.title.trim(),
              categoryId: v.categoryId!,
              requiresAcknowledgement: v.requiresAcknowledgement,
            })
          : of(existing);
      const draft = this.draft();
      chain = details.pipe(switchMap((p) => (draft ? this.api.saveDraft(draft.id, text) : of(p))));
    }

    chain
      .pipe(
        switchMap((p) => this.saveFile(p)),
        switchMap((p) => {
          const open = p.open;
          if (!open || next === 'stay') return of(p);
          return next === 'submit' ? this.api.submit(open.id) : this.api.publish(open.id);
        }),
      )
      .subscribe({
        next: (p) => {
          this.saved = true;
          this.saving.set(false);
          const message =
            next === 'submit' ? 'Sent for approval' : next === 'publish' ? 'Published' : 'Saved';
          this.snack.open(message, undefined, { duration: 3000 });
          this.router.navigate(['/policies', p.summary.id]);
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  protected cancel(): void {
    const p = this.policy();
    this.router.navigate(p ? ['/policies', p.summary.id] : ['/policies']);
  }

  private saveFile(p: Policy): Observable<Policy> {
    const f = this.file();
    const open = p.open;
    if (!open || f == null) return of(p);
    if (f === 'remove') return open.attachment ? this.api.removeAttachment(open.id) : of(p);
    return this.api.setAttachment(open.id, f);
  }

  private detailsChanged(p: Policy): boolean {
    const v = this.form.getRawValue();
    return (
      v.title.trim() !== p.summary.title ||
      v.categoryId !== p.summary.category.id ||
      v.requiresAcknowledgement !== p.summary.requiresAcknowledgement
    );
  }

  private fill(p: Policy | null): void {
    if (!p) {
      const preset = Number(this.route.snapshot.queryParamMap.get('category'));
      if (preset && this.categories().some((c) => c.id === preset)) {
        this.form.controls.categoryId.setValue(preset);
      }
      return;
    }
    const source = this.draft() ?? p.current;
    this.form.reset({
      title: p.summary.title,
      categoryId: p.summary.category.id,
      requiresAcknowledgement: p.summary.requiresAcknowledgement,
      body: source?.body ?? '',
      changeSummary: this.draft()?.changeSummary ?? '',
      effectiveFrom: this.draft()?.effectiveFrom ?? '',
      materialChange: this.draft()?.materialChange ?? true,
    });
    if (!this.detailsEditable()) {
      this.form.controls.title.disable();
      this.form.controls.categoryId.disable();
      this.form.controls.requiresAcknowledgement.disable();
    }
    if (!this.textEditable()) {
      for (const c of ['body', 'changeSummary', 'effectiveFrom', 'materialChange'] as const) {
        this.form.controls[c].disable();
      }
    }
  }
}
