import { Router } from "express";
import * as photosuiteController from "../controllers/photosuite.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { publicLimiter } from "../middleware/rateLimit.middleware";
import { validate } from "../middleware/validate.middleware";
import { createPhotoDocumentSchema, sharePhotoDocumentSchema, updatePhotoDocumentSchema } from "../validations/schemas";

const router = Router();

// Link público (sem login) — antes das rotas com :id
router.get("/public/:token", publicLimiter, photosuiteController.getPublicPhotoDocument);

// Documentos do Photosuite (editor de imagem). Os pixels de cada camada vão para /api/upload/file.
router.get("/", requireAuth, photosuiteController.listPhotoDocuments);
router.get("/:id", requireAuth, photosuiteController.getPhotoDocument);
router.post("/", requireAuth, validate(createPhotoDocumentSchema), photosuiteController.createPhotoDocument);
router.post("/:id/duplicate", requireAuth, photosuiteController.duplicatePhotoDocument);
router.post("/:id/share", requireAuth, validate(sharePhotoDocumentSchema), photosuiteController.sharePhotoDocument);
router.put("/:id", requireAuth, validate(updatePhotoDocumentSchema), photosuiteController.updatePhotoDocument);
router.delete("/:id", requireAuth, photosuiteController.deletePhotoDocument);

export default router;
