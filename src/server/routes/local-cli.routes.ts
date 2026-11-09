import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/requireRole.middleware";
import * as svc from "../services/local-cli/local-cli.service";
import { LocalCliError } from "../services/local-cli/runner";

const router = Router();
router.use(requireAuth);

const companyOf = (req: Request) => req.user!.company_id ?? null;
const fail = (res: Response, err: any) => res.status(err instanceof LocalCliError ? err.status : 400).json({ error: err?.message || "Erro ao processar a solicitação." });

const inputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  preset: z.string().trim().min(1).max(20),
  command: z.string().trim().min(1).max(255),
  args: z.string().max(2000),
  prompt_mode: z.enum(["stdin", "arg"]),
  models: z.string().max(2000).nullish(),
  timeout_sec: z.number().int().min(10).max(1800).optional(),
  is_active: z.boolean().optional(),
});

// qualquer usuário logado vê a lista (alimenta o seletor); só admin altera
router.get("/", async (req, res) => { try { res.json(await svc.list(companyOf(req))); } catch (e) { fail(res, e); } });
router.get("/presets", requireAdmin, (_req, res) => res.json({ presets: svc.CLI_PRESETS, detected: svc.detect() }));

router.post("/", requireAdmin, async (req, res) => {
  try { res.status(201).json(await svc.create(companyOf(req), inputSchema.parse(req.body))); } catch (e) { fail(res, e); }
});
router.put("/:id", requireAdmin, async (req, res) => {
  try { res.json(await svc.update(companyOf(req), Number(req.params.id), inputSchema.partial().parse(req.body))); } catch (e) { fail(res, e); }
});
router.delete("/:id", requireAdmin, async (req, res) => {
  try { await svc.remove(companyOf(req), Number(req.params.id)); res.json({ success: true }); } catch (e) { fail(res, e); }
});
router.post("/:id/test", requireAdmin, async (req, res) => {
  try { res.json(await svc.test(companyOf(req), Number(req.params.id), typeof req.body?.model === "string" ? req.body.model : undefined)); } catch (e) { fail(res, e); }
});

export default router;
