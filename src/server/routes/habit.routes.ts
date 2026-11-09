import { Router } from "express";
import * as habitController from "../controllers/habit.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createHabitSchema, updateHabitSchema, habitLogSchema, createTeamHabitSchema, updateTeamHabitSchema, saveFocusSchema } from "../validations/schemas";

const router = Router();

// Rotas fixas antes de "/:id" para não serem lidas como um id.
router.get("/summary", requireAuth, habitController.summary);
router.get("/focus", requireAuth, habitController.getFocus);
router.put("/focus", requireAuth, validate(saveFocusSchema), habitController.saveFocus);
router.get("/team", requireAuth, habitController.teamBoard);
router.get("/team/candidates", requireAuth, habitController.teamCandidates);
router.post("/team", requireAuth, validate(createTeamHabitSchema), habitController.teamCreate);
router.put("/team/:id", requireAuth, validate(updateTeamHabitSchema), habitController.teamUpdate);
router.delete("/team/:id", requireAuth, habitController.teamRemove);
router.post("/team/:id/nudge", requireAuth, habitController.teamNudge);

router.get("/", requireAuth, habitController.list);
router.post("/", requireAuth, validate(createHabitSchema), habitController.create);
router.put("/:id", requireAuth, validate(updateHabitSchema), habitController.update);
router.delete("/:id", requireAuth, habitController.remove);
router.put("/:id/logs", requireAuth, validate(habitLogSchema), habitController.setLog);

export default router;
