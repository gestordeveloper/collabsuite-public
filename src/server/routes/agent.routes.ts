import { Router } from "express";
import * as agentController from "../controllers/agent.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createAgentSchema, updateAgentSchema, runAgentSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, agentController.list);
router.post("/", requireAuth, validate(createAgentSchema), agentController.create);
router.get("/:id", requireAuth, agentController.get);
router.put("/:id", requireAuth, validate(updateAgentSchema), agentController.update);
router.delete("/:id", requireAuth, agentController.remove);
router.post("/:id/run", requireAuth, validate(runAgentSchema), agentController.run);

export default router;
