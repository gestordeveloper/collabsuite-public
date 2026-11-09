import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import { prisma } from "../lib/prisma";
import { emitToUser } from "../lib/socket";
import {
  buildRecordingKey,
  putRecordingFile,
  getRecordingUrl,
  downloadRecordingToTemp,
  deleteRecordingObject,
} from "../lib/recordingStorage";
import { probeDurationSeconds, transcodeToMp3 } from "../lib/ffmpeg";
import { transcribeFile, analyzeTranscript, renderAnalysisMarkdown } from "../lib/recordingPipeline";
import { assertFunnelAccess, NotFoundError } from "./access.service";
import * as taskService from "./task.service";
import { enqueueIndexing, removeRecordingIndex } from "./recording-index/index.service";

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

// ─── Acesso ────────────────────────────────────────────────────────────────────

/** Dono da gravação, ou qualquer membro do projeto ao qual ela pertence. */
export function accessWhere(userId: number) {
  return {
    OR: [
      { user_id: userId },
      { project: { OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] } },
    ],
  };
}

async function getAccessible(id: number, userId: number) {
  const recording = await prisma.recording.findFirst({
    where: { id, ...accessWhere(userId) },
    include: { project: { select: { id: true, name: true, color: true, user_id: true } } },
  });
  if (!recording) throw new NotFoundError("Gravação não encontrada ou sem permissão de acesso.");
  return recording;
}

/** Editar metadados, reprocessar e excluir ficam com quem gravou e com o dono do projeto. */
async function getManageable(id: number, userId: number) {
  const recording = await getAccessible(id, userId);
  if (recording.user_id !== userId && recording.project?.user_id !== userId) {
    throw new NotFoundError("Apenas quem gravou ou o dono do projeto pode alterar esta gravação.");
  }
  return recording;
}

async function assertProjectAccess(projectId: number, userId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] },
    select: { id: true },
  });
  if (!project) throw new NotFoundError("Projeto não encontrado ou sem permissão de acesso.");
}

// ─── Serialização ──────────────────────────────────────────────────────────────

type RecordingRow = NonNullable<Awaited<ReturnType<typeof getAccessible>>>;

function serialize(r: RecordingRow & { actions?: any[] }, opts: { full: boolean }) {
  const base = {
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id,
    project: r.project ? { id: r.project.id, name: r.project.name, color: r.project.color } : null,
    title: r.title,
    category: r.category,
    tipo: r.tipo,
    tags: parseJson<string[]>(r.tags, []),
    status: r.status,
    progress_label: r.progress_label,
    error: r.error,
    storage: r.storage,
    original_name: r.original_name,
    mime_type: r.mime_type,
    size_bytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    duration_seconds: r.duration_seconds,
    recorded_at: r.recorded_at,
    created_at: r.created_at,
    summary: r.summary,
    participants: parseJson<string[]>(r.participants, []),
    ai_provider: r.ai_provider,
    ai_model: r.ai_model,
    share_token: r.share_token,
    actions: (r.actions ?? []).map(serializeAction),
  };
  if (!opts.full) return base;
  return {
    ...base,
    transcript: r.transcript,
    topics: parseJson<string[]>(r.topics, []),
    decisions: parseJson<{ checked: boolean; text: string }[]>(r.decisions, []),
    risks: parseJson<string[]>(r.risks, []),
    next_steps: parseJson<string[]>(r.next_steps, []),
    analysis_md: r.analysis_md,
  };
}

function serializeAction(a: any) {
  return {
    id: a.id,
    recording_id: a.recording_id,
    text: a.text,
    priority: a.priority,
    owner_name: a.owner_name,
    due_text: a.due_text,
    status: a.status,
    task_id: a.task_id,
  };
}

const ACTIONS_INCLUDE = { actions: { orderBy: [{ sort_order: "asc" as const }, { id: "asc" as const }] } };
const PROJECT_INCLUDE = { project: { select: { id: true, name: true, color: true, user_id: true } } };

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export async function listRecordings(userId: number, filters: { projectId?: number; q?: string; category?: string }) {
  const q = filters.q?.trim();
  const rows = await prisma.recording.findMany({
    where: {
      AND: [
        accessWhere(userId),
        ...(filters.projectId ? [{ project_id: filters.projectId }] : []),
        ...(filters.category ? [{ category: filters.category }] : []),
        ...(q ? [{ OR: [{ title: { contains: q } }, { summary: { contains: q } }, { transcript: { contains: q } }] }] : []),
      ],
    },
    include: { ...PROJECT_INCLUDE, ...ACTIONS_INCLUDE },
    orderBy: { recorded_at: "desc" },
    take: 300,
  });
  return rows.map((r) => serialize(r, { full: false }));
}

