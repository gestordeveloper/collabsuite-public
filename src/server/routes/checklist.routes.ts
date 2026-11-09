import { Router } from "express";
import * as checklistController from "../controllers/checklist.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createChecklistSchema, updateChecklistSchema } from "../validations/schemas";

const router = Router();

router.get("/:id/checklist", requireAuth, checklistController.listChecklist);
router.post("/:id/checklist", requireAuth, validate(createChecklistSchema), checklistController.addChecklistItem);
router.put("/checklist/:id", requireAuth, validate(updateChecklistSchema), checklistController.updateChecklistItem);
router.delete("/checklist/:id", requireAuth, checklistController.deleteChecklistItem);

export default router;