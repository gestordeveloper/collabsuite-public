import type { Request, Response } from "express";
import multer from "multer";
import * as bbService from "../services/carrossel/brandbook.service";
import * as projectService from "../services/carrossel/project.service";
import * as promptService from "../services/carrossel/prompt.service";
import * as ai from "../services/carrossel/ai.service";
import * as slideAi from "../services/carrossel/slideAi.service";
import * as imageText from "../services/carrossel/imageText.service";
import { exportExtras, type VideoExportRequest } from "../services/carrossel/slideExport.service";
import { ANIMATION_PRESETS, apply as applyAnimation } from "../services/carrossel/animationRuntime";
import * as people from "../services/carrossel/people.service";
import * as mediaGen from "../services/carrossel/mediaGen.service";
import * as render from "../services/carrossel/render.service";
import * as bbImport from "../services/carrossel/brandbookImport.service";
import { renderSlideHtml, renderTemplatePreview } from "../services/carrossel/template.service";
import { startJob, getJob, cancelJob, publicJob } from "../services/carrossel/jobs";
import { AIGenerationError, DEFAULT_MODELS, providerHasKey } from "../services/carrossel/aiClient";
import { PROVIDER_MODELS } from "../lib/ai-providers/models";
import * as localCli from "../services/local-cli/local-cli.service";
import * as cliBridge from "../services/local-cli/cliBridge.service";
import { storeBuffer, extFromMime } from "./upload.controller";
import { fetchStoredFileBytes } from "../lib/fileStorage";
import * as flowBridge from "../services/carrossel/flowBridge.service";
import { newSlide, type CarouselProjectData, type GenerateRequest, type SlideData } from "../services/carrossel/types";

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
export const uploadImageMiddleware = imageUpload.single("file");
const zipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
export const uploadZipMiddleware = zipUpload.single("file");

function handleError(err: any, res: Response) {
  const status = err instanceof AIGenerationError ? err.status : err?.statusCode ?? 400;
  res.status(status).json({ error: err?.message || "Erro ao processar a solicitação." });
}

const actorOf = (req: Request) => ({ userId: req.user!.id, companyId: req.user!.company_id ?? null });
const intOrUndef = (v: unknown) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isInteger(n) && n > 0 ? n : undefined;
};

// ─── IA ────────────────────────────────────────────────────────────────────────

/** Provedores com chave configurada e os modelos de cada um (alimenta os seletores do estúdio). */
export async function aiStatus(req: Request, res: Response) {
  try {
    const { userId, companyId } = actorOf(req);
    const providers = await Promise.all(
      (["groq", "openrouter", "anthropic", "openai"] as const).map(async (id) => ({
        id, configured: await providerHasKey(id, userId, companyId), default_model: DEFAULT_MODELS[id], models: PROVIDER_MODELS[id],
      })),
    );
    // CLIs instalados na máquina do servidor, cadastrados por um admin
    const clis = (await localCli.list(companyId).catch(() => [])).filter((c) => c.is_active && c.installed).map((c) => ({
      id: `cli:${c.id}`, label: `${c.name} (CLI local)`, configured: true, default_model: c.models[0] || "",
      models: c.models.map((m) => ({ id: m, label: m })), free_model: true,
    }));
    // CLIs do PC do usuário, quando o agente está conectado
    const agentClis = cliBridge.listClis(userId).map((c) => ({
      id: `agent:${c.name}`, label: `${c.name} (seu computador)`, configured: true, default_model: c.models[0] || "",
      models: c.models.map((m) => ({ id: m, label: m })), free_model: true,
    }));
    res.json({ providers: [...providers, ...agentClis, ...clis] });
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Marcas ────────────────────────────────────────────────────────────────────

export async function listBrandbooks(req: Request, res: Response) {
  try {
    const style = await imageText.getStyle(req.user!.id);
    const list = await bbService.listBrandbooks();
    res.json(list.map((bb) => bbService.summarize(imageText.inject(bb, style))));
  } catch (err) {
    handleError(err, res);
  }
}

export async function getBrandbook(req: Request, res: Response) {
  try {
    res.json(bbService.summarize(await imageText.getBrandbookFor(req.params.id, req.user!.id)));
  } catch (err) {
    handleError(err, res);
  }
}

export async function templatePreview(req: Request, res: Response) {
  try {
    const bb = await imageText.getBrandbookFor(req.params.id, req.user!.id);
    const theme = typeof req.query.theme === "string" ? req.query.theme : null;
    res.type("html").send(renderTemplatePreview(bb, req.params.code, theme));
  } catch (err) {
    handleError(err, res);
  }
}

export async function brandbookAsset(req: Request, res: Response) {
  try {
    const bb = await bbService.getBrandbook(req.params.id);
    const data = bb.assets[req.params.filename];
    if (!data) return res.status(404).json({ error: "Arquivo não encontrado." });
    const m = /^data:([^;]+);base64,(.*)$/.exec(data);
    if (!m) return res.status(404).json({ error: "Arquivo inválido." });
    res.type(m[1]).set("Cache-Control", "private, max-age=300").send(Buffer.from(m[2], "base64"));
  } catch (err) {
    handleError(err, res);
  }
}

export async function importBrandbook(req: Request, res: Response) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Envie o arquivo .zip do brand book." });
    const bb = await bbImport.importZip(file.buffer, file.originalname || "brandbook.zip", req.user!.id);
    res.status(201).json(bbService.summarize(bb));
  } catch (err) {
    handleError(err, res);
  }
}

