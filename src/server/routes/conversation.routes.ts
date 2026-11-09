import { Router } from "express";
import * as agentConversationController from "../controllers/agent-conversation.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { updateConversationSchema } from "../validations/schemas";

const router = Router();

router.get("/:id", requireAuth, agentConversationController.get);
router.put("/:id", requireAuth, validate(updateConversationSchema), agentConversationController.rename);
router.delete("/:id", requireAuth, agentConversationController.remove);

export default router;
