import { Router } from "express";
import * as generatedImageController from "../controllers/generated-image.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/", requireAuth, generatedImageController.list);
router.delete("/:id", requireAuth, generatedImageController.remove);

export default router;
