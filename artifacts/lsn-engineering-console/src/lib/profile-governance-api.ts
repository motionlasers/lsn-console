import { getDesktopBridge } from "./desktop";
import type { DeviceProfileDocument } from "./profile-validation";

export type ProfileDraftStatus = 'DRAFT' | 'CLIENT_REVIEW' | 'CLIENT_REVIEW_ACCEPTED' | 'DEVELOPMENT_PUBLISHED' | 'HARDWARE_VERIFIED' | 'PRODUCTION_FROZEN' | 'REJECTED' | 'SUPERSEDED';

/**
 * Immutable states that indicate a version has been published to the
 * DEVELOPMENT channel (or promoted beyond it). Only versions in one of these
 * states are eligible sources for a Firmware Integration Package export: their
 * `document` snapshot is immutable and traceable, unlike the mutable working
 * draft. HARDWARE_VERIFIED and PRODUCTION_FROZEN are supersets of a published
 * development artifact, so they remain valid governed sources.
 */
export const DEVELOPMENT_PUBLISHED_STATES: ProfileDraftStatus[] = [
  'DEVELOPMENT_PUBLISHED',
  'HARDWARE_VERIFIED',
  'PRODUCTION_FROZEN',
];

export function isPublishedToDevelopment(version: Pick<ImmutableProfileVersion, 'state'>): boolean {
  return DEVELOPMENT_PUBLISHED_STATES.includes(version.state);
}

export interface ImmutableProfileVersion {
  id: number;
  profileId: number;
  versionNumber: number;
  document: DeviceProfileDocument;
  state: ProfileDraftStatus;
  createdAt: string;
  createdBy: number;
  digest: string;
  provenance?: Record<string, unknown>;
}

export interface ProfileDraft {
  id: number;
  profileId: number;
  document: DeviceProfileDocument;
  revision: number;
  updatedAt: string;
  updatedBy: number;
}

export interface ReviewComment {
  id: number;
  reviewId: number;
  authorId: number;
  authorUsername: string;
  authorRole: string;
  body: string;
  target?: string;
  createdAt: string;
}

export type ReviewDecisionStatus = 'ACCEPTED' | 'CHANGES_REQUESTED';

export interface ReviewDecision {
  id: number;
  reviewId: number;
  actorId: number;
  actorUsername: string;
  actorRole: string;
  decision: ReviewDecisionStatus;
  rationale: string | null;
  decidedAt: string;
}

export interface Review {
  id: number;
  profileId: number;
  versionId: number;
  digest: string;
  state: 'OPEN' | 'DECIDED';
  snapshot: DeviceProfileDocument;
  submittedAt: string;
  submittedBy: number;
}

export interface ProfilePublication {
  id: number;
  profileId: number;
  versionId: number;
  channel: 'DEVELOPMENT' | 'PRODUCTION';
  digest: string;
  active: boolean;
  publishedAt: string;
  supersededAt?: string | null;
}

export interface ProfileAuditEntry {
  id: number;
  profileId: number;
  versionId?: number | null;
  action: string;
  actorUsername?: string | null;
  actorRole: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface GovernedProfile {
  id: number;
  key: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSummary {
  fieldCount: number;
  mappedFieldCount: number;
  mappingComplete: boolean;
  partial: boolean;
  limitations: string[];
  simulation?: { passed: boolean; evidence: Record<string, unknown> } | null;
  hardware?: { passed: boolean; evidence: Record<string, unknown> } | null;
  [key: string]: unknown;
}

export interface SandboxOverride {
  profileId: number;
  reviewerId: number;
  document: DeviceProfileDocument;
  updatedAt: string;
}

async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const bridge = getDesktopBridge();
    const method = options?.method ?? "GET";
    const response = bridge
      ? await bridge.authRequest(
          url,
          method,
          typeof options?.body === "string" ? options.body : undefined,
        )
      : await fetch(url, {
          credentials: "include",
          headers: { "Content-Type": "application/json", ...options?.headers },
          ...options,
        }).then(async (res) => ({
          status: res.status,
          body: await res.json().catch(() => ({})),
        }));
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, data: response.body as T };
    }
    return {
      ok: false,
      error: (response.body as { error?: string }).error ?? "Request failed",
      status: response.status,
    };
  } catch {
    return { ok: false, error: "Network error", status: 0 };
  }
}

