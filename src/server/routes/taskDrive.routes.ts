import { Router } from "express";
import * as taskDriveController from "../controllers/taskDrive.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/:id/drive/files", requireAuth, taskDriveController.listFiles);
router.get("/:id/drive/files/:fileId/content", requireAuth, taskDriveController.getFile);
router.post("/:id/drive/files/:fileId/stream-url", requireAuth, taskDriveController.createStreamUrl);
// Sem requireAuth: o <video> não manda Authorization; a URL assinada (?st=) faz o papel do token.
router.get("/:id/drive/files/:fileId/stream", taskDriveController.streamFile);

export default router;
