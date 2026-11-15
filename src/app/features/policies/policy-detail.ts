import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { Observable, catchError, filter, of, switchMap, tap } from 'rxjs';

import { PolicyApi } from '../../core/api/policy.api';
import { AuthStore } from '../../core/auth/auth.store';
import { Policy, PolicyVersion, PolicyVersionSummary } from '../../core/models';
import { confirmDialog } from '../../shared/confirm-dialog';
import { EmptyState, PageHeader, Section, Skeleton, StatusPill } from '../../shared/ui';
import { timeAgo } from '../visitors/visitor-ui';
import {
  RulesText,
  VERSION_STATUS,
  fileSize,
  openAttachment,
  sendBackDialog,
  versionDialog,
} from './policy-ui';

/**
 * One policy: the text in force (and any published change still to take effect), accepting it, the
 * committee's change in progress with its approval steps, and the version history.
 */
@Component({
  selector: 'app-policy-detail',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    EmptyState,
    PageHeader,
    RulesText,
    Section,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './policy-detail.html',
  styleUrl: './policy-detail.scss',
})
export class PolicyDetail {
  private readonly api = inject(PolicyApi);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly policy = signal<Policy | null>(null);
  protected readonly loading = signal(true);
  /** 'missing' for 404/403, 'failed' for anything else. */
  protected readonly loadError = signal<'missing' | 'failed' | null>(null);
  protected readonly busy = signal(false);
  private readonly attempt = signal(0);

  protected readonly status = VERSION_STATUS;
  protected readonly timeAgo = timeAgo;
  protected readonly fileSize = fileSize;

  private readonly societyId = computed(() => this.policy()?.summary.societyId ?? null);
  private readonly can = (permission: string) => this.auth.can(permission, this.societyId());
  protected readonly canDraft = computed(() => this.can('POLICY.RULE.CREATE'));
  protected readonly canApprove = computed(() => this.can('POLICY.RULE.APPROVE'));
  protected readonly canFollowUp = computed(() => {
    const p = this.policy();
    return (
      !!p &&
      p.summary.requiresAcknowledgement &&
      p.summary.status === 'ACTIVE' &&
      this.can('POLICY.ACKNOWLEDGEMENT.VIEW')
    );
  });

  protected readonly summary = computed(() => this.policy()?.summary ?? null);
  protected readonly current = computed(() => this.policy()?.current ?? null);
  protected readonly open = computed(() => this.policy()?.open ?? null);
  /** What the page shows as "the text": the published one, or the draft of a never-published policy. */
  protected readonly shown = computed(() => this.current() ?? this.open());
  protected readonly approvalRequired = computed(
    () => this.policy()?.workflow?.approvalRequired ?? true,
  );

  protected readonly mustAccept = computed(() => {
    const a = this.summary()?.yourAcknowledgement;
    return !!a && !a.acknowledgedAt;
  });
  protected readonly acceptedAt = computed(
    () => this.summary()?.yourAcknowledgement?.acknowledgedAt ?? null,
  );

  /** What the signed-in user may do with the change in progress, if any. */
  protected readonly actions = computed(() => {
    const o = this.open();
    const p = this.policy();
    const none = {
      edit: false,
      submit: false,
      publish: false,
      withdraw: false,
      approve: false,
      sendBack: false,
      discard: false,
      approveBlocked: false,
    };
    if (!o || !p) return none;
    const mine = o.createdBy.id === this.auth.user()?.id;
    const archived = p.summary.status === 'ARCHIVED';
    const draft = o.status === 'DRAFT';
    const pending = o.status === 'PENDING';
    const editor = mine || this.canApprove();
    // Secretary and above approve their own; the chairman only when the society allows it.
    const ownOk =
      this.can('POLICY.RULE.SELF_APPROVE') || (p.workflow?.selfApprovalAllowed ?? false);
    const selfOk = !mine || ownOk;
    // Approving your own draft needs no submission first.
    const selfPublish = draft && mine && this.canApprove() && ownOk && this.approvalRequired();
    return {
      edit: draft && editor && this.can('POLICY.RULE.UPDATE'),
      submit: draft && mine && this.approvalRequired() && !archived && !selfPublish,
      publish: (draft || pending) && editor && !this.approvalRequired() && !archived,
      withdraw: pending && mine,
      approve: (pending || selfPublish) && this.canApprove() && selfOk && !archived,
      approveBlocked: pending && this.canApprove() && !selfOk,
      sendBack: pending && this.canApprove(),
      discard: draft && editor,
    };
  });

  /** When the version in force today took effect. */
  protected readonly inForceSince = computed(() => {
    const p = this.policy();
    const n = p?.summary.inForceVersion;
    return n ? (p!.versions.find((v) => v.number === n)?.effectiveFrom ?? null) : null;
  });

  protected readonly canStartChange = computed(() => {
    const p = this.policy();
    return !!p && p.summary.status === 'ACTIVE' && !p.open && this.canDraft();
  });

