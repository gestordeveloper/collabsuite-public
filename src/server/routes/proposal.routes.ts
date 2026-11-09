import { Router } from "express";
import * as proposalController from "../controllers/proposal.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createProposalTemplateSchema, updateProposalTemplateSchema } from "../validations/schemas";

const router = Router();

// Authenticated CRUD for proposal templates
router.get("/", requireAuth, proposalController.listTemplates);
router.get("/:id", requireAuth, proposalController.getTemplate);
router.post("/", requireAuth, validate(createProposalTemplateSchema), proposalController.createTemplate);
router.put("/:id", requireAuth, validate(updateProposalTemplateSchema), proposalController.updateTemplate);
router.delete("/:id", requireAuth, proposalController.deleteTemplate);

export default router;
