import { Router } from "express";
import * as driveController from "../controllers/drive.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { uploadDriveFileSchema, createDriveFolderSchema } from "../validations/schemas";

const router = Router({ mergeParams: true });

router.get("/status", requireAuth, driveController.getStatus);
router.post("/connect", requireAuth, driveController.connect);
router.get("/files", requireAuth, driveController.listFiles);
router.post("/files", requireAuth, validate(uploadDriveFileSchema), driveController.uploadFile);
router.get("/files/:fileId/content", requireAuth, driveController.getFileContent);
router.delete("/files/:fileId", requireAuth, driveController.deleteFile);
router.post("/folders", requireAuth, validate(createDriveFolderSchema), driveController.createFolder);

export default router;
