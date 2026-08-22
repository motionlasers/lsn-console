import { Router, type IRouter } from "express";
import { requireAuth, requirePasswordChanged } from "../middleware/require-auth.js";
import {
  recordActivityStrict,
  actorFromSession,
  isClientEventName,
  filterClientDetail,
  boundTargetDescriptor,
  isAdminRole,
  AdminActivityDuplicateError,
} from "../lib/activity-service.js";

/**
 * Client-facing activity endpoints.
 *
 *   POST /api/activity/events
 *     Authenticated SUPERADMIN / FIRMWARE_ADMIN client events. Strict event
 *     allowlist (PAGE_VISIT, SETTING_CHANGED, DESKTOP_ACTION), a required
 *     clientEventId for idempotency, and strictly allowlisted, bounded
 *     metadata. CLIENT_REVIEWER is rejected. Actor is server-derived.
 *
 *   GET /api/activity/download/:asset
 *     Authenticated SUPERADMIN / FIRMWARE_ADMIN. Asset allowlist
 *     installer|portable|checksums. Records DOWNLOAD_REQUESTED then 302s to the
 *     exact pinned GitHub release asset URL. No user-controlled URL.
 */
const router: IRouter = Router();

router.use(requireAuth, requirePasswordChanged);

/**
 * Exact, pinned GitHub release asset URLs (repo motionlasers/lsn-console, tag
 * lsn-console-v0.3.0). These are the ONLY URLs the download endpoint may
 * redirect to; the incoming `:asset` param selects one by key and never
 * contributes to the URL.
 */
const RELEASE_TAG = "lsn-console-v0.3.0";
const RELEASE_BASE =
  "https://github.com/motionlasers/lsn-console/releases/download";
const DOWNLOAD_ASSETS: Record<string, string> = {
  installer: `${RELEASE_BASE}/${RELEASE_TAG}/LSN-Engineering-Console-Setup-0.3.0-dev.exe`,
  portable: `${RELEASE_BASE}/${RELEASE_TAG}/LSN-Engineering-Console-Portable-0.3.0.zip`,
  checksums: `${RELEASE_BASE}/${RELEASE_TAG}/SHA256SUMS.txt`,
};

// POST /api/activity/events — authenticated admin/Firmware Admin client events.
router.post("/events", async (req, res): Promise<void> => {
  const su = req.sessionUser!;
  // Reject CLIENT_REVIEWER (only admin roles may emit client events).
  if (!isAdminRole(su.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Assigned contract shape:
  //   { eventName, clientEventId, targetType?, targetId?, targetLabel?, detail? }
  const { eventName, clientEventId, targetType, targetId, targetLabel, detail } =
    req.body ?? {};
  if (!isClientEventName(eventName)) {
    res.status(400).json({ error: "Unknown or unsupported eventName" });
    return;
  }
  const clientEventIdPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    typeof clientEventId !== "string" ||
    !clientEventIdPattern.test(clientEventId)
  ) {
    res.status(400).json({ error: "clientEventId must be a UUID" });
    return;
  }
  if (targetType !== undefined && typeof targetType !== "string") {
    res.status(400).json({ error: "targetType must be a string" });
    return;
  }
  if (targetLabel !== undefined && typeof targetLabel !== "string") {
    res.status(400).json({ error: "targetLabel must be a string" });
    return;
  }

  // Strict-filter detail to the per-event allowlist; bound target descriptors.
  const safeDetail = filterClientDetail(eventName, detail);
  const safeTargetType = boundTargetDescriptor(targetType);
  const safeTargetId = boundTargetDescriptor(targetId);
  let safeTargetLabel = boundTargetDescriptor(targetLabel);
  const targetPattern = /^[A-Za-z0-9_./:-]{1,160}$/;
  if (
    !safeTargetType ||
    !safeTargetId ||
    !targetPattern.test(safeTargetType) ||
    !targetPattern.test(safeTargetId) ||
    (safeTargetLabel !== null && !targetPattern.test(safeTargetLabel))
  ) {
    res.status(400).json({ error: "Invalid target descriptor" });
    return;
  }
  const allowedTargetTypes: Record<typeof eventName, readonly string[]> = {
    PAGE_VISIT: ["ROUTE"],
    SETTING_CHANGED: ["SETTING", "LOGICAL_STATE"],
    DESKTOP_ACTION: ["PROFILE_UPDATE", "PACKAGE_GENERATION", "DOWNLOAD"],
  };
  if (!allowedTargetTypes[eventName].includes(safeTargetType)) {
    res.status(400).json({ error: "Unsupported target type" });
    return;
  }
  // Client-provided labels never add arbitrary content beyond the validated ID.
  safeTargetLabel = safeTargetId;
  const activityOutcome =
    eventName === "DESKTOP_ACTION" && safeDetail.result === "failure"
      ? "FAILURE"
      : "SUCCESS";

  try {
    await recordActivityStrict({
      actor: actorFromSession(su),
      category: "CLIENT_EVENT",
      action: eventName,
      outcome: activityOutcome,
      targetType: safeTargetType,
      targetId: safeTargetId,
      targetLabel: safeTargetLabel,
      detail: safeDetail,
      requestId: req.id ? String(req.id) : null,
      clientEventId,
    });
  } catch (err) {
    if (err instanceof AdminActivityDuplicateError) {
      // Idempotent: the event was already recorded.
      res.status(200).json({ ok: true, deduplicated: true });
      return;
    }
    req.log.error({ eventName }, "Failed to record client event");
    res.status(500).json({ error: "Failed to record event" });
    return;
  }

  res.status(201).json({ ok: true });
});

// GET /api/activity/download/:asset — record then 302 to a pinned release URL.
router.get("/download/:asset", async (req, res): Promise<void> => {
  const su = req.sessionUser!;
  if (!isAdminRole(su.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const raw = Array.isArray(req.params.asset) ? req.params.asset[0] : req.params.asset;
  const url = Object.prototype.hasOwnProperty.call(DOWNLOAD_ASSETS, raw)
    ? DOWNLOAD_ASSETS[raw]
    : undefined;
  if (!url) {
    res.status(404).json({ error: "Unknown asset" });
    return;
  }

  try {
    await recordActivityStrict({
      actor: actorFromSession(su),
      category: "DOWNLOAD",
      action: "DOWNLOAD_REQUESTED",
      outcome: "SUCCESS",
      targetType: "release_asset",
      targetId: raw,
      targetLabel: RELEASE_TAG,
      detail: { asset: raw, releaseTag: RELEASE_TAG },
      requestId: req.id ? String(req.id) : null,
    });
  } catch (err) {
    req.log.error({ asset: raw }, "Failed to record download request");
    res.status(500).json({ error: "Failed to record download" });
    return;
  }

  res.redirect(302, url);
});

export default router;
