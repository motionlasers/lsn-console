import app from "./app.js";
import { logger } from "./lib/logger.js";
import { seedAdminIfEmpty } from "./lib/seed.js";
import { migrateRolesIfNeeded } from "./lib/role-migrate.js";
import { ensureAdminActivityAppendOnly } from "./lib/activity-service.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await ensureAdminActivityAppendOnly();

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  await migrateRolesIfNeeded();
  await seedAdminIfEmpty();
});