export async function getRecording(id: number, userId: number) {
  await getAccessible(id, userId);
  const full = await prisma.recording.findUniqueOrThrow({ where: { id }, include: { ...PROJECT_INCLUDE, ...ACTIONS_INCLUDE } });
  return serialize(full, { full: true });
}

export interface CreateRecordingInput {
  userId: number;
  companyId: number | null;
  tempPath: string;
  originalName: string;
  mimeType: string;
  size: number;
  title?: string;
  projectId?: number | null;
  category?: string | null;
  tipo?: string | null;
  durationSeconds?: number | null;
  recordedAt?: Date | null;
}

export async function createRecording(input: CreateRecordingInput) {
  try {
    if (input.projectId) await assertProjectAccess(input.projectId, input.userId);

    let ext = (path.extname(input.originalName).replace(/^\./, "") || input.mimeType.split("/")[1]?.split(";")[0] || "bin").toLowerCase();
    // webm/ogg/wav gravados no navegador não têm índice de seek: normaliza para MP3 antes de guardar.
    if (ext !== "mp3") {
      const mp3Path = `${input.tempPath}.mp3`;
      try {
        await transcodeToMp3(input.tempPath, mp3Path);
        await fsp.rm(input.tempPath, { force: true }).catch(() => {});
        input = {
          ...input,
          tempPath: mp3Path,
          mimeType: "audio/mpeg",
          size: (await fsp.stat(mp3Path)).size,
          originalName: input.originalName.replace(/\.[^.]+$/, "") + ".mp3",
          durationSeconds: input.durationSeconds ?? (await probeDurationSeconds(mp3Path)),
        };
        ext = "mp3";
      } catch (err: any) {
        console.warn(`[recording] conversão para mp3 falhou, mantendo o original: ${err?.message}`);
        await fsp.rm(mp3Path, { force: true }).catch(() => {});
      }
    }
    const key = buildRecordingKey(input.userId, ext);
    const stored = await putRecordingFile(input.tempPath, key, input.mimeType);

    const recordedAt = input.recordedAt ?? new Date();
    const hasTitle = !!input.title?.trim();
    const title = hasTitle
      ? input.title!.trim()
      : `Gravação ${recordedAt.toLocaleDateString("pt-BR")} ${recordedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

    const created = await prisma.recording.create({
      data: {
        company_id: input.companyId,
        user_id: input.userId,
        project_id: input.projectId ?? null,
        title: title.slice(0, 255),
        category: input.category?.trim() || null,
        tipo: input.tipo?.trim() || "Reunião",
        status: "uploaded",
        storage: stored.storage,
        storage_key: stored.key,
        original_name: input.originalName.slice(0, 255),
        mime_type: input.mimeType.slice(0, 100),
        size_bytes: BigInt(input.size),
        duration_seconds: input.durationSeconds ? Math.round(input.durationSeconds) : null,
        recorded_at: recordedAt,
      },
      include: { ...PROJECT_INCLUDE, ...ACTIONS_INCLUDE },
    });

    enqueueProcessing(created.id, { localFile: input.tempPath, aiTitle: !hasTitle });
    return serialize(created, { full: false });
  } catch (err) {
    await fsp.rm(input.tempPath, { force: true }).catch(() => {});
    throw err;
  }
}

export async function updateRecording(
  id: number,
  userId: number,
  data: { title?: string; category?: string | null; tipo?: string; tags?: string[]; project_id?: number | null }
) {
  await getManageable(id, userId);
  if (data.project_id) await assertProjectAccess(data.project_id, userId);

  const updated = await prisma.recording.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title.trim().slice(0, 255) }),
      ...(data.category !== undefined && { category: data.category?.trim() || null }),
      ...(data.tipo !== undefined && { tipo: data.tipo.trim() || "Reunião" }),
      ...(data.tags !== undefined && { tags: JSON.stringify(data.tags.map((t) => t.trim()).filter(Boolean)) }),
      ...(data.project_id !== undefined && { project_id: data.project_id }),
    },
    include: { ...PROJECT_INCLUDE, ...ACTIONS_INCLUDE },
  });
  return serialize(updated, { full: false });
}

export async function deleteRecording(id: number, userId: number) {
  const recording = await getManageable(id, userId);
  await prisma.recording.delete({ where: { id } });
  await removeRecordingIndex(id).catch((err) => console.warn(`[recording-index] não foi possível limpar o índice de ${id}:`, err?.message));
  await deleteRecordingObject(recording.storage, recording.storage_key).catch((err) =>
    console.error(`[recording] não foi possível apagar o objeto ${recording.storage_key}:`, err?.message)
  );
  return { success: true };
}

export async function getAudioUrl(id: number, userId: number, download = false) {
  const r = await getAccessible(id, userId);
  const ext = path.extname(r.storage_key);
  const url = await getRecordingUrl(r.storage, r.storage_key, download ? `${r.title}${ext}` : undefined);
  return { url, mime_type: r.mime_type };
}

// ─── Compartilhamento por link ─────────────────────────────────────────────────

/** Liga/desliga o link público. Desligar apaga o token, então o link antigo deixa de funcionar para sempre. */
export async function setSharing(id: number, userId: number, enabled: boolean) {
  const r = await getManageable(id, userId);
  if (enabled && r.status !== "done") throw new Error("Só é possível compartilhar depois que a gravação for processada.");
  const share_token = enabled ? r.share_token ?? crypto.randomBytes(24).toString("base64url") : null;
  await prisma.recording.update({ where: { id }, data: { share_token } });
  return { share_token };
}

/** Visão pública (somente leitura) de uma gravação compartilhada: áudio, resumo, relatório e transcrição. */
export async function getPublicRecording(token: string) {
  const r = await prisma.recording.findUnique({ where: { share_token: token }, include: ACTIONS_INCLUDE });
  if (!r || r.status !== "done") throw new NotFoundError("Link inválido ou desativado.");
  const url = await getRecordingUrl(r.storage, r.storage_key, undefined);
  return {
    title: r.title,
    tipo: r.tipo,
    category: r.category,
    recorded_at: r.recorded_at,
    duration_seconds: r.duration_seconds,
    summary: r.summary,
    participants: parseJson<string[]>(r.participants, []),
    transcript: r.transcript,
    analysis_md: r.analysis_md,
    audio_url: url,
  };
}

export async function reprocessRecording(id: number, userId: number) {
  const r = await getManageable(id, userId);
  if (r.status === "transcribing" || r.status === "analyzing") throw new Error("Esta gravação já está sendo processada.");
  await prisma.recording.update({ where: { id }, data: { status: "uploaded", error: null, progress_label: "Na fila…" } });
  enqueueProcessing(id, { localFile: null, aiTitle: false });
  return getRecording(id, userId);
}

// ─── Pipeline (fila em processo, uma gravação por vez) ─────────────────────────

let queueTail: Promise<void> = Promise.resolve();

function enqueueProcessing(id: number, opts: { localFile: string | null; aiTitle: boolean }) {
  queueTail = queueTail.then(() => processRecording(id, opts)).catch((err) => console.error("[recording] fila:", err));
}

async function setProgress(id: number, status: "transcribing" | "analyzing", label: string, userId: number) {
  await prisma.recording.update({ where: { id }, data: { status, progress_label: label, error: null } });
  emitToUser(userId, "recording_progress", { id, status, progress_label: label });
}

async function processRecording(id: number, opts: { localFile: string | null; aiTitle: boolean }) {
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) {
    if (opts.localFile) await fsp.rm(opts.localFile, { force: true }).catch(() => {});
    return;
  }

  let file = opts.localFile;
  let downloadedDir: string | null = null;

  try {
    await setProgress(id, "transcribing", "Iniciando…", recording.user_id);

    if (!file) {
      // Reprocessamento (ou arquivo local já descartado): busca o áudio de volta do armazenamento.
      const ext = path.extname(recording.storage_key).replace(/^\./, "") || "bin";
      file = await downloadRecordingToTemp(recording.storage, recording.storage_key, ext);
      downloadedDir = path.dirname(file);
    }

    const duration = recording.duration_seconds ?? (await probeDurationSeconds(file));
    const progress = (label: string) => void setProgress(id, "transcribing", label, recording.user_id).catch(() => {});
    const { text } = await transcribeFile(file, recording.user_id, recording.company_id, progress);
    if (!text.trim()) throw new Error("Nenhuma fala foi detectada no áudio.");

    await prisma.recording.update({
      where: { id },
      data: { transcript: text, duration_seconds: duration ? Math.round(duration) : null },
    });

    await setProgress(id, "analyzing", "Analisando com IA…", recording.user_id);
    const analysisProgress = (label: string) => void setProgress(id, "analyzing", label, recording.user_id).catch(() => {});
    const { analysis, provider, model } = await analyzeTranscript(
      text,
      { title: recording.title, durationSeconds: duration ?? null, recordedAt: recording.recorded_at },
      recording.user_id,
      recording.company_id,
      analysisProgress
    );

    const title = opts.aiTitle && analysis.title ? analysis.title : recording.title;
    const markdown = renderAnalysisMarkdown(analysis, {
      title,
      recordedAt: recording.recorded_at,
      durationSeconds: duration ? Math.round(duration) : null,
    });

    await prisma.$transaction(async (tx) => {
      await tx.recording.update({
        where: { id },
        data: {
          status: "done",
          progress_label: null,
          error: null,
          title: title.slice(0, 255),
          // A categoria que o usuário escolheu na gravação tem prioridade sobre a sugerida pela IA.
          category: recording.category || analysis.categoria || null,
          tipo: recording.tipo === "Reunião" ? analysis.tipo || recording.tipo : recording.tipo,
          summary: analysis.resumo,
          participants: JSON.stringify(analysis.participantes),
          topics: JSON.stringify(analysis.temas),
          decisions: JSON.stringify(analysis.decisoes.map((d) => ({ checked: d.tomada, text: d.responsavel ? `${d.texto} — ${d.responsavel}` : d.texto }))),
          risks: JSON.stringify(analysis.riscos.map((r) => `${r.descricao} (impacto: ${r.impacto})`)),
          next_steps: JSON.stringify(analysis.proximos_passos),
          analysis_md: markdown,
          ai_provider: provider,
          ai_model: model,
        },
      });
      // Reprocessar substitui as ações que ainda não viraram tarefa (as já enviadas são preservadas).
      await tx.recordingAction.deleteMany({ where: { recording_id: id, status: { not: "converted" } } });
      if (analysis.acoes.length) {
        await tx.recordingAction.createMany({
          data: analysis.acoes.map((a, i) => ({
            recording_id: id,
            text: a.acao,
            priority: a.prioridade,
            owner_name: a.dono?.slice(0, 150) ?? null,
            due_text: a.prazo?.slice(0, 100) ?? null,
            sort_order: i,
          })),
        });
      }
    });

    emitToUser(recording.user_id, "recording_progress", { id, status: "done", progress_label: null });
    enqueueIndexing(id); // busca semântica dos agentes (no-op sem QDRANT_URL)
  } catch (err: any) {
    console.error(`[recording ${id}] falha no processamento:`, err);
    await prisma.recording
      .update({ where: { id }, data: { status: "error", progress_label: null, error: String(err?.message || "Falha ao processar a gravação.").slice(0, 500) } })
      .catch(() => {});
    emitToUser(recording.user_id, "recording_progress", { id, status: "error", progress_label: null });
  } finally {
    if (downloadedDir) await fsp.rm(downloadedDir, { recursive: true, force: true }).catch(() => {});
    else if (file) await fsp.rm(file, { force: true }).catch(() => {});
  }
}

/** No boot: o que estava em processamento morreu junto com o processo anterior. */
export async function sweepStuckRecordings() {
  const res = await prisma.recording.updateMany({
    where: { status: { in: ["uploaded", "transcribing", "analyzing"] } },
    data: { status: "error", progress_label: null, error: "Processamento interrompido (o servidor foi reiniciado). Use \"Reprocessar\"." },
  });
  if (res.count) console.log(`[recording] ${res.count} gravação(ões) interrompida(s) marcada(s) como erro.`);
}

// ─── Ações → tarefas do projeto ────────────────────────────────────────────────

export async function updateAction(
  recordingId: number,
  actionId: number,
  userId: number,
  data: { text?: string; priority?: string; owner_name?: string | null; due_text?: string | null; status?: "pending" | "dismissed" }
) {
  await getAccessible(recordingId, userId);
  const action = await prisma.recordingAction.findFirst({ where: { id: actionId, recording_id: recordingId } });
  if (!action) throw new NotFoundError("Ação não encontrada.");
  if (action.status === "converted" && data.status) throw new Error("Esta ação já virou tarefa.");

  const updated = await prisma.recordingAction.update({
    where: { id: actionId },
    data: {
      ...(data.text !== undefined && { text: data.text.trim() }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.owner_name !== undefined && { owner_name: data.owner_name?.trim() || null }),
      ...(data.due_text !== undefined && { due_text: data.due_text?.trim() || null }),
      ...(data.status !== undefined && { status: data.status }),
    },
  });
  return serializeAction(updated);
}

const PRIORITY_MAP: Record<string, "high" | "medium" | "low"> = { P1: "high", P2: "medium", P3: "low" };

/** "25/10", "25/10/2026", "2026-10-25" → "YYYY-MM-DD". Prazos em texto livre ("sexta") ficam só na descrição. */
function parseDueDate(text: string | null, reference: Date): string | null {
  if (!text) return null;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!br) return null;
  const day = Number(br[1]);
  const month = Number(br[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year = br[3] ? Number(br[3]) : reference.getFullYear();
  if (year < 100) year += 2000;
  if (!br[3] && new Date(year, month - 1, day).getTime() < reference.getTime() - 7 * 86400000) year += 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const normalizeName = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Casa o "dono" citado na reunião com um membro do projeto (nome completo, ou primeiro nome único). */
function matchMember(ownerName: string | null, members: { id: number; first_name: string; last_name: string | null }[]): number | null {
  if (!ownerName) return null;
  const wanted = normalizeName(ownerName);
  if (!wanted) return null;
  const full = members.filter((m) => normalizeName(`${m.first_name} ${m.last_name ?? ""}`) === wanted);
  if (full.length === 1) return full[0].id;
  const first = members.filter((m) => normalizeName(m.first_name) === normalizeName(wanted.split(/\s+/)[0]));
  return first.length === 1 ? first[0].id : null;
}

export interface ConvertResult {
  tasks: any[];
  skipped: number;
  funnel_id: number;
  stage_id: number;
}

/**
 * Envia as ações da gravação para o backlog do projeto: cada ação vira uma Task na etapa escolhida
 * (por padrão a "Backlog" do funil padrão do projeto). Ações já enviadas ou descartadas são puladas.
 */
export async function convertActionsToTasks(
  recordingId: number,
  userId: number,
  opts: { actionIds?: number[]; funnelId?: number | null; stageId?: number | null }
): Promise<ConvertResult> {
  const recording = await getAccessible(recordingId, userId);
  if (!recording.project_id) throw new Error("Vincule a gravação a um projeto antes de enviar as ações para o backlog.");

  const funnel = opts.funnelId
    ? await prisma.funnel.findFirst({ where: { id: opts.funnelId, project_id: recording.project_id }, select: { id: true } })
    : await prisma.funnel.findFirst({
        where: { project_id: recording.project_id },
        orderBy: [{ is_default: "desc" }, { id: "asc" }],
        select: { id: true },
      });
  if (!funnel) throw new Error("Este projeto ainda não tem um funil. Crie um funil na aba Funis.");
  await assertFunnelAccess(funnel.id, userId);

  const stages = await prisma.funnelStage.findMany({ where: { funnel_id: funnel.id }, orderBy: { stage_order: "asc" } });
  const stage = opts.stageId
    ? stages.find((s) => s.id === opts.stageId)
    : stages.find((s) => (s.name || "").trim().toLowerCase() === "backlog") ?? stages[0];
  if (!stage) throw new Error("O funil escolhido não tem etapas.");

  const actions = await prisma.recordingAction.findMany({
    where: {
      recording_id: recordingId,
      status: "pending",
      ...(opts.actionIds?.length ? { id: { in: opts.actionIds } } : {}),
    },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
  });

  const project = await prisma.project.findUnique({
    where: { id: recording.project_id },
    select: {
      user: { select: { id: true, first_name: true, last_name: true } },
      projectUsers: { select: { user: { select: { id: true, first_name: true, last_name: true } } } },
    },
  });
  const members = [project?.user, ...(project?.projectUsers.map((pu) => pu.user) ?? [])].filter(
    (u): u is { id: number; first_name: string; last_name: string | null } => !!u
  );

  const tasks: any[] = [];
  for (const action of actions) {
    const dueDate = parseDueDate(action.due_text, recording.recorded_at);
    const assigneeId = matchMember(action.owner_name, members);
    const details = [
      action.text,
      "",
      `Origem: gravação "${recording.title}" (${recording.recorded_at.toLocaleDateString("pt-BR")})`,
      action.owner_name && !assigneeId ? `Responsável citado: ${action.owner_name}` : null,
      action.due_text && !dueDate ? `Prazo citado: ${action.due_text}` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");

    const task = await taskService.createTask(
      {
        funnel_id: funnel.id,
        stage_id: stage.id,
        title: action.text.length > 250 ? `${action.text.slice(0, 247)}…` : action.text,
        description: details,
        priority: PRIORITY_MAP[action.priority] ?? "medium",
        user_id: assigneeId ?? undefined,
        due_at: dueDate ?? undefined,
        type: "task",
      },
      userId
    );
    await prisma.recordingAction.update({ where: { id: action.id }, data: { status: "converted", task_id: task.id } });
    tasks.push(task);
  }

  return { tasks, skipped: (opts.actionIds?.length ?? 0) > 0 ? Math.max(0, opts.actionIds!.length - actions.length) : 0, funnel_id: funnel.id, stage_id: stage.id };
}
