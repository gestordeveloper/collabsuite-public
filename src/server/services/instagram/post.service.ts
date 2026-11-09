/**
 * Postagens do Instagram. Cada post tem uma Task ligada (`task_id`, template "instagram_post") que
 * aparece no calendário (/agenda); mover/editar/excluir a tarefa na agenda reflete aqui (ver
 * onTaskChanged/onTaskDeleted, chamados por task.service).
 */
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { emitAll } from "../../lib/socket";
import { createTask, BRAZIL_OFFSET_MS } from "../task.service";
import { notifyUser } from "../notification.service";
import { requireAccount, accountTokenById, memberProjectIds } from "./account.service";
import { getConfig } from "./config.service";
import { publishMedia, absoluteMediaUrl, assertPublicMediaUrl } from "./graph";
import { createAutomationDraft, type AutomationInput } from "./automation.service";

export const TASK_TEMPLATE = "instagram_post";
const MAX_ATTEMPTS = 3;
const pad = (n: number) => String(n).padStart(2, "0");

/** Data/hora de Brasília (UTC-3 fixo, como o resto do app) de um instante. */
function brt(instant: Date) {
  const l = new Date(instant.getTime() - BRAZIL_OFFSET_MS);
  return { date: `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`, hour: `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}` };
}

const taskTitle = (title: string | null | undefined, caption: string | null | undefined) => {
  const base = (title || caption || "Postagem").replace(/\s+/g, " ").trim();
  return `📸 ${base.length > 70 ? `${base.slice(0, 67)}…` : base}`;
};

const parseMedia = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const include = {
  automation: { select: { id: true, title: true, status: true } },
  account: { select: { project_id: true, username: true, project: { select: { name: true, color: true } } } },
} as const;

type PostRow = NonNullable<Awaited<ReturnType<typeof prisma.instagramPost.findFirst<{ include: typeof include }>>>>;
type PostBase = NonNullable<Awaited<ReturnType<typeof prisma.instagramPost.findFirst>>>;

function shape(p: PostRow) {
  return {
    id: p.id,
    project: { id: p.account.project_id, name: p.account.project.name ?? `Projeto ${p.account.project_id}`, color: p.account.project.color, username: p.account.username },
    task_id: p.task_id,
    title: p.title,
    caption: p.caption ?? "",
    media: parseMedia(p.media),
    status: p.status,
    scheduled_at: p.scheduled_at,
    published_at: p.published_at,
    ig_media_id: p.ig_media_id,
    permalink: p.permalink,
    attempts: p.attempts,
    error: p.error,
    automation: p.automation ? { id: p.automation.id, title: p.automation.title, status: p.automation.status } : null,
    created_at: p.created_at,
  };
}

async function owned(userId: number, id: number) {
  const ids = await memberProjectIds(userId);
  const post = await prisma.instagramPost.findFirst({ where: { id, account: { project_id: { in: ids } } }, include });
  if (!post) throw new HttpError("Postagem não encontrada.", 404);
  return post;
}

export async function listPosts(userId: number, projectId?: number) {
  const ids = await memberProjectIds(userId);
  const scope = projectId ? ids.filter((i) => i === projectId) : ids;
  const rows = await prisma.instagramPost.findMany({ where: { account: { project_id: { in: scope } } }, include, orderBy: [{ scheduled_at: "desc" }, { id: "desc" }], take: 300 });
  return rows.map(shape);
}

export async function getPost(userId: number, id: number) {
  return shape(await owned(userId, id));
}

/** Resolve a postagem a partir da tarefa clicada na agenda. */
export async function getPostByTask(userId: number, taskId: number) {
  const ids = await memberProjectIds(userId);
  const post = await prisma.instagramPost.findFirst({ where: { task_id: taskId, account: { project_id: { in: ids } } }, include });
  if (!post) throw new HttpError("Postagem não encontrada.", 404);
  return shape(post);
}

export interface PostInput {
  /** Projeto (cliente) cuja conta do Instagram vai publicar. */
  project_id: number;
  title?: string | null;
  caption?: string | null;
  media: string[];
  /** ISO. Ausente/passado = publicar agora. */
  scheduled_at?: string | null;
  automation?: AutomationInput | null;
}

async function validateMedia(media: unknown): Promise<string[]> {
  await getConfig(); // garante a URL pública carregada
  if (!Array.isArray(media) || media.length === 0) throw new HttpError("Adicione ao menos uma mídia.");
  if (media.length > 10) throw new HttpError("O Instagram aceita no máximo 10 mídias por carrossel.");
  const urls = media.map((m) => String(m));
  urls.forEach((u) => {
    try {
      assertPublicMediaUrl(absoluteMediaUrl(u));
    } catch (e: any) {
      throw new HttpError(e.message);
    }
  });
  return urls;
}

