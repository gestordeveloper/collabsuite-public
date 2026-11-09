import { Router } from "express";
import * as agentPipelineController from "../controllers/agent-pipeline.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createAgentPipelineSchema, updateAgentPipelineSchema, runAgentPipelineSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, agentPipelineController.list);
router.post("/", requireAuth, validate(createAgentPipelineSchema), agentPipelineController.create);
router.get("/:id", requireAuth, agentPipelineController.get);
router.put("/:id", requireAuth, validate(updateAgentPipelineSchema), agentPipelineController.update);
router.delete("/:id", requireAuth, agentPipelineController.remove);
router.post("/:id/run", requireAuth, validate(runAgentPipelineSchema), agentPipelineController.run);

export default router;
