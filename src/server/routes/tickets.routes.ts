import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/requireRole.middleware";
import { validate } from "../middleware/validate.middleware";
import * as tickets from "../controllers/tickets/ticket.controller";
import * as admin from "../controllers/tickets/admin.controller";
import {
  bulkTransferSchema,
  botFlowSchema,
  queueSchema,
  sendMessageSchema,
  startConversationSchema,
  tagSchema,
  ticketTaskSchema,
  updateBotFlowSchema,
  updateQueueSchema,
  updateTagSchema,
  updateTicketSchema,
} from "../validations/tickets";

/** Atendimento por WhatsApp: tickets, filas, etiquetas e fluxos do bot. Montado em /api/atendimento. */
const router = Router();
router.use(requireAuth);

// ─── Apoio ao front ───
router.get("/connections", tickets.connections);
router.get("/team", tickets.team);
router.get("/contacts", tickets.contacts);

// ─── Filas e etiquetas (qualquer um lê; só admin altera) ───
router.get("/queues", admin.listQueues);
router.post("/queues", requireAdmin, validate(queueSchema), admin.createQueue);
router.put("/queues/:id", requireAdmin, validate(updateQueueSchema), admin.updateQueue);
router.delete("/queues/:id", requireAdmin, admin.deleteQueue);

router.get("/tags", admin.listTags);
router.post("/tags", requireAdmin, validate(tagSchema), admin.createTag);
router.put("/tags/:id", requireAdmin, validate(updateTagSchema), admin.updateTag);
router.delete("/tags/:id", requireAdmin, admin.deleteTag);

// ─── Fluxos do bot (admin) ───
router.get("/bot-flows", requireAdmin, admin.listFlows);
router.post("/bot-flows", requireAdmin, validate(botFlowSchema), admin.createFlow);
router.get("/bot-flows/:id", requireAdmin, admin.getFlow);
router.put("/bot-flows/:id", requireAdmin, validate(updateBotFlowSchema), admin.updateFlow);
router.delete("/bot-flows/:id", requireAdmin, admin.deleteFlow);
router.post("/bot-flows/:id/publish", requireAdmin, admin.publishFlow);

// ─── Tickets (rotas fixas antes de /:ticketId) ───
router.get("/tickets", tickets.list);
router.get("/tickets/counts", tickets.counts);
router.get("/tickets/ids-by-user", tickets.idsByUser);
router.put("/tickets/bulk-transfer", validate(bulkTransferSchema), tickets.bulkTransfer);
router.post("/tickets", validate(startConversationSchema), tickets.start);

router.get("/tickets/:ticketId", tickets.get);
router.put("/tickets/:ticketId", validate(updateTicketSchema), tickets.update);
router.delete("/tickets/:ticketId", tickets.remove);

router.get("/tickets/:ticketId/messages", tickets.messages);
router.post("/tickets/:ticketId/messages", validate(sendMessageSchema), tickets.send);
router.post("/tickets/:ticketId/messages/file", tickets.mediaMiddleware, tickets.sendFile);
router.delete("/tickets/:ticketId/messages/:messageId", tickets.removeMessage);

router.get("/tickets/:ticketId/tasks", tickets.tasks);
router.post("/tickets/:ticketId/tasks", validate(ticketTaskSchema), tickets.createTask);

export default router;
