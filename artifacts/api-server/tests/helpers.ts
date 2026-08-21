import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { Role } from "@workspace/db/schema";
import request from "supertest";
import type { Express } from "express";

export const TEST_PASSWORD = "test-password-123";

/** Create (or reset) a user with a known password + explicit canonical role. */
export async function ensureUser(username: string, role: Role): Promise<number> {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  await db.delete(usersTable).where(eq(usersTable.username, username));
  const [u] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash,
      role,
      isAdmin: role === "SUPERADMIN",
      forcePasswordChange: false,
    })
    .returning({ id: usersTable.id });
  return u.id;
}

export async function deleteUser(username: string): Promise<void> {
  await db.delete(usersTable).where(eq(usersTable.username, username));
}

/** Log in via the API and return an agent that carries the session cookie. */
export async function loginAgent(
  app: Express,
  username: string,
): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .send({ username, password: TEST_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}
