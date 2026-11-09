import { Router } from "express";
import * as attachmentController from "../controllers/attachment.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/:taskId/attachments", requireAuth, attachmentController.listAttachments);
router.post("/:taskId/attachments", requireAuth, attachmentController.createAttachment);
router.delete("/:taskId/attachments/:attachmentId", requireAuth, attachmentController.deleteAttachment);

export default router;