import { Router } from "express";
import * as activityController from "../controllers/activity.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createActivitySchema } from "../validations/schemas";

const router = Router();

router.post("/:id/activities", requireAuth, validate(createActivitySchema), activityController.addActivity);

export default router;