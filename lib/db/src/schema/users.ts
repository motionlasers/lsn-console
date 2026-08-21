import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Canonical governance roles.
 *
 * Migration compatibility from the legacy binary `isAdmin` model:
 * - existing admins (isAdmin = true)  -> SUPERADMIN
 * - existing non-admins               -> CLIENT_REVIEWER
 * - FIRMWARE_ADMIN is only ever assigned explicitly via superadmin user management.
 */
export const ROLES = ["SUPERADMIN", "FIRMWARE_ADMIN", "CLIENT_REVIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const roleSchema = z.enum(ROLES);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /**
   * Legacy flag retained for backwards compatibility with existing sessions,
   * clients, and the seed/migration path. `role` is the canonical source of
   * truth; `isAdmin` is kept in sync (true iff role === "SUPERADMIN").
   */
  isAdmin: boolean("is_admin").notNull().default(false),
  role: text("role").notNull().default("CLIENT_REVIEWER"),
  forcePasswordChange: boolean("force_password_change").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
