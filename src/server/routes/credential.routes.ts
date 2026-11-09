import { Router } from "express";
import * as credentialController from "../controllers/credential.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createCredentialSchema, updateCredentialSchema } from "../validations/schemas";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, credentialController.list);
router.post("/", requireAuth, validate(createCredentialSchema), credentialController.create);
router.put("/:credentialId", requireAuth, validate(updateCredentialSchema), credentialController.update);
router.delete("/:credentialId", requireAuth, credentialController.remove);
router.get("/:credentialId/reveal", requireAuth, credentialController.reveal);

export default router;
