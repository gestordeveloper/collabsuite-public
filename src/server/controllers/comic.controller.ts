import type { Request, Response } from "express";
import multer from "multer";
import * as video from "../services/carrossel/comicVideo.service";
import * as eleven from "../services/carrossel/eleven.service";
import * as comic from "../services/carrossel/comic.service";
import { styleOptions } from "../services/carrossel/comicStyles";
import { startJob, publicJob } from "../services/carrossel/jobs";
import { AIGenerationError } from "../services/carrossel/aiClient";
import type { ImageProvider } from "../services/carrossel/mediaGen.service";
import { uploadImageMiddleware } from "./carrossel.controller";

export { uploadImageMiddleware };
export const uploadAudioMiddleware = multer({ storage: multer.memoryStorage(), limits: { fileSize: 120 * 1024 * 1024 } }).single("file");

function handleError(err: any, res: Response) {
  const status = err instanceof AIGenerationError ? err.status : err?.statusCode ?? 400;
  res.status(status).json({ error: err?.message || "Erro ao processar a solicitação." });
}

const actorOf = (req: Request) => ({ userId: req.user!.id, companyId: req.user!.company_id ?? null });

export const listStyles = (_req: Request, res: Response) => res.json(styleOptions());

export async function listSeries(req: Request, res: Response) {
  try { res.json(await comic.listSeries(req.user!.id)); } catch (err) { handleError(err, res); }
}

export async function saveSeries(req: Request, res: Response) {
  try { res.json(await comic.saveSeries(req.user!.id, req.body)); } catch (err) { handleError(err, res); }
}

export async function deleteSeries(req: Request, res: Response) {
  try { res.json({ success: await comic.deleteSeries(req.params.id, req.user!.id) }); } catch (err) { handleError(err, res); }
}

export async function uploadSheet(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ error: "Nenhuma imagem enviada." });
    res.json(await comic.addSheet(req.params.id, req.params.charId, req.user!.id, req.file));
  } catch (err) { handleError(err, res); }
}

export async function deleteSheet(req: Request, res: Response) {
  try { res.json(await comic.removeSheet(req.params.id, req.params.charId, req.user!.id, String(req.query.url || ""))); } catch (err) { handleError(err, res); }
}

export async function listEpisodes(req: Request, res: Response) {
  try { res.json(await comic.listEpisodes(req.params.id, req.user!.id)); } catch (err) { handleError(err, res); }
}

export async function saveEpisode(req: Request, res: Response) {
  try { res.json(await comic.saveEpisode(req.user!.id, req.body)); } catch (err) { handleError(err, res); }
}

export async function deleteEpisode(req: Request, res: Response) {
  try { res.json({ success: await comic.deleteEpisode(req.params.id, req.params.episodeId, req.user!.id) }); } catch (err) { handleError(err, res); }
}

export async function getShare(req: Request, res: Response) {
  try { res.json(await comic.getEpisodeShare(req.params.id, req.params.episodeId, req.user!.id)); } catch (err) { handleError(err, res); }
}

export async function setShare(req: Request, res: Response) {
  try { res.json(await comic.setEpisodeSharing(req.params.id, req.params.episodeId, req.user!.id, req.body?.enabled !== false)); } catch (err) { handleError(err, res); }
}

export async function getPublicEpisode(req: Request, res: Response) {
  try { res.json(await comic.getPublicEpisode(req.params.token)); } catch (err) { handleError(err, res); }
}

export async function approvePublicEpisode(req: Request, res: Response) {
  try { res.json(await comic.setPublicApproval(req.params.token, req.body?.approved !== false)); } catch (err) { handleError(err, res); }
}

interface StepBody { provider?: string; model?: string; slides?: number[]; image_provider?: ImageProvider }

