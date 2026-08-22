import { Router, type IRouter, type Request, type Response } from "express";
import {
  requireAuth,
  requirePasswordChanged,
  requireAnyPermission,
  requirePermission,
} from "../middleware/require-auth.js";
import type { Actor } from "../lib/profile-service.js";
import {
  createProfile,
  saveDraft,
  submitForReview,
  addComment,
  decideReview,
  publishDevelopment,
  rollbackDevelopment,
  recordHardwareVerification,
  recordSimulation,
  promoteProduction,
  saveSandbox,
  resetSandbox,
  getSandbox,
  listProfiles,
  getProfile,
  getDraft,
  listVersions,
  getVersion,
  getReview,
  listReviews,
  listComments,
  listDecisions,
  getActivePublication,
  listPublications,
  listReviewVisibleVersions,
  listValidations,
  listAudit,
  isVersionReviewVisible,
  RevisionConflictError,
  InvariantError,
} from "../lib/profile-service.js";
import { roleHasPermission } from "../lib/permissions.js";
import { diffProfiles, canonicalString, digestOf } from "../lib/profile-canonical.js";
import { summarizeProfile } from "../lib/profile-summary.js";

const router: IRouter = Router();

// All profile routes require a valid, password-changed session.
router.use(requireAuth, requirePasswordChanged);

function actorOf(req: Request): Actor {
  const su = req.sessionUser!;
  return { userId: su.userId, username: su.username, role: su.role };
}

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return Number(v);
}

/**
 * True when the session role has the author/history read grant (Firmware Admin
 * and Superadmin). Reviewers lack this and are restricted to review/public
 * resources, decided from DB records (see isVersionReviewVisible).
 */
function canReadHistory(req: Request): boolean {
  const su = req.sessionUser;
  return !!su && roleHasPermission(su.role, "history.read");
}

/**
 * Guard a single-version read (artifact / validations / download). History
 * readers pass unconditionally; reviewers are limited to versions that are
 * review- or publication-visible per DB records. Invalid ids fail safely with
 * a 400 so nothing leaks. Returns true when the caller may proceed; otherwise
 * writes the response and returns false.
 */
async function guardVersionRead(req: Request, res: Response, versionId: number): Promise<boolean> {
  if (!Number.isFinite(versionId)) {
    res.status(400).json({ error: "Invalid version id" });
    return false;
  }
  if (canReadHistory(req)) return true;
  if (await isVersionReviewVisible(versionId)) return true;
  res.status(403).json({ error: "Forbidden" });
  return false;
}