async function syncTaskFields(post: PostBase) {
  if (!post.task_id) return;
  const when = post.scheduled_at ? brt(post.scheduled_at) : null;
  await prisma.task.update({
    where: { id: post.task_id },
    data: {
      title: taskTitle(post.title, post.caption),
      description: post.caption ?? "",
      due_at: post.scheduled_at ?? undefined,
      hour_at: when?.hour,
    },
  });
}

export async function createPost(userId: number, input: PostInput) {
  const acc = await requireAccount(userId, Number(input.project_id));
  const media = await validateMedia(input.media);
  const now = new Date();
  const when = input.scheduled_at ? new Date(input.scheduled_at) : null;
  if (when && isNaN(when.getTime())) throw new HttpError("Data de agendamento inválida.");
  const publishNow = !when || when.getTime() <= now.getTime() + 30_000;
  const scheduledAt = publishNow ? now : when!;

  let automationId: number | null = null;
  if (input.automation) automationId = (await createAutomationDraft(userId, acc.id, input.automation, { post_image: media[0], post_caption: input.caption ?? null })).id;

  const stamp = brt(scheduledAt);
  const task = await createTask(
    { title: taskTitle(input.title, input.caption), description: input.caption ?? "", user_id: userId, due_at: stamp.date, hour_at: stamp.hour },
    userId
  );
  if (!task) throw new HttpError("Não foi possível criar o item na agenda.", 500);
  await prisma.task.update({ where: { id: task.id }, data: { template: TASK_TEMPLATE } });

  const post = await prisma.instagramPost.create({
    data: {
      account_id: acc.id,
      user_id: userId,
      task_id: task.id,
      title: input.title?.trim() || null,
      caption: input.caption ?? "",
      media: JSON.stringify(media),
      status: "scheduled",
      scheduled_at: scheduledAt,
      automation_id: automationId,
    },
    include,
  });
  emitAll("task_created", { ...task, template: TASK_TEMPLATE });

  if (publishNow) void publishPost(post.id);
  return shape(publishNow ? { ...post, status: "publishing" } : post);
}

export async function updatePost(userId: number, id: number, input: Partial<Omit<PostInput, "project_id" | "automation">>) {
  const post = await owned(userId, id);
  if (!["scheduled", "failed"].includes(post.status)) throw new HttpError("Só é possível editar postagens agendadas ou com falha.");
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title?.trim() || null;
  if (input.caption !== undefined) data.caption = input.caption ?? "";
  if (input.media !== undefined) data.media = JSON.stringify(await validateMedia(input.media));
  if (input.scheduled_at) {
    const when = new Date(input.scheduled_at);
    if (isNaN(when.getTime())) throw new HttpError("Data de agendamento inválida.");
    data.scheduled_at = when;
  }
  if (post.status === "failed") Object.assign(data, { status: "scheduled", attempts: 0, error: null });
  const updated = await prisma.instagramPost.update({ where: { id }, data, include });
  await syncTaskFields(updated);
  return shape(updated);
}

export async function deletePost(userId: number, id: number) {
  const post = await owned(userId, id);
  if (post.status === "publishing") throw new HttpError("A postagem está sendo publicada agora.");
  await prisma.instagramPost.delete({ where: { id } });
  if (post.task_id) await prisma.task.update({ where: { id: post.task_id }, data: { deleted_at: new Date() } }).catch(() => {});
  if (post.automation_id && post.status !== "published") {
    // Automação criada junto com um post que nunca saiu não tem mais a que se ligar.
    await prisma.instagramAutomation.deleteMany({ where: { id: post.automation_id, ig_media_id: null } });
  }
  return { success: true };
}

export async function publishNow(userId: number, id: number) {
  const post = await owned(userId, id);
  if (post.status === "published") throw new HttpError("Esta postagem já foi publicada.");
  if (post.status === "publishing") throw new HttpError("A postagem já está sendo publicada.");
  await prisma.instagramPost.update({ where: { id }, data: { attempts: 0, error: null } });
  void publishPost(id);
  return shape({ ...post, status: "publishing" });
}

