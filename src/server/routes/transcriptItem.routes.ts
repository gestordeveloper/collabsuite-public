import { Router } from "express";
import * as transcriptController from "../controllers/transcript.controller";
import { requireAuth } from "../middleware/auth.middleware";

// Mounted at /api/transcripts — id-scoped actions (as opposed to the task-scoped ones in
// transcript.routes.ts, mounted at /api/tasks).
const router = Router();

router.get("/:id", requireAuth, transcriptController.getOne);
router.post("/:id/retry", requireAuth, transcriptController.retryTranscription);
router.post("/:id/messages", requireAuth, transcriptController.sendMessage);

export default router;
