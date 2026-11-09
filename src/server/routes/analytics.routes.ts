import { Router } from "express";
import * as analyticsController from "../controllers/analytics.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/stats", requireAuth, analyticsController.getStats);
router.get("/burndown", requireAuth, analyticsController.getBurndown);
router.get("/ranking", requireAuth, analyticsController.getRanking);
router.get("/productivity", requireAuth, analyticsController.getProductivity);

export default router;
