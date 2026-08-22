import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import adminRouter from "./admin.js";
import profilesRouter from "./profiles.js";
import desktopRouter from "./desktop.js";
import activityRouter from "./activity.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/profiles", profilesRouter);
router.use("/desktop", desktopRouter);
router.use("/activity", activityRouter);

export default router;
