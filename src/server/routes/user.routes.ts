import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { updateUserSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, authController.listUsers);
router.put("/:id", requireAuth, validate(updateUserSchema), authController.updateUser);

export default router;