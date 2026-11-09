import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { signToken } from "../lib/jwt";
import { ensureStudioxRunning, studioxStatus } from "../services/studiox/process";
import { STUDIOX_COOKIE } from "../services/studiox/proxy";

const router = Router();
router.use(requireAuth);

router.get("/status", async (_req, res) => {
  res.json(await studioxStatus());
});

/**
 * O editor roda num iframe, que não consegue mandar o header Authorization: a sessão vira um cookie HttpOnly
 * restrito ao caminho /studiox. Também sobe o processo Python, para a primeira tela já encontrá-lo pronto.
 */
router.post("/session", async (req, res) => {
  try {
    await ensureStudioxRunning();
  } catch (err: any) {
    res.status(503).json({ error: err?.message || "StudioX indisponível." });
    return;
  }
  const token = signToken({ userId: req.user!.id, email: req.user!.email });
  res.cookie(STUDIOX_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/studiox",
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

export default router;
