import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import * as bridge from "../services/local-cli/cliBridge.service";

const router = Router();
router.use(requireAuth);

// usado pela tela de configuração
router.get("/status", (req, res) => {
  const id = req.user!.id;
  res.json({ connected: bridge.isConnected(id), clis: bridge.listClis(id), pending: bridge.pendingCount(id) });
});
router.post("/token", (req, res) => res.json({ token: bridge.createAgentToken(req.user!.id, req.user!.email) }));

// usado pelo agente (agent/cli-agent)
router.post("/ping", (req, res) => { bridge.touch(req.user!.id, req.body?.clis); res.json({ ok: true }); });
router.post("/next", async (req, res) => {
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  const job = await bridge.nextJob(req.user!.id, req.body?.clis, ac.signal);
  if (!job) return res.status(204).end();
  res.json(job);
});
router.post("/jobs/:id/result", (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) return res.status(400).json({ error: "Resposta vazia." });
  res.json({ ok: bridge.completeJob(req.user!.id, req.params.id, text) });
});
router.post("/jobs/:id/error", (req, res) => {
  res.json({ ok: bridge.failJob(req.user!.id, req.params.id, String(req.body?.message || "falha desconhecida").slice(0, 400)) });
});

export default router;
