import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import * as connectionController from "../controllers/whatsapp/connection.controller";
import * as contactController from "../controllers/whatsapp/contact.controller";
import * as campaignController from "../controllers/whatsapp/campaign.controller";
import {
  createWhatsAppConnectionSchema,
  renameWhatsAppConnectionSchema,
  createWhatsAppListSchema,
  updateWhatsAppListSchema,
  createWhatsAppContactSchema,
  updateWhatsAppContactSchema,
  bulkWhatsAppContactsSchema,
  createWhatsAppCampaignSchema,
  updateWhatsAppCampaignSchema,
  scheduleWhatsAppCampaignSchema,
} from "../validations/schemas";

import { ticketConnectionSettingsSchema } from "../validations/tickets";

const router = Router();

// Every route here is scoped to req.user!.id inside the service layer — a user only ever
// sees/manages their own WhatsApp connections, lists, contacts and campaigns.
router.use(requireAuth);

// ─── Connections ───
router.get("/connections", connectionController.list);
router.post("/connections", validate(createWhatsAppConnectionSchema), connectionController.create);
router.get("/connections/:connectionId", connectionController.get);
router.put("/connections/:connectionId", validate(renameWhatsAppConnectionSchema), connectionController.rename);
router.put("/connections/:connectionId/ticket-settings", validate(ticketConnectionSettingsSchema), connectionController.updateTicketSettings);
router.post("/connections/:connectionId/connect", connectionController.connect);
router.post("/connections/:connectionId/disconnect", connectionController.disconnect);
router.delete("/connections/:connectionId", connectionController.remove);
router.get("/connections/:connectionId/groups", connectionController.listGroups);

// ─── Contact lists + contacts ───
router.get("/lists", contactController.listLists);
router.post("/lists", validate(createWhatsAppListSchema), contactController.createList);
router.get("/lists/:listId", contactController.getList);
router.put("/lists/:listId", validate(updateWhatsAppListSchema), contactController.updateList);
router.delete("/lists/:listId", contactController.deleteList);

router.get("/lists/:listId/contacts", contactController.listContacts);
router.post("/lists/:listId/contacts", validate(createWhatsAppContactSchema), contactController.createContact);
router.post("/lists/:listId/contacts/bulk", validate(bulkWhatsAppContactsSchema), contactController.bulkCreateContacts);
router.put("/lists/:listId/contacts/:contactId", validate(updateWhatsAppContactSchema), contactController.updateContact);
router.delete("/lists/:listId/contacts/:contactId", contactController.deleteContact);

// ─── Campaigns ───
router.get("/campaigns", campaignController.list);
router.post("/campaigns", validate(createWhatsAppCampaignSchema), campaignController.create);
router.get("/campaigns/:campaignId", campaignController.get);
router.put("/campaigns/:campaignId", validate(updateWhatsAppCampaignSchema), campaignController.update);
router.delete("/campaigns/:campaignId", campaignController.remove);
router.post("/campaigns/:campaignId/schedule", validate(scheduleWhatsAppCampaignSchema), campaignController.schedule);
router.post("/campaigns/:campaignId/pause", campaignController.pause);
router.post("/campaigns/:campaignId/unschedule", campaignController.unschedule);
router.get("/campaigns/:campaignId/recipients", campaignController.listRecipients);

export default router;
