/**
 * Browser-test HTTP entrypoint that mounts the production profiles router.
 *
 * The session has already been resolved to CLIENT_REVIEWER by test setup, so
 * requireAuth skips only its database lookup in NODE_ENV=test. Every production
 * profile route and requirePermission middleware remains mounted unchanged.
 */
import express from "express";
import profilesRouter from "../src/routes/profiles.js";

const port = Number(process.env.PORT);
if (!Number.isFinite(port)) throw new Error("PORT is required");

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.sessionUser = {
    userId: 9001,
    username: "browser-reviewer",
    role: "CLIENT_REVIEWER",
    isAdmin: false,
    forcePasswordChange: false,
  };
  next();
});
app.get("/health", (_req, res) => {
  res.json({ ok: true, router: "api-server/src/routes/profiles.ts" });
});
app.use("/api/profiles", profilesRouter);

app.listen(port, "127.0.0.1", () => {
  console.log(`server-denial-entry:${port}`);
});
