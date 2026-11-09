import { Router } from "express";
import * as c from "../controllers/agent-channel.controller";
import { requireAuth } from "../middleware/auth.middleware";

// Montado em /api/agents/:agentId/channel — configuração do atendimento automático do agente.
const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get("/settings", c.getSettings);
router.put("/settings", c.updateSettings);

router.get("/sessions", c.listSessions);
router.get("/sessions/:id/messages", c.sessionMessages);
router.post("/sessions/:id/resume", c.resumeSession);
router.delete("/sessions/:id", c.deleteSession);

router.get("/knowledge", c.knowledgeStatus);
router.post("/knowledge", c.knowledgeUpload, c.uploadKnowledge);
router.post("/knowledge/search", c.searchKnowledge);
router.delete("/knowledge/:id", c.deleteKnowledge);

router.get("/mcp", c.listMcp);
router.post("/mcp", c.createMcp);
router.put("/mcp/:id", c.updateMcp);
router.delete("/mcp/:id", c.deleteMcp);
router.post("/mcp/:id/test", c.testMcp);

router.get("/dashboard", c.dashboard);

router.get("/calendar", c.listCalendar);
router.put("/calendar/:userId", c.setCalendarAccess);
router.delete("/calendar/:userId", c.removeCalendarAccess);

router.get("/telegram", c.getTelegram);
router.put("/telegram", c.updateTelegram);
router.delete("/telegram", c.deleteTelegram);
router.post("/telegram/pairing", c.createTelegramPairing);
router.post("/telegram/briefing", c.telegramBriefingNow);
router.delete("/telegram/links/:linkId", c.deleteTelegramLink);

export default router;