export async function reanalyzeBrandbook(req: Request, res: Response) {
  try {
    const bb = await bbService.getBrandbook(req.params.id);
    res.json(bbService.summarize(await bbImport.reanalyze(req.params.id, bb)));
  } catch (err) {
    handleError(err, res);
  }
}

/** Ajustes manuais de uma marca: nome, @, descrição, regras de escrita e tema padrão. */
export async function updateBrandbook(req: Request, res: Response) {
  try {
    const bb = await bbService.getBrandbook(req.params.id);
    if (bb.id !== req.params.id) return res.status(404).json({ error: "Marca não encontrada." });
    const { name, handle, description, writing_rules, default_theme } = req.body as Partial<typeof bb>;
    if (typeof name === "string" && name.trim()) bb.name = name.trim().slice(0, 150);
    if (typeof handle === "string" && handle.trim()) bb.handle = handle.trim().startsWith("@") ? handle.trim() : `@${handle.trim()}`;
    if (typeof description === "string") bb.description = description.slice(0, 500);
    if (Array.isArray(writing_rules)) bb.writing_rules = writing_rules.map((r) => String(r).trim()).filter(Boolean).slice(0, 40);
    if (default_theme === "dark" || default_theme === "light") bb.default_theme = default_theme;
    res.json(bbService.summarize(await bbService.saveBrandbook(bb)));
  } catch (err) {
    handleError(err, res);
  }
}

