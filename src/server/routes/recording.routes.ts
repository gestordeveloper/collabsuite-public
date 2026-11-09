import { Router } from "express";
import * as recordingController from "../controllers/recording.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/", requireAuth, recordingController.list);
router.post("/", requireAuth, recordingController.uploadRecordingMiddleware, recordingController.create);
router.get("/index/status", requireAuth, recordingController.indexStatus);
router.post("/index/reindex", requireAuth, recordingController.reindex);
router.get("/:id", requireAuth, recordingController.get);
router.patch("/:id", requireAuth, recordingController.update);
router.delete("/:id", requireAuth, recordingController.remove);
router.get("/:id/audio-url", requireAuth, recordingController.audioUrl);
router.post("/:id/share", requireAuth, recordingController.share);
router.post("/:id/reprocess", requireAuth, recordingController.reprocess);
router.patch("/:id/actions/:actionId", requireAuth, recordingController.updateAction);
router.post("/:id/actions/to-tasks", requireAuth, recordingController.convertToTasks);

export default router;
