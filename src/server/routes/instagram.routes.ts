import { Router } from "express";
import * as c from "../controllers/instagram.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// Públicas: chamadas pela Meta / redirecionamento do OAuth (sem Bearer).
router.get("/webhook", c.webhookVerify);
router.post("/webhook", c.webhookReceive);
router.get("/oauth/callback", c.oauthCallback);

router.use(requireAuth);

router.get("/config", c.getConfig);
router.put("/config", c.saveConfig);
router.get("/accounts", c.accounts);
router.post("/connect-url", c.connectUrl);
router.delete("/account", c.disconnect);
router.get("/pending/:selectionId", c.pendingAccounts);
router.post("/pending/:selectionId", c.selectAccount);
router.get("/media", c.media);

router.get("/posts", c.listPosts);
router.get("/posts/by-task/:taskId", c.getPostByTask);
router.post("/posts", c.createPost);
router.get("/posts/:id", c.getPost);
router.put("/posts/:id", c.updatePost);
router.delete("/posts/:id", c.deletePost);
router.post("/posts/:id/publish", c.publishNow);

router.get("/automations/summary", c.automationSummary);
router.get("/automations", c.listAutomations);
router.post("/automations", c.createAutomation);
router.put("/automations/:id", c.updateAutomation);
router.delete("/automations/:id", c.deleteAutomation);
router.get("/automations/:id/engagements", c.automationEngagements);

export default router;