/** Publica um post (reivindica atomicamente para nunca publicar duas vezes). */
export async function publishPost(id: number): Promise<void> {
  const claim = await prisma.instagramPost.updateMany({ where: { id, status: { in: ["scheduled", "failed"] } }, data: { status: "publishing", error: null } });
  if (claim.count === 0) return;
  const post = await prisma.instagramPost.findUniqueOrThrow({ where: { id } });

  try {
    const acc = await accountTokenById(post.account_id);
    const result = await publishMedia({ token: acc.token, igUserId: acc.ig_user_id, caption: post.caption ?? "", mediaUrls: parseMedia(post.media) });
    await prisma.instagramPost.update({
      where: { id },
      data: { status: "published", published_at: new Date(), ig_media_id: result.id, permalink: result.permalink, attempts: post.attempts + 1, error: null },
    });
    if (post.automation_id) {
      await prisma.instagramAutomation.updateMany({ where: { id: post.automation_id }, data: { ig_media_id: result.id, status: "active" } });
    }
    if (post.task_id) {
      await prisma.task
        .update({ where: { id: post.task_id }, data: { status: "done", closed_at: new Date(), end_at: new Date(), description: `${post.caption ?? ""}\n\n✅ Publicado: ${result.permalink ?? ""}`.trim() } })
        .catch(() => {});
      emitAll("task_updated", { id: post.task_id });
    }
    await notifyUser(post.user_id, {
      type: "instagram_post",
      title: "Postagem publicada no Instagram",
      body: post.title || (post.caption ?? "").slice(0, 80) || "Sua postagem foi publicada.",
      link: "/instagram",
      metadata: { postId: id },
    }).catch(() => {});
  } catch (err: any) {
    const attempts = post.attempts + 1;
    const final = attempts >= MAX_ATTEMPTS;
    await prisma.instagramPost.update({
      where: { id },
      data: { status: final ? "failed" : "scheduled", attempts, error: String(err?.message ?? err).slice(0, 1000) },
    });
    console.error(`[instagram] falha ao publicar o post ${id} (tentativa ${attempts}/${MAX_ATTEMPTS}):`, err?.message ?? err);
    if (final) {
      await notifyUser(post.user_id, {
        type: "instagram_post",
        title: "Falha ao publicar no Instagram",
        body: String(err?.message ?? "Erro desconhecido").slice(0, 160),
        link: "/instagram",
        metadata: { postId: id },
      }).catch(() => {});
    }
  }
}

/** Chamado pelo worker a cada minuto: publica o que já venceu. */
export async function runDuePosts(): Promise<void> {
  const due = await prisma.instagramPost.findMany({
    where: { status: "scheduled", scheduled_at: { lte: new Date() }, account: { connected: true } },
    orderBy: { scheduled_at: "asc" },
    take: 20,
    select: { id: true },
  });
  for (const p of due) await publishPost(p.id);
}

/** Uma publicação interrompida por reinício pode ter saído no Instagram: não repete, pede conferência. */
export async function sweepStuckPosts(): Promise<void> {
  await prisma.instagramPost.updateMany({
    where: { status: "publishing" },
    data: { status: "failed", error: "Publicação interrompida por reinício do servidor. Confira no Instagram antes de tentar de novo." },
  });
}

// ─── Ganchos da agenda (task.service) ───────────────────────────────────────────

/** Tarefa editada/movida no calendário → reagenda o post. */
export async function onTaskChanged(task: { id: number; template?: string | null; due_at?: Date | null; title?: string | null }): Promise<void> {
  if (task.template !== TASK_TEMPLATE) return;
  const post = await prisma.instagramPost.findUnique({ where: { task_id: task.id } });
  if (!post || !["scheduled", "failed"].includes(post.status)) return;
  if (!task.due_at) return;
  const changed = post.scheduled_at?.getTime() !== task.due_at.getTime();
  if (!changed) return;
  await prisma.instagramPost.update({
    where: { id: post.id },
    data: { scheduled_at: task.due_at, ...(post.status === "failed" ? { status: "scheduled", attempts: 0, error: null } : {}) },
  });
}

/** Tarefa excluída na agenda → cancela o post que ainda não saiu. */
export async function onTaskDeleted(taskId: number): Promise<void> {
  const post = await prisma.instagramPost.findUnique({ where: { task_id: taskId } });
  if (!post) return;
  if (post.status === "published") {
    await prisma.instagramPost.update({ where: { id: post.id }, data: { task_id: null } });
    return;
  }
  if (post.status === "publishing") return;
  await prisma.instagramPost.delete({ where: { id: post.id } });
  if (post.automation_id) await prisma.instagramAutomation.deleteMany({ where: { id: post.automation_id, ig_media_id: null } });
}
