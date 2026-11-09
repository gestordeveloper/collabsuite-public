import { Router } from "express";
import * as transcriptController from "../controllers/transcript.controller";
import { requireAuth } from "../middleware/auth.middleware";

// Mounted at /api/tasks — same convention as attachment.routes.ts / checklist.routes.ts.
const router = Router();

router.post("/:taskId/attachments/:attachmentId/transcript", requireAuth, transcriptController.createTranscript);
router.get("/:taskId/transcripts", requireAuth, transcriptController.listForTask);

export default router;
