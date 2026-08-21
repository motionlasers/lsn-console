import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Idempotent role backfill from the legacy binary `isAdmin` model.
 *
 * - Existing admins (isAdmin = true) with a non-canonical / default role become SUPERADMIN.
 * - Non-admins with a non-canonical / default role become CLIENT_REVIEWER.
 * - Users already explicitly assigned FIRMWARE_ADMIN (or any canonical role that
 *   matches their admin status) are left untouched.
 *
 * FIRMWARE_ADMIN is never assigned automatically; it is granted explicitly
 * through superadmin user management. This runs at startup and preserves live
 * DB state — it only corrects rows that are still inconsistent.
 */
export async function migrateRolesIfNeeded(): Promise<void> {
  try {
    // Legacy isAdmin is authoritative for the one-way admin backfill. When the
    // role column is first added, its database default makes every existing row
    // look like a canonical CLIENT_REVIEWER, so excluding canonical values here
    // would silently demote all existing administrators.
    const adminResult = await db
      .update(usersTable)
      .set({ role: "SUPERADMIN", isAdmin: true })
      .where(
        and(
          eq(usersTable.isAdmin, true),
          sql`${usersTable.role} <> 'SUPERADMIN'`,
        ),
      )
      .returning({ id: usersTable.id });

    // Non-admins whose role is not one of the valid non-admin roles.
    const reviewerResult = await db
      .update(usersTable)
      .set({ role: "CLIENT_REVIEWER", isAdmin: false })
      .where(
        and(
          eq(usersTable.isAdmin, false),
          sql`${usersTable.role} NOT IN ('CLIENT_REVIEWER', 'FIRMWARE_ADMIN')`,
        ),
      )
      .returning({ id: usersTable.id });

    const migrated = adminResult.length + reviewerResult.length;
    if (migrated > 0) {
      logger.info(
        { superadmins: adminResult.length, clientReviewers: reviewerResult.length },
        "Migrated legacy user roles to canonical governance roles",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to migrate user roles");
  }
}
