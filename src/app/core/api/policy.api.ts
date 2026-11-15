import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  AcknowledgementReport,
  AcknowledgementState,
  CreatePolicyRequest,
  Policy,
  PolicyAcknowledgement,
  PolicyCategory,
  PolicyFilter,
  PolicySummary,
  PolicyVersion,
  PolicyReminderResult,
  SavePolicyDraftRequest,
  UpdatePolicyRequest,
} from '../models';

export interface PolicyListQuery {
  filter?: PolicyFilter;
  categoryId?: number | null;
  q?: string | null;
}

/** Rules & policies: categories, policies and their versions, approval, acknowledgements. */
@Injectable({ providedIn: 'root' })
export class PolicyApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  // ---- Categories ----

  categories(societyId: number) {
    return this.http.get<PolicyCategory[]>(`${this.api}/societies/${societyId}/policy-categories`);
  }

  /** Errors are shown in the dialog. */
  createCategory(societyId: number, name: string) {
    return this.http.post<PolicyCategory>(
      `${this.api}/societies/${societyId}/policy-categories`,
      { name },
      { context: inlineErrors() },
    );
  }

  /** Errors are shown in the dialog. */
  updateCategory(
    id: number,
    changes: Partial<Pick<PolicyCategory, 'name' | 'position' | 'hidden'>>,
  ) {
    return this.http.patch<PolicyCategory>(`${this.api}/policy-categories/${id}`, changes, {
      context: inlineErrors(),
    });
  }

  // ---- Policies ----

  /** Ordered by category, then title. */
  list(societyId: number, query: PolicyListQuery = {}, options: { silent?: boolean } = {}) {
    const params: Record<string, string | number> = { filter: query.filter ?? 'published' };
    if (query.categoryId != null) params['categoryId'] = query.categoryId;
    if (query.q?.trim()) params['q'] = query.q.trim();
    return this.http.get<PolicySummary[]>(`${this.api}/societies/${societyId}/policies`, {
      params,
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  /** The caller's own: published policies still waiting for their acknowledgement. */
  pendingAcknowledgements(societyId: number, options: { silent?: boolean } = {}) {
    return this.http.get<PolicySummary[]>(
      `${this.api}/societies/${societyId}/policies/pending-acknowledgements`,
      { context: options.silent ? inlineErrors() : undefined },
    );
  }

  /** Inline errors: the page shows "not found" itself. */
  get(id: number) {
    return this.http.get<Policy>(`${this.api}/policies/${id}`, { context: inlineErrors() });
  }

  version(policyId: number, number: number) {
    return this.http.get<PolicyVersion>(`${this.api}/policies/${policyId}/versions/${number}`);
  }

  /** Errors are shown in the form. */
  create(societyId: number, request: CreatePolicyRequest) {
    return this.http.post<Policy>(`${this.api}/societies/${societyId}/policies`, request, {
      context: inlineErrors(),
    });
  }

  /** Errors are shown in the form. */
  update(id: number, changes: UpdatePolicyRequest) {
    return this.http.patch<Policy>(`${this.api}/policies/${id}`, changes, {
      context: inlineErrors(),
    });
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.api}/policies/${id}`);
  }

  archive(id: number) {
    return this.http.post<Policy>(`${this.api}/policies/${id}/archive`, null);
  }

  restore(id: number) {
    return this.http.post<Policy>(`${this.api}/policies/${id}/restore`, null);
  }

  /** A new draft of a published policy, from its current text. */
  startVersion(id: number) {
    return this.http.post<Policy>(`${this.api}/policies/${id}/versions`, null);
  }

  // ---- Drafts ----

  /** Errors are shown in the form. */
  saveDraft(versionId: number, draft: SavePolicyDraftRequest) {
    return this.http.put<Policy>(`${this.api}/policy-versions/${versionId}`, draft, {
      context: inlineErrors(),
    });
  }

  /** For a policy that was never published, deletes the policy too. */
  deleteDraft(versionId: number) {
    return this.http.delete<void>(`${this.api}/policy-versions/${versionId}`);
  }

  /** Errors are shown in the form. */
  setAttachment(versionId: number, file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.put<Policy>(`${this.api}/policy-versions/${versionId}/attachment`, form, {
      context: inlineErrors(),
    });
  }

  removeAttachment(versionId: number) {
    return this.http.delete<Policy>(`${this.api}/policy-versions/${versionId}/attachment`);
  }

  attachment(versionId: number) {
    return this.http.get(`${this.api}/policy-versions/${versionId}/attachment`, {
      responseType: 'blob',
    });
  }

  // ---- Workflow ----

  submit(versionId: number) {
    return this.http.post<Policy>(`${this.api}/policy-versions/${versionId}/submit`, null);
  }

  withdraw(versionId: number) {
    return this.http.post<Policy>(`${this.api}/policy-versions/${versionId}/withdraw`, null);
  }

  approve(versionId: number) {
    return this.http.post<Policy>(`${this.api}/policy-versions/${versionId}/approve`, null);
  }

  /** Errors are shown in the dialog. */
  sendBack(versionId: number, reason: string) {
    return this.http.post<Policy>(
      `${this.api}/policy-versions/${versionId}/send-back`,
      { reason },
      { context: inlineErrors() },
    );
  }

  /** Only when the society doesn't need approval. */
  publish(versionId: number) {
    return this.http.post<Policy>(`${this.api}/policy-versions/${versionId}/publish`, null);
  }

  // ---- Acknowledgements ----

  acknowledge(versionId: number) {
    return this.http.post<PolicyAcknowledgement>(
      `${this.api}/policy-versions/${versionId}/acknowledge`,
      null,
    );
  }

  acknowledgements(policyId: number, state: AcknowledgementState = 'all') {
    return this.http.get<AcknowledgementReport>(
      `${this.api}/policies/${policyId}/acknowledgements`,
      {
        params: { state },
      },
    );
  }

  remind(policyId: number) {
    return this.http.post<PolicyReminderResult>(
      `${this.api}/policies/${policyId}/acknowledgements/remind`,
      null,
    );
  }

  exportAcknowledgements(policyId: number) {
    return this.http.get(`${this.api}/policies/${policyId}/acknowledgements.csv`, {
      responseType: 'blob',
      observe: 'response',
    });
  }
}