async function getPrimaryProfileId(document?: DeviceProfileDocument): Promise<number> {
  const res = await apiFetch<GovernedProfile[]>("/api/profiles");
  if (!res.ok) throw new Error(res.error);
  if (res.ok && res.data.length > 0) {
    return res.data[0].id;
  }
  if (!document) throw new Error("No governed Device Profile exists yet");
  const createRes = await apiFetch<GovernedProfile>("/api/profiles", {
    method: "POST",
    body: JSON.stringify({
      key: `${document.hardwareFamily}-${document.profileVersion}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: document.displayName ?? `${document.hardwareFamily} Device Profile`,
      description: "Migrated from the Console working profile",
      document,
    }),
  });
  if (!createRes.ok) throw new Error(createRes.error);
  return createRes.data.id;
}

export const governanceApi = {
  getPrimaryProfileId,
  listProfiles: () => apiFetch<GovernedProfile[]>("/api/profiles"),
  
  // Drafts
  getDraft: (id: number) => apiFetch<ProfileDraft>(`/api/profiles/${id}/draft`),
  saveDraft: (id: number, document: DeviceProfileDocument, expectedRevision?: number) =>
    apiFetch<ProfileDraft>(`/api/profiles/${id}/draft`, {
      method: "PUT",
      body: JSON.stringify({ document, expectedRevision }),
    }),
  
  submitForReview: (id: number, expectedRevision: number) =>
    apiFetch<any>(`/api/profiles/${id}/submit`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision }),
    }),

  // Reviews & Decisions
  listReviews: (id: number) => apiFetch<Review[]>(`/api/profiles/${id}/reviews`),
  getReview: (reviewId: number) => apiFetch<{ review: Review, comments: ReviewComment[], decisions: ReviewDecision[], summary: any }>(`/api/profiles/reviews/${reviewId}`),
  addComment: (reviewId: number, body: string, target?: string) =>
    apiFetch<ReviewComment>(`/api/profiles/reviews/${reviewId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, target }),
    }),
  submitDecision: (reviewId: number, decision: ReviewDecisionStatus, rationale?: string) =>
    apiFetch<ReviewDecision>(`/api/profiles/reviews/${reviewId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, rationale }),
    }),

  // Versions / History
  listVersions: (id: number) => apiFetch<ImmutableProfileVersion[]>(`/api/profiles/${id}/versions`),
  getVersion: (versionId: number) => apiFetch<{ version: ImmutableProfileVersion, summary: ProfileSummary }>(`/api/profiles/versions/${versionId}`),
  listValidations: (versionId: number) => apiFetch<any[]>(`/api/profiles/versions/${versionId}/validations`),
  
  // Diff
  getDiff: (fromId: number, toId: number) => apiFetch<any>(`/api/profiles/diff?from=${fromId}&to=${toId}`),

  // Lifecycle
  publishDevelopment: (versionId: number) => apiFetch<any>(`/api/profiles/versions/${versionId}/publish`, { method: "POST" }),
  rollbackDevelopment: (id: number, targetVersionId: number) => apiFetch<any>(`/api/profiles/${id}/rollback`, { method: "POST", body: JSON.stringify({ targetVersionId }) }),
  recordSimulation: (versionId: number, passed: boolean, evidence: Record<string, unknown>, reviewId?: number) =>
    apiFetch<any>(`/api/profiles/versions/${versionId}/simulation`, { method: "POST", body: JSON.stringify({ passed, evidence, reviewId }) }),
  recordHardwareVerification: (versionId: number, passed: boolean, evidence: Record<string, unknown>) =>
    apiFetch<any>(`/api/profiles/versions/${versionId}/verify-hardware`, { method: "POST", body: JSON.stringify({ passed, evidence }) }),
  promoteProduction: (versionId: number) => apiFetch<any>(`/api/profiles/versions/${versionId}/promote`, { method: "POST" }),

  // Logs & Sandbox
  listPublications: (id: number) => apiFetch<ProfilePublication[]>(`/api/profiles/${id}/publications`),
  listAudit: (id: number) => apiFetch<ProfileAuditEntry[]>(`/api/profiles/${id}/audit`),

  getSandbox: (id: number, reviewId: number) => apiFetch<SandboxOverride | null>(`/api/profiles/${id}/sandbox?reviewId=${reviewId}`),
  saveSandbox: (id: number, reviewId: number, document: DeviceProfileDocument) => apiFetch<SandboxOverride>(`/api/profiles/${id}/sandbox`, { method: "PUT", body: JSON.stringify({ reviewId, document }) }),
  resetSandbox: (id: number) => apiFetch<any>(`/api/profiles/${id}/sandbox`, { method: "DELETE" }),
};
