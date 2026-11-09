import { Router } from "express";
import * as campaignController from "../controllers/whatsapp/campaign.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { upsertTaskWhatsAppCampaignSchema } from "../validations/schemas";

// Mounted at /api/tasks — the WhatsApp campaign linked to a "whatsapp"-template task (see
// campaign.service.ts#upsertTaskCampaign / getCampaignByTaskId).
const router = Router();

router.get("/:taskId/whatsapp-campaign", requireAuth, campaignController.getForTask);
router.put("/:taskId/whatsapp-campaign", requireAuth, validate(upsertTaskWhatsAppCampaignSchema), campaignController.upsertForTask);

export default router;
