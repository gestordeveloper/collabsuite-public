import { Router } from "express";
import * as designController from "../controllers/design.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createDesignSchema, updateDesignSchema } from "../validations/schemas";

const router = Router();

// Authenticated CRUD for designs (Design Studio)
router.get("/", requireAuth, designController.listDesigns);
router.get("/:id", requireAuth, designController.getDesign);
router.post("/", requireAuth, validate(createDesignSchema), designController.createDesign);
router.post("/:id/duplicate", requireAuth, designController.duplicateDesign);
router.put("/:id", requireAuth, validate(updateDesignSchema), designController.updateDesign);
router.delete("/:id", requireAuth, designController.deleteDesign);

export default router;