export async function startStep(req: Request, res: Response) {
  try {
    const step = req.params.step;
    if (!["script", "prompts", "images", "compose", "video"].includes(step)) return res.status(404).json({ error: "Etapa desconhecida." });
    const actor = actorOf(req);
    const body = (req.body || {}) as StepBody;
    const series = await comic.getSeries(req.params.id, actor.userId);
    const ep = await comic.getEpisode(req.params.id, req.params.episodeId, actor.userId);
    const over = { provider: body.provider, model: body.model };

    const job = startJob(actor.userId, `comic:${step}`, async (progress) => {
      if (step === "script") return comic.generateScript(actor, series, ep, over, progress);
      if (step === "prompts") return comic.generateArtPrompts(actor, series, ep, over, progress, false, body.slides);
      if (step === "compose") return comic.composeSlides(actor, series, ep, body.slides, progress);
      if (step === "video") return video.buildVideo(actor, series, ep, progress);
      // images
      if (!ep.slides.length) throw new AIGenerationError("Gere o roteiro primeiro (passo 1).", 400);
      let current = ep;
      if (!current.slides.every((s) => s.image_prompt)) current = await comic.generateArtPrompts(actor, series, current, over, progress, true); // pulou o passo 2
      const done = await comic.generateImages(actor, series, current, body.slides, progress, body.image_provider);
      progress("Montando os slides", 95);
      return comic.composeSlides(actor, series, done, body.slides);
    });
    res.status(202).json(publicJob(job));
  } catch (err) { handleError(err, res); }
}

export async function startSeason(req: Request, res: Response) {
  try {
    const actor = actorOf(req);
    const { story, episodes, slides, provider, model } = req.body as { story: string; episodes?: number; slides?: number; provider?: string; model?: string };
    const series = await comic.getSeries(req.params.id, actor.userId);
    const job = startJob(actor.userId, "comic:season", async (progress) => {
      const eps = await comic.generateSeason(actor, series, story, episodes ?? 3, slides ?? 10, { provider, model }, progress);
      return { episodes: eps.map((e) => e.id) };
    });
    res.status(202).json(publicJob(job));
  } catch (err) { handleError(err, res); }
}

export async function exportEpisode(req: Request, res: Response) {
  try {
    const ep = await comic.getEpisode(req.params.id, req.params.episodeId, req.user!.id);
    const zip = await comic.exportEpisodeZip(ep);
    res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="episodio_${String(ep.number).padStart(2, "0")}.zip"` }).send(zip);
  } catch (err) { handleError(err, res); }
}

export async function exportSeries(req: Request, res: Response) {
  try {
    const actor = actorOf(req);
    const series = await comic.getSeries(req.params.id, actor.userId);
    const zip = await comic.exportSeriesZip(actor, series);
    res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${series.id}_episodios.zip"` }).send(zip);
  } catch (err) { handleError(err, res); }
}

// ─── Narração e vídeo ─────────────────────────────────────────────────────────

export async function listVoices(req: Request, res: Response) {
  try { res.json(await eleven.listVoices(req.user!.id)); } catch (err) { handleError(err, res); }
}

export async function uploadAudio(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ error: "Nenhum áudio enviado." });
    res.json(await video.saveUploadedAudio(actorOf(req), req.params.id, req.params.episodeId, req.file));
  } catch (err) { handleError(err, res); }
}

export async function deleteAudio(req: Request, res: Response) {
  try { res.json(await video.removeUploadedAudio(actorOf(req), req.params.id, req.params.episodeId)); } catch (err) { handleError(err, res); }
}

export async function getElevenSettings(req: Request, res: Response) {
  try { res.json({ ...(await eleven.getSettings(req.user!.id)), styles: Object.entries(eleven.NARRATION_STYLES).map(([id, v]) => ({ id, label: v.label })) }); } catch (err) { handleError(err, res); }
}

export async function saveElevenSettings(req: Request, res: Response) {
  try { res.json(await eleven.saveSettings(req.user!.id, req.body || {})); } catch (err) { handleError(err, res); }
}
