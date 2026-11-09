import { Router } from "express";
import * as aiCredentialController from "../controllers/ai-credential.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/requireRole.middleware";
import { validate } from "../middleware/validate.middleware";
import { aiProviderParamsSchema, upsertAiCredentialSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, aiCredentialController.listStatus);

router.put(
  "/personal/:provider",
  requireAuth,
  validate(aiProviderParamsSchema, "params"),
  validate(upsertAiCredentialSchema),
  aiCredentialController.upsertPersonal
);
router.delete(
  "/personal/:provider",
  requireAuth,
  validate(aiProviderParamsSchema, "params"),
  aiCredentialController.removePersonal
);

router.put(
  "/company/:provider",
  requireAuth,
  requireAdmin,
  validate(aiProviderParamsSchema, "params"),
  validate(upsertAiCredentialSchema),
  aiCredentialController.upsertCompany
);
router.delete(
  "/company/:provider",
  requireAuth,
  requireAdmin,
  validate(aiProviderParamsSchema, "params"),
  aiCredentialController.removeCompany
);

export default router;
