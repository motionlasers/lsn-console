import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { count } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { logger } from "./logger.js";

function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function seedAdminIfEmpty(): Promise<void> {
  try {
    const [{ count: userCount }] = await db
      .select({ count: count() })
      .from(usersTable);

    if (Number(userCount) > 0) return;

    const initialPassword = generatePassword();
    const passwordHash = await bcrypt.hash(initialPassword, 12);

    await db.insert(usersTable).values({
      username: "admin",
      passwordHash,
      isAdmin: true,
      role: "SUPERADMIN",
      forcePasswordChange: true,
    });

    logger.info(
      {
        username: "admin",
        initialPassword,
      },
      "══════════════════════════════════════════════════\n" +
        "  LSN Console — initial admin account created\n" +
        "  Username : admin\n" +
        `  Password : ${initialPassword}\n` +
        "  ⚠  Change this password on first login!\n" +
        "══════════════════════════════════════════════════"
    );
  } catch (err) {
    logger.error({ err }, "Failed to seed admin user");
  }
}
