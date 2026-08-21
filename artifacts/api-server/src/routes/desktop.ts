import { Router, type IRouter } from "express";
import { requireAuth, requirePasswordChanged } from "../middleware/require-auth.js";
import {
  getActivePublication,
  getVersion,
  listProfiles,
} from "../lib/profile-service.js";
import { digestOf } from "../lib/profile-canonical.js";

/**
 * Fixed-origin, authenticated Development Profile channel consumed by the
 * Electron main process (electron/profile-update-service.cjs).
 *
 * Contract expected by the trust boundary:
 *   GET /api/desktop/profile-channel
 *     -> { available: false }                             when nothing published
 *     -> { available: true, profileVersion, digest,       when a Development
 *          artifactPath, firmwareVersion?, releaseName? }  publication is active
 *
 *   GET /api/desktop/profile-channel/artifact/:versionId
 *     -> the RAW canonical immutable device-profile document (application/json).
 *        `canonicalDigest(document)` MUST equal the manifest `digest`, and
 *        `document.profileVersion` MUST equal the manifest `profileVersion`.
 *
 * The artifactPath returned in the manifest is same-origin relative, so the
 * Electron origin check (artifact must resolve on the fixed API origin) passes.
 * Everything here is read-only sanitized delivery of an already-immutable,
 * digest-addressed version; the renderer/main independently re-verifies it.
 */
const router: IRouter = Router();

router.use(requireAuth, requirePasswordChanged);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// GET /api/desktop/profile-channel — active Development manifest (or none).
// Optional ?profileId=<id> selects a specific profile; otherwise the most
// recently updated profile that has an active Development publication is used.
router.get("/profile-channel", async (req, res): Promise<void> => {
  const requested = Number(req.query.profileId);

  let profileIds: number[];
  if (Number.isFinite(requested)) {
    profileIds = [requested];
  } else {
    const profiles = await listProfiles();
    profileIds = profiles.map((p) => p.id);
  }

  for (const pid of profileIds) {
    const pub = await getActivePublication(pid, "DEVELOPMENT");
    if (!pub) continue;
    const version = await getVersion(pub.versionId);
    if (!version) continue;

    const doc = isObj(version.document) ? version.document : {};
    const profileVersion =
      typeof doc["profileVersion"] === "string" ? (doc["profileVersion"] as string) : "";

    // Recompute digest over the raw document to guarantee manifest integrity.
    const digest = digestOf(version.document);

    const summary = isObj(pub.summary) ? pub.summary : {};
    const manifest: Record<string, unknown> = {
      available: true,
      profileId: version.profileId,
      versionId: version.id,
      profileVersion,
      digest,
      state: version.state,
      artifactPath: `/api/desktop/profile-channel/artifact/${version.id}`,
      releaseName: profileVersion,
      summary,
    };

    const firmware =
      isObj(version.provenance) && typeof version.provenance["firmwareVersion"] === "string"
        ? (version.provenance["firmwareVersion"] as string)
        : typeof doc["firmwareVersion"] === "string"
          ? (doc["firmwareVersion"] as string)
          : undefined;
    if (firmware) manifest.firmwareVersion = firmware;

    res.json(manifest);
    return;
  }

  res.json({ available: false });
});

// GET /api/desktop/profile-channel/artifact/:versionId — raw canonical document.
router.get("/profile-channel/artifact/:versionId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.versionId)
    ? req.params.versionId[0]
    : req.params.versionId;
  const versionId = Number(raw);
  if (!Number.isFinite(versionId)) {
    res.status(400).json({ error: "Invalid version id" });
    return;
  }

  const version = await getVersion(versionId);
  if (!version) {
    res.status(404).json({ error: "Version not found" });
    return;
  }

  // Integrity guard: only serve when the stored digest matches the document.
  const recomputed = digestOf(version.document);
  if (recomputed !== version.digest) {
    req.log.error(
      { versionId, stored: version.digest, recomputed },
      "Desktop artifact digest mismatch",
    );
    res.status(500).json({ error: "Artifact integrity check failed" });
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Profile-Digest", version.digest);
  // The Electron main process re-canonicalizes; we send the document as-is
  // (it is already stored canonicalized).
  res.json(version.document);
});

export default router;