/** Centralized error mapping for service invariants. */
function handleServiceError(req: Request, res: Response, err: unknown): void {
  if (err instanceof RevisionConflictError) {
    res.status(409).json({ error: "Draft was modified by someone else; reload and retry" });
    return;
  }
  if (err instanceof InvariantError) {
    res.status(409).json({ error: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : "Internal error";
  if (/not found/i.test(msg)) {
    res.status(404).json({ error: msg });
    return;
  }
  req.log.error({ err }, "Profile service error");
  res.status(500).json({ error: "Internal error" });
}

// ===========================================================================
// IMPORTANT: literal-prefixed routes (/versions, /reviews, /diff) MUST be
// declared BEFORE the "/:id" parameterized routes so Express 5 does not
// capture e.g. "diff" or "versions" as an ":id". Do not reorder.
// ===========================================================================

// ---------------------------------------------------------------------------
// Versions / diffs / downloads (literal "versions" prefix)
// ---------------------------------------------------------------------------

// GET /api/profiles/versions/:versionId — a single version
router.get("/versions/:versionId", async (req, res): Promise<void> => {
  const versionId = parseId(req.params.versionId);
  if (!(await guardVersionRead(req, res, versionId))) return;
  const v = await getVersion(versionId);
  if (!v) {
    res.status(404).json({ error: "Version not found" });
    return;
  }
  res.json({ version: v, summary: summarizeProfile(v.document) });
});

// GET /api/profiles/versions/:versionId/validations
// Validation history (hardware/simulation evidence) is an author/history read:
// only history readers may access it. Reviewers are denied.
router.get("/versions/:versionId/validations", requirePermission("history.read"), async (req, res): Promise<void> => {
  const versionId = parseId(req.params.versionId);
  if (!Number.isFinite(versionId)) {
    res.status(400).json({ error: "Invalid version id" });
    return;
  }
  res.json(await listValidations(versionId));
});

// GET /api/profiles/versions/:versionId/download — digest-addressed download
// of the canonical immutable artifact. Comes from the selected version only.
router.get("/versions/:versionId/download", async (req, res): Promise<void> => {
  const versionId = parseId(req.params.versionId);
  if (!(await guardVersionRead(req, res, versionId))) return;
  const v = await getVersion(versionId);
  if (!v) {
    res.status(404).json({ error: "Version not found" });
    return;
  }
  // Verify the stored digest matches the canonical document (integrity check).
  const recomputed = digestOf(v.document);
  if (recomputed !== v.digest) {
    req.log.error({ versionId, stored: v.digest, recomputed }, "Digest mismatch on download");
    res.status(500).json({ error: "Artifact integrity check failed" });
    return;
  }
  const artifact = {
    schema: "https://lsn.local/schemas/device-profile.schema.json",
    profileId: v.profileId,
    versionId: v.id,
    versionNumber: v.versionNumber,
    state: v.state,
    digest: v.digest,
    provenance: v.provenance,
    document: v.document,
  };
  const body = canonicalString(artifact);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("ETag", `"${v.digest}"`);
  res.setHeader("X-Profile-Digest", v.digest);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="profile-${v.profileId}-v${v.versionNumber}-${v.digest.slice(0, 12)}.json"`,
  );
  res.send(body);
});

// POST /api/profiles/versions/:versionId/publish — Development (Firmware Admin)
router.post("/versions/:versionId/publish", requirePermission("development.publish"), async (req, res): Promise<void> => {
  const versionId = parseId(req.params.versionId);
  try {
    const result = await publishDevelopment(actorOf(req), versionId);
    res.status(201).json(result);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// POST /api/profiles/versions/:versionId/verify-hardware — (Firmware Admin)
router.post("/versions/:versionId/verify-hardware", requirePermission("hardware.record"), async (req, res): Promise<void> => {
  const versionId = parseId(req.params.versionId);
  const { passed, evidence } = req.body ?? {};
  if (typeof passed !== "boolean") {
    res.status(400).json({ error: "passed (boolean) required" });
    return;
  }
  try {
    const rec = await recordHardwareVerification(
      actorOf(req),
      versionId,
      passed,
      evidence && typeof evidence === "object" ? evidence : {},
    );
    res.status(201).json(rec);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// POST /api/profiles/versions/:versionId/simulation — record simulation evidence
router.post("/versions/:versionId/simulation", requirePermission("simulation.run"), async (req, res): Promise<void> => {
  const versionId = parseId(req.params.versionId);
  const { passed, evidence, reviewId } = req.body ?? {};
  if (typeof passed !== "boolean") {
    res.status(400).json({ error: "passed (boolean) required" });
    return;
  }
  try {
    const rec = await recordSimulation(
      actorOf(req),
      versionId,
      passed,
      evidence && typeof evidence === "object" ? evidence : {},
      typeof reviewId === "number" ? reviewId : undefined,
    );
    res.status(201).json(rec);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// POST /api/profiles/versions/:versionId/promote — Production/Frozen (Superadmin only)
router.post("/versions/:versionId/promote", requirePermission("production.promote"), async (req, res): Promise<void> => {
  const versionId = parseId(req.params.versionId);
  try {
    const pub = await promoteProduction(actorOf(req), versionId);
    res.status(201).json(pub);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// GET /api/profiles/diff?from=<versionId|draft:profileId>&to=<...>
router.get("/diff", async (req, res): Promise<void> => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const historyReader = canReadHistory(req);

  // Resolve a diff operand. Returns the document, or a sentinel:
  //  - null     => not found (404)
  //  - "denied" => operand exists but the caller may not read it (403)
  const DENIED = Symbol("denied");
  async function resolveDoc(ref: string): Promise<unknown | typeof DENIED | null> {
    if (ref.startsWith("draft:")) {
      // Mutable drafts are author-only. Reviewers may never diff a draft.
      if (!historyReader) return DENIED;
      const draftId = Number(ref.slice("draft:".length));
      if (!Number.isFinite(draftId)) return null;
      const d = await getDraft(draftId);
      return d ? d.document : null;
    }
    const versionId = Number(ref);
    if (!Number.isFinite(versionId)) return null;
    const v = await getVersion(versionId);
    if (!v) return null;
    // Reviewers may only diff review/public-visible versions (DB-decided).
    if (!historyReader && !(await isVersionReviewVisible(versionId))) return DENIED;
    return v.document;
  }

  const [a, b] = await Promise.all([resolveDoc(from), resolveDoc(to)]);
  if (a === DENIED || b === DENIED) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (a == null || b == null) {
    res.status(404).json({ error: "One or both diff operands not found" });
    return;
  }
  res.json(diffProfiles(a, b));
});

// ---------------------------------------------------------------------------
// Review lifecycle (literal "reviews" prefix)
// ---------------------------------------------------------------------------

// GET /api/profiles/reviews/:reviewId — a review with snapshot + comments + decisions
router.get("/reviews/:reviewId", requirePermission("review.inspect"), async (req, res): Promise<void> => {
  const reviewId = parseId(req.params.reviewId);
  const review = await getReview(reviewId);
  if (!review) {
    res.status(404).json({ error: "Review not found" });
    return;
  }
  const [comments, decisions] = await Promise.all([
    listComments(reviewId),
    listDecisions(reviewId),
  ]);
  res.json({ review, comments, decisions, summary: summarizeProfile(review.snapshot) });
});

// POST /api/profiles/reviews/:reviewId/comments — comment
router.post("/reviews/:reviewId/comments", requireAnyPermission("review.comment", "review.respond"), async (req, res): Promise<void> => {
  const reviewId = parseId(req.params.reviewId);
  const { body, target } = req.body ?? {};
  if (typeof body !== "string" || body.trim().length === 0) {
    res.status(400).json({ error: "body required" });
    return;
  }
  try {
    const comment = await addComment(actorOf(req), reviewId, body, typeof target === "string" ? target : undefined);
    res.status(201).json(comment);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// POST /api/profiles/reviews/:reviewId/decision — accept / request changes
router.post("/reviews/:reviewId/decision", requirePermission("review.decide"), async (req, res): Promise<void> => {
  const reviewId = parseId(req.params.reviewId);
  const { decision, rationale } = req.body ?? {};
  if (decision !== "ACCEPTED" && decision !== "CHANGES_REQUESTED") {
    res.status(400).json({ error: "decision must be ACCEPTED or CHANGES_REQUESTED" });
    return;
  }
  try {
    const rec = await decideReview(
      actorOf(req),
      reviewId,
      decision,
      typeof rationale === "string" ? rationale : "",
    );
    res.status(201).json(rec);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Profiles + drafts (root + "/:id")
// ---------------------------------------------------------------------------

// GET /api/profiles — list all profiles
router.get("/", async (_req, res): Promise<void> => {
  res.json(await listProfiles());
});

// POST /api/profiles — create a profile (Firmware Admin / Superadmin)
router.post("/", requirePermission("profile.create"), async (req, res): Promise<void> => {
  const { key, name, description, document } = req.body ?? {};
  if (typeof key !== "string" || key.trim().length < 2 || typeof name !== "string" || name.trim().length < 1) {
    res.status(400).json({ error: "key (min 2 chars) and name required" });
    return;
  }
  try {
    const profile = await createProfile(actorOf(req), {
      key: key.trim(),
      name: name.trim(),
      description: typeof description === "string" ? description : "",
      document,
    });
    res.status(201).json(profile);
  } catch (err) {
    if (err instanceof Error && err.message.includes("unique")) {
      res.status(409).json({ error: "Profile key already exists" });
      return;
    }
    handleServiceError(req, res, err);
  }
});

// GET /api/profiles/:id — profile with draft + active publications
router.get("/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }
  const profile = await getProfile(id);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const [draft, development, production] = await Promise.all([
    getDraft(id),
    getActivePublication(id, "DEVELOPMENT"),
    getActivePublication(id, "PRODUCTION"),
  ]);
  // The mutable working draft is author-only. Reviewers still receive the
  // profile metadata and the client-facing (published) channels needed by the
  // review UI, but never the in-progress draft document.
  const draftForCaller = canReadHistory(req) ? draft : null;
  res.json({ profile, draft: draftForCaller, development, production });
});

// GET /api/profiles/:id/draft — the mutable working draft is author-only.
router.get("/:id/draft", requirePermission("history.read"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }
  const draft = await getDraft(id);
  if (!draft) {
    res.status(404).json({ error: "Draft not found" });
    return;
  }
  res.json(draft);
});

// PUT /api/profiles/:id/draft — save working draft (Firmware Admin)
router.put("/:id/draft", requirePermission("draft.edit"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { document, expectedRevision } = req.body ?? {};
  if (document == null || typeof document !== "object") {
    res.status(400).json({ error: "document (object) required" });
    return;
  }
  try {
    const updated = await saveDraft(
      actorOf(req),
      id,
      document,
      typeof expectedRevision === "number" ? expectedRevision : undefined,
    );
    res.json(updated);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// POST /api/profiles/:id/submit — submit draft for client review (Firmware Admin)
router.post("/:id/submit", requirePermission("review.submit"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { expectedRevision } = req.body ?? {};
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    res.status(400).json({ error: "expectedRevision (non-negative integer) required" });
    return;
  }
  try {
    const result = await submitForReview(actorOf(req), id, expectedRevision);
    res.status(201).json(result);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// GET /api/profiles/:id/reviews — list reviews for a profile
router.get("/:id/reviews", requirePermission("review.inspect"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  res.json(await listReviews(id));
});

// POST /api/profiles/:id/rollback — roll back Development to a prior version (Firmware Admin)
router.post("/:id/rollback", requirePermission("development.rollback"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const targetVersionId = Number(req.body?.targetVersionId);
  if (!Number.isFinite(targetVersionId)) {
    res.status(400).json({ error: "targetVersionId required" });
    return;
  }
  try {
    const pub = await rollbackDevelopment(actorOf(req), id, targetVersionId);
    res.json(pub);
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// GET /api/profiles/:id/versions — version history. History readers see the
// full history; reviewers receive only review/public-visible versions (needed
// by the review UI to locate the prior version for a diff), decided from DB.
router.get("/:id/versions", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }
  const versions = canReadHistory(req)
    ? await listVersions(id)
    : await listReviewVisibleVersions(id);
  res.json(versions);
});

// GET /api/profiles/:id/publications — publication history (author/history read).
router.get("/:id/publications", requirePermission("history.read"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }
  res.json(await listPublications(id));
});

// GET /api/profiles/:id/audit — append-only audit history. Superadmin-only
// (governance UI); Firmware Admin and reviewers are denied.
router.get("/:id/audit", requirePermission("audit.read"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }
  res.json(await listAudit(id));
});

// ---------------------------------------------------------------------------
// Client sandbox (private, per-user, resettable)
// ---------------------------------------------------------------------------

// GET /api/profiles/:id/sandbox
router.get("/:id/sandbox", requirePermission("sandbox.use"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const reviewId = Number(req.query.reviewId);
  try {
    res.json(await getSandbox(actorOf(req), id, reviewId));
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// PUT /api/profiles/:id/sandbox
router.put("/:id/sandbox", requirePermission("sandbox.use"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { document, reviewId } = req.body ?? {};
  if (document == null || typeof document !== "object") {
    res.status(400).json({ error: "document (object) required" });
    return;
  }
  try {
    res.json(await saveSandbox(actorOf(req), id, Number(reviewId), document));
  } catch (err) {
    handleServiceError(req, res, err);
  }
});

// DELETE /api/profiles/:id/sandbox — reset
router.delete("/:id/sandbox", requirePermission("sandbox.use"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await resetSandbox(actorOf(req), id);
  res.json({ ok: true });
});

export default router;
