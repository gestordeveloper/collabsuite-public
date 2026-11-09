import { Router } from "express";
import * as customFontController from "../controllers/custom-font.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createCustomFontSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, customFontController.listCustomFonts);
router.post("/", requireAuth, validate(createCustomFontSchema), customFontController.createCustomFont);
router.delete("/:id", requireAuth, customFontController.deleteCustomFont);

export default router;
