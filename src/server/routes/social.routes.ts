import { Router } from "express";
import * as c from "../controllers/social.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// Pública: a rede (Google / TikTok) redireciona o navegador para cá depois do login (sem Bearer).
router.get("/oauth/:platform/callback", c.oauthCallback);

router.use(requireAuth);

router.get("/config", c.getConfig);
router.put("/config/:platform", c.saveConfig);
router.get("/accounts", c.accounts);
router.post("/connect-url", c.connectUrl);
router.delete("/account", c.disconnect);
router.get("/tiktok/creator-info", c.tiktokCreatorInfo);

router.get("/posts", c.listPosts);
router.get("/posts/by-task/:taskId", c.getPostByTask);
router.post("/posts", c.createPosts);
router.put("/posts/:id", c.updatePost);
router.delete("/posts/:id", c.deletePost);
router.post("/posts/:id/publish", c.publishNow);

export default router;
