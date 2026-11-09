import { Router } from "express";
import * as folderController from "../controllers/folder.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/", requireAuth, folderController.listFolders);
router.post("/", requireAuth, folderController.createFolder);
router.delete("/:id", requireAuth, folderController.deleteFolder);

export default router;
