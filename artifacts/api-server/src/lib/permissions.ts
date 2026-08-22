import type { Role } from "@workspace/db/schema";

const ROLES = ["SUPERADMIN", "FIRMWARE_ADMIN", "CLIENT_REVIEWER"] as const;

/**
 * Centralized, server-side permission model for the three canonical governance
 * roles. This is the single source of truth used by route middleware; the
 * frontend mirrors these for navigation/controls but never for enforcement.
 */
export type Permission =
  // User / security governance (Superadmin only)
  | "user.manage"
  | "security.manage"
  // Draft authoring / engineering (Firmware Admin)
  | "profile.create"
  | "draft.edit"
  | "simulation.run"
  | "review.submit"
  | "review.respond"
  | "development.publish"
  | "development.rollback"
  | "hardware.record"
  // Client review (Client Reviewer)
  | "review.inspect"
  | "review.comment"
  | "review.decide"
  | "sandbox.use"
  // Author/engineering history reads (Firmware Admin + Superadmin). Covers the
  // mutable draft, version history/artifacts, publication history, validation
  // history, and unrestricted artifact download. NOT granted to reviewers.
  | "history.read"
  // Append-only governance audit read (Superadmin only — governance UI).
  | "audit.read"
  // Superadmin-exclusive promotion authority
  | "production.promote";

const SUPERADMIN: Permission[] = [
  "user.manage",
  "security.manage",
  "profile.create",
  "draft.edit",
  "simulation.run",
  "review.submit",
  "review.respond",
  "development.publish",
  "development.rollback",
  "hardware.record",
  "review.inspect",
  "review.comment",
  "review.decide",
  "sandbox.use",
  "history.read",
  "audit.read",
  "production.promote",
];

const FIRMWARE_ADMIN: Permission[] = [
  "profile.create",
  "draft.edit",
  "simulation.run",
  "review.submit",
  "review.respond",
  "development.publish",
  "development.rollback",
  "hardware.record",
  "review.inspect",
  "history.read",
];

const CLIENT_REVIEWER: Permission[] = [
  "review.inspect",
  "review.comment",
  "review.decide",
  "simulation.run",
  "sandbox.use",
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPERADMIN,
  FIRMWARE_ADMIN,
  CLIENT_REVIEWER,
};

/** Normalize any stored/legacy role string to a canonical Role. */
export function normalizeRole(raw: string | null | undefined, isAdmin: boolean): Role {
  if (raw && (ROLES as readonly string[]).includes(raw)) {
    return raw as Role;
  }
  // Legacy migration fallback: admins -> SUPERADMIN, others -> CLIENT_REVIEWER.
  return isAdmin ? "SUPERADMIN" : "CLIENT_REVIEWER";
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function isSuperadmin(role: Role): boolean {
  return role === "SUPERADMIN";
}
