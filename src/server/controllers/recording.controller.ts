import type { Request, Response } from "express";
import os from "os";
import fsp from "fs/promises";
import multer from "multer";
import { z } from "zod";
import * as recordingService from "../services/recording.service";
import { emitAll } from "../lib/socket";
import * as recordingIndex from "../services/recording-index/index.service";

// Gravações de reuniões chegam a centenas de MB: vão para o disco temporário (não para a memória)
// e de lá em streaming para o S3.
const diskUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024 * 1024 * 1024 } });
export const uploadRecordingMiddleware = diskUpload.single("file");

function handleError(err: any, res: Response) {
  const status = err?.statusCode ?? 400;
  res.status(status).json({ error: err?.message || "Erro ao processar a solicitação." });
}

const intOrUndef = (v: unknown) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isInteger(n) && n > 0 ? n : undefined;
};

export async function list(req: Request, res: Response) {
  try {
    res.json(
      await recordingService.listRecordings(req.user!.id, {
        projectId: intOrUndef(req.query.project_id),
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        category: typeof req.query.category === "string" && req.query.category ? req.query.category : undefined,
      })
    );
  } catch (err) {
    handleError(err, res);
  }
}

export async function get(req: Request, res: Response) {
  try {
    res.json(await recordingService.getRecording(parseInt(req.params.id), req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

export async function create(req: Request, res: Response) {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Nenhum arquivo de áudio enviado." });

  const mime = file.mimetype || "application/octet-stream";
  if (!/^(audio|video)\//.test(mime) && mime !== "application/octet-stream") {
    await fsp.rm(file.path, { force: true }).catch(() => {});
    return res.status(400).json({ error: "Envie um arquivo de áudio ou vídeo." });
  }

  try {
    const body = req.body as Record<string, string | undefined>;
    const recordedAt = body.recorded_at ? new Date(body.recorded_at) : null;
    const created = await recordingService.createRecording({
      userId: req.user!.id,
      companyId: req.user!.company_id ?? null,
      tempPath: file.path,
      originalName: Buffer.from(file.originalname, "latin1").toString("utf8"),
      mimeType: mime,
      size: file.size,
      title: body.title,
      projectId: intOrUndef(body.project_id) ?? null,
      category: body.category,
      tipo: body.tipo,
      durationSeconds: body.duration_seconds ? Number(body.duration_seconds) || null : null,
      recordedAt: recordedAt && !Number.isNaN(recordedAt.getTime()) ? recordedAt : null,
    });
    res.status(201).json(created);
  } catch (err: any) {
    console.error("Recording upload error:", err);
    handleError(err, res);
  }
}

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  category: z.string().max(100).nullable().optional(),
  tipo: z.string().max(50).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  project_id: z.number().int().positive().nullable().optional(),
});

export async function update(req: Request, res: Response) {
  try {
    const data = updateSchema.parse(req.body);
    res.json(await recordingService.updateRecording(parseInt(req.params.id), req.user!.id, data));
  } catch (err) {
    handleError(err instanceof z.ZodError ? new Error("Dados inválidos.") : err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    res.json(await recordingService.deleteRecording(parseInt(req.params.id), req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

export async function audioUrl(req: Request, res: Response) {
  try {
    res.json(await recordingService.getAudioUrl(parseInt(req.params.id), req.user!.id, req.query.download === "1"));
  } catch (err) {
    handleError(err, res);
  }
}

export async function share(req: Request, res: Response) {
  try {
    res.json(await recordingService.setSharing(parseInt(req.params.id), req.user!.id, req.body?.enabled !== false));
  } catch (err) {
    handleError(err, res);
  }
}

export async function getPublic(req: Request, res: Response) {
  try {
    res.json(await recordingService.getPublicRecording(req.params.token));
  } catch (err) {
    handleError(err, res);
  }
}

export async function reprocess(req: Request, res: Response) {
  try {
    res.json(await recordingService.reprocessRecording(parseInt(req.params.id), req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

const actionSchema = z.object({
  text: z.string().min(1).max(2000).optional(),
  priority: z.enum(["P1", "P2", "P3"]).optional(),
  owner_name: z.string().max(150).nullable().optional(),
  due_text: z.string().max(100).nullable().optional(),
  status: z.enum(["pending", "dismissed"]).optional(),
});

export async function updateAction(req: Request, res: Response) {
  try {
    const data = actionSchema.parse(req.body);
    res.json(await recordingService.updateAction(parseInt(req.params.id), parseInt(req.params.actionId), req.user!.id, data));
  } catch (err) {
    handleError(err instanceof z.ZodError ? new Error("Dados inválidos.") : err, res);
  }
}

const convertSchema = z.object({
  action_ids: z.array(z.number().int().positive()).optional(),
  funnel_id: z.number().int().positive().nullable().optional(),
  stage_id: z.number().int().positive().nullable().optional(),
});

export async function convertToTasks(req: Request, res: Response) {
  try {
    const data = convertSchema.parse(req.body ?? {});
    const result = await recordingService.convertActionsToTasks(parseInt(req.params.id), req.user!.id, {
      actionIds: data.action_ids,
      funnelId: data.funnel_id,
      stageId: data.stage_id,
    });
    for (const task of result.tasks) emitAll("task_created", task);
    res.status(201).json(result);
  } catch (err) {
    handleError(err instanceof z.ZodError ? new Error("Dados inválidos.") : err, res);
  }
}

// ─── Índice vetorial (busca dos agentes) ───────────────────────────────────────

export async function indexStatus(req: Request, res: Response) {
  try {
    res.json(await recordingIndex.getIndexStatus(req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
}

/** Indexa as gravações do usuário que ainda não estão no índice (`force: true` refaz todas). */
export async function reindex(req: Request, res: Response) {
  try {
    if (!recordingIndex.isIndexConfigured()) throw Object.assign(new Error("QDRANT_URL não configurada no servidor."), { statusCode: 400 });
    res.json({ queued: await recordingIndex.enqueueReindex(req.user!.id, req.body?.force === true) });
  } catch (err) {
    handleError(err, res);
  }
}
