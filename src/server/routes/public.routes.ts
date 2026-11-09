import { Router } from "express";
import * as taskController from "../controllers/task.controller";
import * as taskDriveController from "../controllers/taskDrive.controller";
import * as comicController from "../controllers/comic.controller";
import * as recordingController from "../controllers/recording.controller";
import * as proposalController from "../controllers/proposal.controller";
import { publicLimiter, publicCommentLimiter } from "../middleware/rateLimit.middleware";
import { validate } from "../middleware/validate.middleware";
import { publicBookingSchema } from "../validations/schemas";

const router = Router();

router.get("/calendar/:username", taskController.getPublicCalendar);
router.post("/schedule/:username", publicLimiter, validate(publicBookingSchema), taskController.publicSchedule);
router.get("/task/:id", taskController.getPublicTask);
router.get("/task/:id/drive/:fileId", publicLimiter, taskDriveController.getPublicFile);
router.post("/task/:id/approve", publicLimiter, taskController.approvePublicTask);
router.post("/task/:id/comments", publicCommentLimiter, taskController.publicCommentUpload, taskController.addPublicComment);
router.post("/form/:id/submit", publicLimiter, taskController.submitPublicForm);
router.get("/recording/:token", publicLimiter, recordingController.getPublic);
router.get("/novela/:token", publicLimiter, comicController.getPublicEpisode);
router.post("/novela/:token/approve", publicLimiter, comicController.approvePublicEpisode);
router.get("/proposal/:id", proposalController.getPublicProposal);

export default router;