export async function deleteBrandbook(req: Request, res: Response) {
  try {
    const used = await projectService.countByBrandbook(req.params.id);
    if (used > 0) return res.status(409).json({ error: `Esta marca é usada por ${used} carrossel(éis). Exclua-os ou troque a marca antes.` });
    if (!(await bbService.deleteBrandbook(req.params.id))) return res.status(404).json({ error: "Marca não encontrada." });
    res.json({ success: true });
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Projetos ──────────────────────────────────────────────────────────────────

export async function listProjects(req: Request, res: Response) {
  try {
    res.json(await projectService.listProjects(req.user!.id, { projectId: intOrUndef(req.query.project_id) }));
  } catch (err) {
    handleError(err, res);
  }
}

export async function getProject(req: Request, res: Response) {
  try {
    res.json(await projectService.getProject(req.params.id, req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

export async function createProject(req: Request, res: Response) {
  try {
    res.status(201).json(await projectService.createProject(req.user!.id, req.body as CarouselProjectData));
  } catch (err) {
    handleError(err, res);
  }
}

export async function saveProject(req: Request, res: Response) {
  try {
    res.json(await projectService.saveProject(req.params.id, req.user!.id, req.body as CarouselProjectData));
  } catch (err) {
    handleError(err, res);
  }
}

export async function deleteProject(req: Request, res: Response) {
  try {
    await projectService.deleteProject(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    handleError(err, res);
  }
}

export async function duplicateProject(req: Request, res: Response) {
  try {
    res.status(201).json(await projectService.duplicateProject(req.params.id, req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

export async function uploadImage(req: Request, res: Response) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Nenhuma imagem enviada." });
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype)) return res.status(400).json({ error: "Envie uma imagem (PNG, JPG, WEBP, GIF ou SVG)." });
    const url = await storeBuffer(file.buffer, extFromMime(file.mimetype), file.mimetype);
    res.json({ url });
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Prévia e exportação ──────────────────────────────────────────────────────

/** HTML do slide que está sendo editado (ainda não salvo), para a prévia do estúdio. */
export async function previewSlide(req: Request, res: Response) {
  try {
    const { brandbook_id, slide, total, is_single_slide, animated } = req.body as {
      brandbook_id: string; slide: SlideData; total: number; is_single_slide?: boolean; animated?: boolean;
    };
    const bb = await imageText.getBrandbookFor(brandbook_id, req.user!.id);
    const full = newSlide({ id: "preview", index: 1, template_type: "topico", ...slide });
    const html = renderSlideHtml(full, bb, { total: total || 1, isSingle: !!is_single_slide });
    res.type("html").send(animated ? applyAnimation(html, full.animation, "preview") : html);
  } catch (err) {
    handleError(err, res);
  }
}

export async function exportProject(req: Request, res: Response) {
  try {
    const project = await projectService.getProject(req.params.id, req.user!.id);
    const bb = await imageText.getBrandbookFor(project.brandbook_id, req.user!.id);
    const indices = Array.isArray(req.body?.slide_indices) ? (req.body.slide_indices as number[]) : null;
    const rendered = await render.renderProjectPngs(project, bb, indices);
    const zip = await render.zipSlides(project, bb, rendered);
    const safe = project.title.normalize("NFKD").replace(/[^\w-]+/g, "_").slice(0, 40) || "carrossel";
    res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${safe}.zip"` }).send(zip);
  } catch (err) {
    handleError(err, res);
  }
}

export async function slidePng(req: Request, res: Response) {
  try {
    const project = await projectService.getProject(req.params.id, req.user!.id);
    const bb = await imageText.getBrandbookFor(project.brandbook_id, req.user!.id);
    const slide = project.slides.find((s) => s.index === Number(req.params.index));
    if (!slide) return res.status(404).json({ error: "Slide não encontrado." });
    const png = await render.renderSlidePng(slide, project, bb);
    res.set({ "Content-Type": "image/png", "Content-Disposition": `attachment; filename="slide_${String(slide.index).padStart(2, "0")}.png"` }).send(png);
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Jobs de IA ────────────────────────────────────────────────────────────────

export async function generateJob(req: Request, res: Response) {
  try {
    const body = req.body as GenerateRequest;
    if (!body.brandbook_id) return res.status(400).json({ error: "Escolha a marca." });
    const actor = actorOf(req);
    const bb = await imageText.getBrandbookFor(body.brandbook_id, actor.userId);
    const job = startJob(actor.userId, "generate", async (progress) => {
      const project = body.carousel_model === "image_text"
        ? await imageText.generate(body, bb, actor, progress)
        : await ai.generateCarousel(body, bb, actor, progress);
      return projectService.createProject(actor.userId, project);
    });
    res.status(202).json(publicJob(job));
  } catch (err) {
    handleError(err, res);
  }
}

export async function regenerateSlideJob(req: Request, res: Response) {
  try {
    const { project_id, index, instruction, keep_template, provider, model } = req.body as {
      project_id: string; index: number; instruction?: string; keep_template?: boolean; provider?: string; model?: string;
    };
    const actor = actorOf(req);
    const project = await projectService.getProject(project_id, actor.userId);
    const bb = await imageText.getBrandbookFor(project.brandbook_id, actor.userId);
    const job = startJob(actor.userId, "regenerate", (progress) =>
      slideAi.regenerateSlide(project, bb, Number(index), actor, { instruction, keepTemplate: keep_template, provider, model }, progress));
    res.status(202).json(publicJob(job));
  } catch (err) {
    handleError(err, res);
  }
}

export async function reviewJob(req: Request, res: Response) {
  try {
    const { project_id, provider, model } = req.body as { project_id: string; provider?: string; model?: string };
    const actor = actorOf(req);
    const project = await projectService.getProject(project_id, actor.userId);
    const bb = await imageText.getBrandbookFor(project.brandbook_id, actor.userId);
    const job = startJob(actor.userId, "review", (progress) => slideAi.reviewProject(project, bb, actor, { provider, model }, progress));
    res.status(202).json(publicJob(job));
  } catch (err) {
    handleError(err, res);
  }
}

export function jobStatus(req: Request, res: Response) {
  const job = getJob(req.params.id, req.user!.id);
  if (!job) return res.status(404).json({ error: "Tarefa não encontrada." });
  res.json(publicJob(job));
}

export function jobCancel(req: Request, res: Response) {
  res.json({ cancelled: cancelJob(req.params.id, req.user!.id) });
}

// ─── Prompts ───────────────────────────────────────────────────────────────────

export async function listPrompts(req: Request, res: Response) {
  try {
    res.json(await promptService.overview(req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

export async function savePrompt(req: Request, res: Response) {
  try {
    const { scope, text } = req.body as { scope?: string; text?: string | null };
    const warnings = await promptService.savePrompt(req.user!.id, req.params.kind, scope || "global", text);
    res.json({ warnings });
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Imagem e Texto: estilo ───────────────────────────────────────────────────

export async function getImageTextStyle(req: Request, res: Response) {
  try {
    res.json(await imageText.styleOverview(req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

export async function saveImageTextStyle(req: Request, res: Response) {
  try {
    const body = req.body && Object.keys(req.body).length ? req.body : null;
    await imageText.saveStyle(req.user!.id, req.params.scope, body);
    res.json(await imageText.styleOverview(req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

export async function previewImageText(req: Request, res: Response) {
  try {
    const { brandbook_id, style, headline, subheadline, image_url } = req.body as {
      brandbook_id: string; style?: Record<string, any>; headline?: string; subheadline?: string; image_url?: string | null;
    };
    const bb = await bbService.getBrandbook(brandbook_id);
    const merged = { ...(await imageText.getStyle(req.user!.id, bb.id)), ...imageText.sanitizeStyle(style || {}) };
    res.type("html").send(imageText.previewHtml(
      bb, merged, headline || "Ter diploma não é garantia de resultado.", subheadline || "Falta uma coisa que a faculdade não ensina.", image_url,
    ));
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Pessoas (mapa da pessoa) ─────────────────────────────────────────────────

export async function listPeople(req: Request, res: Response) {
  try {
    res.json(await people.listPeople(req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

export async function savePerson(req: Request, res: Response) {
  try {
    res.json(await people.savePerson(req.user!.id, req.body));
  } catch (err) {
    handleError(err, res);
  }
}

export async function deletePerson(req: Request, res: Response) {
  try {
    res.json({ success: await people.deletePerson(req.params.id, req.user!.id) });
  } catch (err) {
    handleError(err, res);
  }
}

export async function addPersonPhoto(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ error: "Nenhuma foto enviada." });
    res.json(await people.addPhoto(req.params.id, req.user!.id, req.file));
  } catch (err) {
    handleError(err, res);
  }
}

export async function removePersonPhoto(req: Request, res: Response) {
  try {
    res.json(await people.removePhoto(req.params.id, req.user!.id, String(req.query.url || "")));
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Geração de imagem ────────────────────────────────────────────────────────

export async function imageProviders(req: Request, res: Response) {
  try {
    const { userId, companyId } = actorOf(req);
    res.json({ providers: await mediaGen.availableImageProviders(userId, companyId) });
  } catch (err) {
    handleError(err, res);
  }
}

const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", png: "image/png" };

/** Gera uma imagem por IA (opcionalmente com o mapa de uma pessoa e imagens de referência) e devolve a URL. */
export async function generateImage(req: Request, res: Response) {
  try {
    const actor = actorOf(req);
    const { prompt, provider, references, person_id, scene, brandbook_id } = req.body as {
      prompt?: string; provider?: mediaGen.ImageProvider; references?: string[]; person_id?: string; scene?: string; brandbook_id?: string;
    };
    if (person_id) {
      const person = await people.getPerson(person_id, actor.userId);
      if (!person) return res.status(404).json({ error: "Pessoa não encontrada." });
      return res.json({ url: await imageText.generatePersonImage(actor, person, scene || prompt || "", brandbook_id, provider) });
    }
    if (!prompt?.trim()) return res.status(400).json({ error: "Descreva a imagem que você quer." });
    const refs: mediaGen.ImageRef[] = [];
    for (const url of (references || []).slice(0, 8)) {
      const ext = (url.split("?")[0].split(".").pop() || "png").toLowerCase();
      refs.push({ label: "referência", data: await fetchStoredFileBytes(url), mime: MIME_BY_EXT[ext] || "image/png" });
    }
    const png = await mediaGen.generateImage(actor, prompt.trim(), { provider, references: refs });
    res.json({ url: await storeBuffer(png, "png", "image/png") });
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Exportação em vídeo / Stories ────────────────────────────────────────────

export const animationPresets = (_req: Request, res: Response) =>
  res.json(Object.entries(ANIMATION_PRESETS).map(([id, label]) => ({ id, label })));

export async function exportVideoJob(req: Request, res: Response) {
  try {
    const actor = actorOf(req);
    const project = await projectService.getProject(req.params.id, actor.userId);
    const bb = await imageText.getBrandbookFor(project.brandbook_id, actor.userId);
    const body = (req.body || {}) as VideoExportRequest;
    const job = startJob(actor.userId, "export-video", async (progress) => {
      const { zip, counts } = await exportExtras(project, bb, body, progress);
      const url = await storeBuffer(zip, "zip", "application/zip");
      return { url, counts, filename: `${(project.title || "carrossel").normalize("NFKD").replace(/[^\w-]+/g, "_").slice(0, 40)}_${body.format === "story" ? "stories" : "feed"}.zip` };
    });
    res.status(202).json(publicJob(job));
  } catch (err) {
    handleError(err, res);
  }
}

// ─── Extensão do Google Flow ──────────────────────────────────────────────────

export function flowStatus(req: Request, res: Response) {
  res.json({ connected: flowBridge.isConnected(req.user!.id), pending: flowBridge.pendingCount(req.user!.id) });
}

export function flowPing(req: Request, res: Response) {
  flowBridge.touch(req.user!.id);
  res.json({ ok: true });
}

export function flowToken(req: Request, res: Response) {
  res.json({ token: flowBridge.createExtensionToken(req.user!.id, req.user!.email) });
}

/** Long-poll da extensão: devolve o próximo pedido de imagem (ou 204 se nada chegou em ~25 s). */
export async function flowNext(req: Request, res: Response) {
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  const job = await flowBridge.nextJob(req.user!.id, ac.signal);
  if (!job) return res.status(204).end();
  res.json(flowBridge.publicJob(job));
}

export async function flowResult(req: Request, res: Response) {
  try {
    const { image_base64 } = req.body as { image_base64?: string };
    if (!image_base64) return res.status(400).json({ error: "Imagem ausente." });
    const raw = Buffer.from(image_base64.replace(/^data:[^,]+,/, ""), "base64");
    const sharp = (await import("sharp")).default;
    const png = await sharp(raw).png().toBuffer(); // o Flow pode devolver JPEG/WEBP
    res.json({ ok: flowBridge.completeJob(req.user!.id, req.params.id, png) });
  } catch (err) {
    handleError(err, res);
  }
}

export function flowError(req: Request, res: Response) {
  res.json({ ok: flowBridge.failJob(req.user!.id, req.params.id, String(req.body?.message || "falha desconhecida").slice(0, 300)) });
}
