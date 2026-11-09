import { Router } from "express";
import * as agentConversationController from "../controllers/agent-conversation.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { sendConversationMessageSchema } from "../validations/schemas";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, agentConversationController.list);
router.post("/messages", requireAuth, validate(sendConversationMessageSchema), agentConversationController.sendMessage);

export default router;
