import { Router } from "express";
import * as notificationController from "../controllers/notification.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/", requireAuth, notificationController.listNotifications);
router.get("/unread-count", requireAuth, notificationController.getUnreadCount);
router.post("/read-all", requireAuth, notificationController.markAllRead);
router.post("/:id/read", requireAuth, notificationController.markRead);
router.get("/settings", requireAuth, notificationController.getSettings);
router.put("/settings", requireAuth, notificationController.updateSettings);
router.get("/vapid-public-key", requireAuth, notificationController.getVapidKey);
router.post("/push/subscribe", requireAuth, notificationController.subscribePush);
router.post("/push/unsubscribe", requireAuth, notificationController.unsubscribePush);

export default router;