  constructor() {
    toObservable(computed(() => [this.id(), this.attempt()] as const))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadError.set(null);
        }),
        switchMap(([id]) =>
          this.api.get(id).pipe(
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(err.status === 404 || err.status === 403 ? 'missing' : 'failed');
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((policy) => {
        this.policy.set(policy);
        this.loading.set(false);
      });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected openFile(version: PolicyVersion): void {
    openAttachment(this.api, version.id);
  }

  protected accept(): void {
    const v = this.current();
    if (!v) return;
    this.busy.set(true);
    this.api.acknowledge(v.id).subscribe({
      next: (ack) => {
        this.busy.set(false);
        this.policy.update((p) =>
          p
            ? {
                ...p,
                summary: {
                  ...p.summary,
                  yourAcknowledgement: { version: ack.version, acknowledgedAt: ack.acknowledgedAt },
                },
              }
            : p,
        );
        this.snack.open('Thank you — accepted', undefined, { duration: 3000 });
      },
      error: () => {
        this.busy.set(false);
        this.retry(); // a newer version may have been published
      },
    });
  }

  /** One published version, compared with the one before it. */
  protected showVersion(v: PolicyVersionSummary): void {
    const p = this.policy();
    if (!p) return;
    const published = p.versions.filter(
      (x) => x.status === 'PUBLISHED' || x.status === 'SUPERSEDED',
    );
    const previous = published.find((x) => x.number < v.number);
    versionDialog(this.dialog, {
      policyId: p.summary.id,
      title: p.summary.title,
      number: v.number,
      version: v.status === 'DRAFT' || v.status === 'PENDING' ? (p.open ?? undefined) : undefined,
      compareWith: previous?.number ?? null,
    });
  }

  protected showNumber(n: number): void {
    const v = this.policy()?.versions.find((x) => x.number === n);
    if (v) this.showVersion(v);
  }

  /** The change in progress compared with the published text. */
  protected showChanges(): void {
    const p = this.policy();
    const o = p?.open;
    if (!p || !o) return;
    versionDialog(this.dialog, {
      policyId: p.summary.id,
      title: p.summary.title,
      number: o.number,
      version: o,
      compareWith: p.current?.number ?? null,
    });
  }

  protected startChange(): void {
    const p = this.policy();
    if (!p) return;
    this.run(this.api.startVersion(p.summary.id), () =>
      this.router.navigate(['/policies', p.summary.id, 'edit']),
    );
  }

  protected submit(): void {
    const o = this.open();
    if (o) this.run(this.api.submit(o.id), () => this.toast('Sent for approval'));
  }

  protected withdraw(): void {
    const o = this.open();
    if (o) this.run(this.api.withdraw(o.id), () => this.toast('Withdrawn — back to draft'));
  }

  protected approve(): void {
    const p = this.policy();
    const o = this.open();
    if (!p || !o) return;
    confirmDialog(this.dialog, {
      title: 'Approve and publish?',
      message: `Everyone in the society will be told about "${p.summary.title}"${
        o.number > 1 ? ` (version ${o.number})` : ''
      }.`,
      confirmText: 'Approve and publish',
    })
      .pipe(filter(Boolean))
      .subscribe(() =>
        this.run(this.api.approve(o.id), () => this.toast('Approved and published')),
      );
  }

  protected publish(): void {
    const p = this.policy();
    const o = this.open();
    if (!p || !o) return;
    confirmDialog(this.dialog, {
      title: 'Publish now?',
      message: `Everyone in the society will be told about "${p.summary.title}".`,
      confirmText: 'Publish',
    })
      .pipe(filter(Boolean))
      .subscribe(() => this.run(this.api.publish(o.id), () => this.toast('Published')));
  }

  protected sendBack(): void {
    const p = this.policy();
    const o = this.open();
    if (!p || !o) return;
    sendBackDialog(this.dialog, { versionId: o.id, title: p.summary.title, number: o.number })
      .pipe(filter(Boolean))
      .subscribe((saved) => {
        this.policy.set(saved);
        this.toast('Sent back to the author');
      });
  }

  protected discard(): void {
    const p = this.policy();
    const o = this.open();
    if (!p || !o) return;
    const whole = o.number === 1;
    confirmDialog(this.dialog, {
      title: whole ? 'Delete this policy?' : 'Discard this change?',
      message: whole
        ? 'It was never published; the draft is deleted.'
        : `The published version ${p.current?.number} stays as it is.`,
      confirmText: whole ? 'Delete' : 'Discard',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.deleteDraft(o.id)),
      )
      .subscribe(() => {
        if (whole) this.router.navigate(['/policies'], { queryParams: { view: 'drafts' } });
        else this.retry();
      });
  }

  protected archive(): void {
    const p = this.policy();
    if (!p) return;
    confirmDialog(this.dialog, {
      title: 'Archive this policy?',
      message:
        'It leaves the rules page and is no longer in force. Its history is kept and it can be restored.',
      confirmText: 'Archive',
    })
      .pipe(filter(Boolean))
      .subscribe(() => this.run(this.api.archive(p.summary.id), () => this.toast('Archived')));
  }

  protected restore(): void {
    const p = this.policy();
    if (p) this.run(this.api.restore(p.summary.id), () => this.toast('Restored'));
  }

  private run(request: Observable<Policy>, done?: () => void): void {
    this.busy.set(true);
    request.subscribe({
      next: (policy) => {
        this.busy.set(false);
        this.policy.set(policy);
        done?.();
      },
      error: () => {
        this.busy.set(false); // reported by the error interceptor
        this.retry();
      },
    });
  }

  private toast(message: string): void {
    this.snack.open(message, undefined, { duration: 3000 });
  }
}
