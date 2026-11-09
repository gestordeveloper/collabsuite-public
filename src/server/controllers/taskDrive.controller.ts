import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import * as projectService from "../services/project.service";

// Os arquivos são servidos na mesma origem do app: nada que o navegador execute (html/svg/js) pode sair com o tipo original.
const UNSAFE_MIME = /^(text\/html|application\/xhtml|image\/svg|text\/javascript|application\/javascript|text\/xml|application\/xml)/i;

async function resolveProjectId(taskId: number): Promise<number | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { funnel: { select: { project_id: true } } },
  });
  return task?.funnel?.project_id ?? null;
}

function handleError(err: any, res: Response) {
  if (err?.driveScopeError) {
    return res.status(409).json({ error: "O responsável pela pasta precisa reconectar a conta do Google para habilitar o acesso ao Drive." });
  }
  res.status(400).json({ error: err.message || "Erro ao acessar o Google Drive." });
}

const STREAM_SECRET = process.env.JWT_SECRET || "collabsuite-secret-key-change-in-production";

export async function pipeFile(projectId: number, fileId: string, res: Response, range?: string) {
  const file = await projectService.openProjectDriveFile(projectId, fileId, range);
  const mime = UNSAFE_MIME.test(file.mimeType) ? "text/plain" : file.mimeType;
  if (file.partial) {
    res.status(206);
    if (file.partial.contentRange) res.setHeader("Content-Range", file.partial.contentRange);
    if (file.partial.contentLength) res.setHeader("Content-Length", file.partial.contentLength);
  }
  if (file.acceptRanges) res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader("Cache-Control", "private, max-age=300");
  file.stream.on("error", () => res.destroy());
  file.stream.pipe(res);
}

/** Lista a pasta do Drive do projeto da tarefa (usado pelo seletor do nó "Arquivos do Drive"). */
export async function listFiles(req: Request, res: Response) {
  try {
    const projectId = await resolveProjectId(parseInt(req.params.id));
    if (!projectId) return res.status(404).json({ error: "Esta tarefa não pertence a um projeto." });
    const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
    res.json(await projectService.listProjectDriveFiles(projectId, folderId));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function getFile(req: Request, res: Response) {
  try {
    const projectId = await resolveProjectId(parseInt(req.params.id));
    if (!projectId) return res.status(404).json({ error: "Esta tarefa não pertence a um projeto." });
    await pipeFile(projectId, req.params.fileId, res, req.headers.range);
  } catch (err: any) {
    if (!res.headersSent) handleError(err, res);
  }
}

/**
 * O <video> não envia o header Authorization, então o usuário logado troca o acesso por uma URL
 * assinada de curta duração (1h) amarrada a esta tarefa e a este arquivo.
 */
export async function createStreamUrl(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const projectId = await resolveProjectId(taskId);
    if (!projectId) return res.status(404).json({ error: "Esta tarefa não pertence a um projeto." });
    const st = jwt.sign({ purpose: "drive-stream", taskId, fileId: req.params.fileId }, STREAM_SECRET, { expiresIn: "1h" });
    res.json({ url: `/api/tasks/${taskId}/drive/files/${encodeURIComponent(req.params.fileId)}/stream?st=${st}` });
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function streamFile(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    let claims: any;
    try { claims = jwt.verify(String(req.query.st || ""), STREAM_SECRET); } catch { return res.status(401).json({ error: "Link de visualização expirado." }); }
    if (claims?.purpose !== "drive-stream" || claims.taskId !== taskId || claims.fileId !== req.params.fileId) {
      return res.status(401).json({ error: "Link de visualização inválido." });
    }
    const projectId = await resolveProjectId(taskId);
    if (!projectId) return res.status(404).json({ error: "Esta tarefa não pertence a um projeto." });
    await pipeFile(projectId, req.params.fileId, res, req.headers.range);
  } catch (err: any) {
    if (!res.headersSent) handleError(err, res);
  }
}

/**
 * Link público (aprovação do cliente): só serve arquivos que estão de fato inseridos
 * no conteúdo da tarefa — o link público não dá acesso ao resto do Drive do projeto.
 */
export async function getPublicFile(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const { fileId } = req.params;
    if (isNaN(taskId) || !/^[\w-]{10,200}$/.test(fileId)) return res.status(400).json({ error: "ID inválido" });
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { content: true, deleted_at: true, funnel: { select: { project_id: true } } },
    });
    const projectId = task?.funnel?.project_id;
    if (!task || task.deleted_at || !projectId) return res.status(404).json({ error: "Tarefa não encontrada" });
    if (!task.content?.includes(fileId)) return res.status(404).json({ error: "Arquivo não encontrado nesta tarefa" });
    await pipeFile(projectId, fileId, res, req.headers.range);
  } catch (err: any) {
    if (!res.headersSent) handleError(err, res);
  }
}
