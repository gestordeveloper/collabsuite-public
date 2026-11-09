import { Router } from "express";
import * as healthController from "../controllers/health.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { publicCommentLimiter } from "../middleware/rateLimit.middleware";
import {
  healthDaySchema, healthWaterSchema, healthWorkoutSchema, healthGoalsSchema, healthIngestSchema,
} from "../validations/schemas";

const router = Router();

// Importação por token (sem login) — antes das rotas autenticadas.
router.post("/ingest", publicCommentLimiter, validate(healthIngestSchema), healthController.ingest);

router.get("/", requireAuth, healthController.overview);
router.get("/measures", requireAuth, healthController.measures);
router.put("/day/:date", requireAuth, validate(healthDaySchema), healthController.saveDay);
router.post("/day/:date/water", requireAuth, validate(healthWaterSchema), healthController.addWater);
router.post("/workouts", requireAuth, validate(healthWorkoutSchema), healthController.addWorkout);
router.delete("/workouts/:id", requireAuth, healthController.deleteWorkout);
router.put("/goals", requireAuth, validate(healthGoalsSchema), healthController.setGoals);
router.post("/sync-token", requireAuth, healthController.createSyncToken);
router.delete("/sync-token", requireAuth, healthController.revokeSyncToken);

export default router;
