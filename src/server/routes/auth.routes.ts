import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { authLimiter } from "../middleware/rateLimit.middleware";
import { validate } from "../middleware/validate.middleware";
import { registerSchema, loginSchema, updateUserSchema } from "../validations/schemas";

const router = Router();

router.post("/register", authLimiter, validate(registerSchema), authController.register);
router.post("/login", authLimiter, validate(loginSchema), authController.login);
router.get("/me", requireAuth, authController.me);
router.get("/google/url", requireAuth, authController.googleAuthUrl);
router.get("/google/callback", authController.googleAuthCallback);

export default router;