import { Router } from "express";
import * as agentRunController from "../controllers/agent-run.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/", requireAuth, agentRunController.list);
router.get("/:id", requireAuth, agentRunController.get);

export default router;
