import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import * as widgetController from "../controllers/widget.controller";
import { verifyToken } from "../lib/jwt";
import { publicLimiter, widgetUploadLimiter } from "../middleware/rateLimit.middleware";
import path from "path";

const router = Router();

export function requireWidgetAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Acesso negado. Token não fornecido." });
    return;
  }

  const token = authHeader.split(" ")[1];
  const payload = verifyToken(token);
  if (!payload || !(payload as any).isWidgetUser) {
    res.status(401).json({ error: "Sessão do widget inválida ou expirada." });
    return;
  }

  req.user = {
    id: payload.userId,
    email: payload.email,
  } as any;
  (req as any).widgetFunnelId = (payload as any).funnelId;

  next();
}

// Serves the widget script file
router.get("/script.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.sendFile(path.join(process.cwd(), "public", "widget.js"));
});

// Initialize widget user
router.post("/initialize", publicLimiter, widgetController.initializeWidget);

// Authenticated ticket actions
router.get("/tickets", requireWidgetAuth, widgetController.listTickets);
router.post("/tickets", requireWidgetAuth, widgetController.createTicket);
router.get("/tickets/:ticketId/activities", requireWidgetAuth, widgetController.listActivities);
router.post("/tickets/:ticketId/activities", requireWidgetAuth, widgetController.createActivity);

// File attachments (photo, video, document, screenshot) for tickets/messages
router.post(
  "/upload",
  requireWidgetAuth,
  widgetUploadLimiter,
  widgetController.widgetUploadMiddleware,
  widgetController.uploadAttachment
);

export default router;
