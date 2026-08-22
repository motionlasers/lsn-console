import { describe, it, expect } from "vitest";
import {
  normalizeRole,
  permissionsForRole,
  roleHasPermission,
  isSuperadmin,
} from "../src/lib/permissions.js";

describe("role normalization (migration compatibility)", () => {
  it("keeps canonical roles as-is", () => {
    expect(normalizeRole("SUPERADMIN", false)).toBe("SUPERADMIN");
    expect(normalizeRole("FIRMWARE_ADMIN", false)).toBe("FIRMWARE_ADMIN");
    expect(normalizeRole("CLIENT_REVIEWER", true)).toBe("CLIENT_REVIEWER");
  });

  it("migrates legacy admins to SUPERADMIN and others to CLIENT_REVIEWER", () => {
    expect(normalizeRole(null, true)).toBe("SUPERADMIN");
    expect(normalizeRole(null, false)).toBe("CLIENT_REVIEWER");
    expect(normalizeRole("garbage", true)).toBe("SUPERADMIN");
    expect(normalizeRole(undefined, false)).toBe("CLIENT_REVIEWER");
  });
});

describe("centralized permissions", () => {
  it("Superadmin has every permission incl. production promotion + user mgmt", () => {
    expect(roleHasPermission("SUPERADMIN", "production.promote")).toBe(true);
    expect(roleHasPermission("SUPERADMIN", "user.manage")).toBe(true);
    expect(roleHasPermission("SUPERADMIN", "development.publish")).toBe(true);
    expect(roleHasPermission("SUPERADMIN", "history.read")).toBe(true);
    expect(roleHasPermission("SUPERADMIN", "audit.read")).toBe(true);
    expect(isSuperadmin("SUPERADMIN")).toBe(true);
  });

  it("audit.read is Superadmin-only; history.read excludes reviewers", () => {
    expect(roleHasPermission("FIRMWARE_ADMIN", "history.read")).toBe(true);
    expect(roleHasPermission("FIRMWARE_ADMIN", "audit.read")).toBe(false);
    expect(roleHasPermission("CLIENT_REVIEWER", "history.read")).toBe(false);
    expect(roleHasPermission("CLIENT_REVIEWER", "audit.read")).toBe(false);
  });

  it("Firmware Admin can author/publish/rollback/verify but NOT promote or manage users", () => {
    for (const p of [
      "profile.create",
      "draft.edit",
      "review.submit",
      "review.respond",
      "development.publish",
      "development.rollback",
      "hardware.record",
    ] as const) {
      expect(roleHasPermission("FIRMWARE_ADMIN", p)).toBe(true);
    }
    expect(roleHasPermission("FIRMWARE_ADMIN", "production.promote")).toBe(false);
    expect(roleHasPermission("FIRMWARE_ADMIN", "user.manage")).toBe(false);
    expect(roleHasPermission("FIRMWARE_ADMIN", "review.decide")).toBe(false);
    expect(isSuperadmin("FIRMWARE_ADMIN")).toBe(false);
  });

  it("Client Reviewer can inspect/comment/decide/sandbox but NOT edit/publish", () => {
    for (const p of ["review.inspect", "review.comment", "review.decide", "sandbox.use", "simulation.run"] as const) {
      expect(roleHasPermission("CLIENT_REVIEWER", p)).toBe(true);
    }
    expect(roleHasPermission("CLIENT_REVIEWER", "draft.edit")).toBe(false);
    expect(roleHasPermission("CLIENT_REVIEWER", "development.publish")).toBe(false);
    expect(roleHasPermission("CLIENT_REVIEWER", "production.promote")).toBe(false);
    expect(roleHasPermission("CLIENT_REVIEWER", "history.read")).toBe(false);
    expect(roleHasPermission("CLIENT_REVIEWER", "audit.read")).toBe(false);
  });

  it("permissionsForRole returns a non-empty list for each role", () => {
    expect(permissionsForRole("SUPERADMIN").length).toBeGreaterThan(0);
    expect(permissionsForRole("FIRMWARE_ADMIN").length).toBeGreaterThan(0);
    expect(permissionsForRole("CLIENT_REVIEWER").length).toBeGreaterThan(0);
  });
});
