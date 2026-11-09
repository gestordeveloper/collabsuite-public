import { Router } from "express";
import * as funnelController from "../controllers/funnel.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { updateFunnelSchema, createStageSchema, updateStageSchema, addFunnelUserSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, funnelController.listFunnels);
router.put("/:id", requireAuth, validate(updateFunnelSchema), funnelController.updateFunnel);
router.delete("/:id", requireAuth, funnelController.deleteFunnel);
router.post("/:id/stages", requireAuth, validate(createStageSchema), funnelController.createStage);
router.put("/stages/:id", requireAuth, validate(updateStageSchema), funnelController.updateStage);
router.delete("/stages/:id", requireAuth, funnelController.deleteStage);

router.get("/:id/users", requireAuth, funnelController.listFunnelUsers);
router.post("/:id/users", requireAuth, validate(addFunnelUserSchema), funnelController.addFunnelUser);
router.delete("/:id/users/:userId", requireAuth, funnelController.removeFunnelUser);

export default router;
