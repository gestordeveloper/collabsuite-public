/**
 * Postagens de vídeo no YouTube (Shorts / vídeo normal) e no TikTok. Mesmo modelo do Instagram: cada post tem uma
 * Task ligada (template "social_post") que aparece no calendário (/agenda); mover/excluir lá reflete aqui.
 * Postar em várias redes de uma vez cria uma linha por rede (mesmo group_id).
 */
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { emitAll } from "../../lib/socket";
import { createTask, BRAZIL_OFFSET_MS } from "../task.service";
import { notifyUser } from "../notification.service";
import { memberProjectIds, requireAccount, validAccessToken } from "./account.service";
import { PLATFORM_LABEL, type Platform } from "./config.service";
import { PlatformError } from "./errors";
import { isVideoUrl, openMedia } from "./media";
import * as youtube from "./youtube";
import * as tiktok from "./tiktok";

export const TASK_TEMPLATE = "social_post";
const MAX_ATTEMPTS = 3;
const pad = (n: number) => String(n).padStart(2, "0");

export type SocialKind = "youtube_short" | "youtube_video" | "tiktok";
export const KINDS: SocialKind[] = ["youtube_short", "youtube_video", "tiktok"];
export const platformOf = (kind: SocialKind): Platform => (kind === "tiktok" ? "tiktok" : "youtube");
const KIND_LABEL: Record<SocialKind, string> = { youtube_short: "YouTube Shorts", youtube_video: "YouTube", tiktok: "TikTok" };
const KIND_EMOJI: Record<SocialKind, string> = { youtube_short: "▶️", youtube_video: "▶️", tiktok: "🎵" };

export interface YoutubeOptions {
  privacy: "public" | "unlisted" | "private";
  tags: string[];
  category_id: string;
  made_for_kids: boolean;
}
export interface TiktokOptions {
  mode: "direct" | "draft";
  privacy_level: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
}
type Options = Partial<YoutubeOptions & TiktokOptions>;

function brt(instant: Date) {
  const l = new Date(instant.getTime() - BRAZIL_OFFSET_MS);
  return { date: `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`, hour: `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}` };
}

const taskTitle = (kind: SocialKind, title: string | null | undefined, caption: string | null | undefined) => {
  const base = (title || caption || "Vídeo").replace(/\s+/g, " ").trim();
  return `${KIND_EMOJI[kind]} ${KIND_LABEL[kind]}: ${base.length > 60 ? `${base.slice(0, 57)}…` : base}`;
};

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** Opções com valores seguros por padrão (e só as que valem para a rede do post). */
export function normalizeOptions(kind: SocialKind, raw: any): Options {
  const o = raw && typeof raw === "object" ? raw : {};
  if (kind === "tiktok") {
    return {
      mode: o.mode === "draft" ? "draft" : "direct",
      privacy_level: typeof o.privacy_level === "string" && o.privacy_level ? o.privacy_level : "SELF_ONLY",
      disable_comment: !!o.disable_comment,
      disable_duet: !!o.disable_duet,
      disable_stitch: !!o.disable_stitch,
    };
  }
  const tags = (Array.isArray(o.tags) ? o.tags : typeof o.tags === "string" ? o.tags.split(",") : [])
    .map((t: unknown) => String(t).trim().replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 15);
  return {
    privacy: ["public", "unlisted", "private"].includes(o.privacy) ? o.privacy : "public",
    tags,
    category_id: /^\d{1,3}$/.test(String(o.category_id ?? "")) ? String(o.category_id) : "22",
    made_for_kids: !!o.made_for_kids,
  };
}

const include = {
  account: { select: { project_id: true, platform: true, username: true, project: { select: { name: true, color: true } } } },
} as const;

type PostRow = NonNullable<Awaited<ReturnType<typeof prisma.socialPost.findFirst<{ include: typeof include }>>>>;
type PostBase = NonNullable<Awaited<ReturnType<typeof prisma.socialPost.findFirst>>>;

function shape(p: PostRow) {
  return {
    id: p.id,
    kind: p.kind as SocialKind,
    platform: p.account.platform as Platform,
    group_id: p.group_id,
    project: { id: p.account.project_id, name: p.account.project.name ?? `Projeto ${p.account.project_id}`, color: p.account.project.color, username: p.account.username },
    task_id: p.task_id,
    title: p.title,
    caption: p.caption ?? "",
    media: parseJson<string[]>(p.media, []),
    options: parseJson<Options>(p.options, {}),
    status: p.status,
    scheduled_at: p.scheduled_at,
    published_at: p.published_at,
    external_id: p.external_id,
    permalink: p.permalink,
    note: p.note,
    attempts: p.attempts,
    error: p.error,
    created_at: p.created_at,
  };
}

async function owned(userId: number, id: number) {
  const ids = await memberProjectIds(userId);
  const post = await prisma.socialPost.findFirst({ where: { id, account: { project_id: { in: ids } } }, include });
  if (!post) throw new HttpError("Postagem não encontrada.", 404);
  return post;
}

export async function listPosts(userId: number, projectId?: number) {
  const ids = await memberProjectIds(userId);
  const scope = projectId ? ids.filter((i) => i === projectId) : ids;
  const rows = await prisma.socialPost.findMany({ where: { account: { project_id: { in: scope } } }, include, orderBy: [{ scheduled_at: "desc" }, { id: "desc" }], take: 300 });
  return rows.map(shape);
}

export async function getPostByTask(userId: number, taskId: number) {
  const ids = await memberProjectIds(userId);
  const post = await prisma.socialPost.findFirst({ where: { task_id: taskId, account: { project_id: { in: ids } } }, include });
  if (!post) throw new HttpError("Postagem não encontrada.", 404);
  return shape(post);
}

export interface SocialCreateInput {
  project_id: number;
  title?: string | null;
  caption?: string | null;
  /** Um único vídeo. */
  media: string[];
  scheduled_at?: string | null;
  targets: { kind: SocialKind; options?: unknown }[];
}

function validateMedia(media: unknown): string[] {
  if (!Array.isArray(media) || media.length !== 1) throw new HttpError("YouTube e TikTok publicam um único vídeo por postagem.");
  const url = String(media[0]);
  if (!isVideoUrl(url)) throw new HttpError("Envie um vídeo (MP4, MOV ou WEBM) para publicar no YouTube / TikTok.");
  return [url];
}

function validateText(kind: SocialKind, title: string | null, caption: string) {
  if (kind === "tiktok") {
    if ((caption || title || "").length > 2200) throw new HttpError("A legenda do TikTok pode ter no máximo 2200 caracteres.");
    return;
  }
  const t = youtubeTitle(title, caption);
  if (!t) throw new HttpError("O YouTube exige um título: preencha o título (ou a legenda).");
  if (caption.length > 5000) throw new HttpError("A descrição do YouTube pode ter no máximo 5000 caracteres.");
}

/** Título do YouTube: o título informado ou a primeira linha da legenda, até 100 caracteres e sem < >. */
function youtubeTitle(title: string | null | undefined, caption: string | null | undefined): string {
  const base = (title?.trim() || (caption ?? "").split("\n")[0] || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return base.length > 100 ? `${base.slice(0, 97)}…` : base;
}

async function syncTaskFields(post: PostBase) {
  if (!post.task_id) return;
  const when = post.scheduled_at ? brt(post.scheduled_at) : null;
  await prisma.task.update({
    where: { id: post.task_id },
    data: { title: taskTitle(post.kind as SocialKind, post.title, post.caption), description: post.caption ?? "", due_at: post.scheduled_at ?? undefined, hour_at: when?.hour },
  });
}

export async function createPosts(userId: number, input: SocialCreateInput) {
  const targets = Array.isArray(input.targets) ? input.targets : [];
  if (targets.length === 0) throw new HttpError("Escolha ao menos uma rede.");
  const kinds = new Set<SocialKind>();
  for (const t of targets) {
    if (!KINDS.includes(t.kind)) throw new HttpError("Rede inválida.");
    if (kinds.has(t.kind)) throw new HttpError("Rede repetida.");
    kinds.add(t.kind);
  }
  const media = validateMedia(input.media);
  const title = input.title?.trim() || null;
  const caption = input.caption ?? "";
  const now = new Date();
  const when = input.scheduled_at ? new Date(input.scheduled_at) : null;
  if (when && isNaN(when.getTime())) throw new HttpError("Data de agendamento inválida.");
  const publishNow = !when || when.getTime() <= now.getTime() + 30_000;
  const scheduledAt = publishNow ? now : when!;

  // Valida tudo antes de criar qualquer coisa: não deixa uma rede criada e a outra não.
  const accounts = new Map<SocialKind, Awaited<ReturnType<typeof requireAccount>>>();
  for (const t of targets) {
    validateText(t.kind, title, caption);
    accounts.set(t.kind, await requireAccount(userId, Number(input.project_id), platformOf(t.kind)));
  }

  const groupId = crypto.randomBytes(10).toString("hex");
  const stamp = brt(scheduledAt);
  const created: PostRow[] = [];
  for (const t of targets) {
    const task = await createTask({ title: taskTitle(t.kind, title, caption), description: caption, user_id: userId, due_at: stamp.date, hour_at: stamp.hour }, userId);
    if (!task) throw new HttpError("Não foi possível criar o item na agenda.", 500);
    await prisma.task.update({ where: { id: task.id }, data: { template: TASK_TEMPLATE } });
    const post = await prisma.socialPost.create({
      data: {
        account_id: accounts.get(t.kind)!.id,
        user_id: userId,
        task_id: task.id,
        group_id: groupId,
        kind: t.kind,
        title,
        caption,
        media: JSON.stringify(media),
        options: JSON.stringify(normalizeOptions(t.kind, t.options)),
        status: "scheduled",
        scheduled_at: scheduledAt,
      },
      include,
    });
    emitAll("task_created", { ...task, template: TASK_TEMPLATE });
    created.push(post);
  }
  if (publishNow) for (const p of created) void publishPost(p.id);
  return created.map((p) => shape(publishNow ? { ...p, status: "publishing" } : p));
}

export async function updatePost(userId: number, id: number, input: { title?: string | null; caption?: string | null; media?: string[]; scheduled_at?: string | null; options?: unknown }) {
  const post = await owned(userId, id);
  if (!["scheduled", "failed"].includes(post.status)) throw new HttpError("Só é possível editar postagens agendadas ou com falha.");
  const kind = post.kind as SocialKind;
  const data: Record<string, unknown> = {};
  const title = input.title !== undefined ? input.title?.trim() || null : post.title;
  const caption = input.caption !== undefined ? input.caption ?? "" : post.caption ?? "";
  validateText(kind, title, caption);
  if (input.title !== undefined) data.title = title;
  if (input.caption !== undefined) data.caption = caption;
  if (input.media !== undefined) data.media = JSON.stringify(validateMedia(input.media));
  if (input.options !== undefined) data.options = JSON.stringify(normalizeOptions(kind, { ...parseJson(post.options, {}), ...(input.options as object) }));
  if (input.scheduled_at) {
    const when = new Date(input.scheduled_at);
    if (isNaN(when.getTime())) throw new HttpError("Data de agendamento inválida.");
    data.scheduled_at = when;
  }
  if (post.status === "failed") Object.assign(data, { status: "scheduled", attempts: 0, error: null });
  const updated = await prisma.socialPost.update({ where: { id }, data, include });
  await syncTaskFields(updated);
  return shape(updated);
}

export async function deletePost(userId: number, id: number) {
  const post = await owned(userId, id);
  if (post.status === "publishing") throw new HttpError("A postagem está sendo publicada agora.");
  await prisma.socialPost.delete({ where: { id } });
  if (post.task_id) await prisma.task.update({ where: { id: post.task_id }, data: { deleted_at: new Date() } }).catch(() => {});
  return { success: true };
}

export async function publishNow(userId: number, id: number) {
  const post = await owned(userId, id);
  if (post.status === "published") throw new HttpError("Esta postagem já foi publicada.");
  if (post.status === "publishing") throw new HttpError("A postagem já está sendo publicada.");
  await prisma.socialPost.update({ where: { id }, data: { attempts: 0, error: null } });
  void publishPost(id);
  return shape({ ...post, status: "publishing" });
}

interface Result {
  externalId: string;
  permalink: string | null;
  note: string | null;
}

async function publishToYoutube(post: PostBase, accessToken: string): Promise<Result> {
  const kind = post.kind as SocialKind;
  const o = normalizeOptions(kind, parseJson(post.options, {})) as YoutubeOptions;
  let description = post.caption ?? "";
  // O YouTube classifica como Short um vídeo vertical de até 3 min; a hashtag ajuda e deixa a intenção explícita.
  if (kind === "youtube_short" && !/#shorts\b/i.test(`${post.title ?? ""} ${description}`)) description = `${description}${description ? "\n\n" : ""}#Shorts`;
  const file = await openMedia(JSON.parse(post.media)[0]);
  try {
    const { id } = await youtube.uploadVideo({
      accessToken,
      file,
      title: youtubeTitle(post.title, post.caption),
      description,
      tags: o.tags,
      privacy: o.privacy,
      categoryId: o.category_id,
      madeForKids: o.made_for_kids,
    });
    return {
      externalId: id,
      permalink: kind === "youtube_short" ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
      note: o.privacy === "private" ? "Enviado como privado. Se você escolheu público, o app do Google ainda não foi verificado — veja as instruções de configuração." : null,
    };
  } finally {
    await file.cleanup();
  }
}

async function publishToTiktok(post: PostBase, accessToken: string): Promise<Result> {
  const o = normalizeOptions("tiktok", parseJson(post.options, {})) as TiktokOptions;
  const file = await openMedia(JSON.parse(post.media)[0]);
  try {
    const publishId = await tiktok.publishVideo({
      accessToken,
      file,
      title: (post.caption || post.title || "").slice(0, 2200),
      mode: o.mode,
      privacy: o.privacy_level,
      disableComment: o.disable_comment,
      disableDuet: o.disable_duet,
      disableStitch: o.disable_stitch,
    });
    const out = await tiktok.waitForPublish(accessToken, publishId);
    let note: string | null = null;
    if (out.state === "inbox") note = "Enviado para os rascunhos do TikTok — abra o app para revisar e publicar.";
    else if (out.state === "processing") note = "O TikTok ainda está processando o vídeo. Confira no app em alguns minutos.";
    else if (o.privacy_level === "SELF_ONLY") note = "Publicado como privado (\"Só eu\"). Para postar público, o app precisa passar na auditoria do TikTok.";
    return { externalId: out.postId ?? publishId, permalink: out.postId ? `https://www.tiktok.com/@/video/${out.postId}` : null, note };
  } finally {
    await file.cleanup();
  }
}

/** Publica um post (reivindica atomicamente para nunca publicar duas vezes). */
export async function publishPost(id: number): Promise<void> {
  const claim = await prisma.socialPost.updateMany({ where: { id, status: { in: ["scheduled", "failed"] } }, data: { status: "publishing", error: null } });
  if (claim.count === 0) return;
  const post = await prisma.socialPost.findUniqueOrThrow({ where: { id } });
  const kind = post.kind as SocialKind;
  const label = KIND_LABEL[kind];

  try {
    const acc = await validAccessToken(post.account_id);
    const result = kind === "tiktok" ? await publishToTiktok(post, acc.token) : await publishToYoutube(post, acc.token);
    await prisma.socialPost.update({
      where: { id },
      data: { status: "published", published_at: new Date(), external_id: result.externalId, permalink: result.permalink, note: result.note?.slice(0, 300) ?? null, attempts: post.attempts + 1, error: null },
    });
    if (post.task_id) {
      await prisma.task
        .update({ where: { id: post.task_id }, data: { status: "done", closed_at: new Date(), end_at: new Date(), description: `${post.caption ?? ""}\n\n✅ Publicado: ${result.permalink ?? label}`.trim() } })
        .catch(() => {});
      emitAll("task_updated", { id: post.task_id });
    }
    await notifyUser(post.user_id, {
      type: "instagram_post",
      title: `Postagem publicada no ${label}`,
      body: post.title || (post.caption ?? "").slice(0, 80) || "Seu vídeo foi publicado.",
      link: "/instagram",
      metadata: { socialPostId: id },
    }).catch(() => {});
  } catch (err: any) {
    const retryable = err instanceof PlatformError ? err.retryable : true;
    const attempts = post.attempts + 1;
    const final = !retryable || attempts >= MAX_ATTEMPTS;
    const message = String(err?.message ?? err).slice(0, 1000);
    await prisma.socialPost.update({ where: { id }, data: { status: final ? "failed" : "scheduled", attempts, error: message } });
    console.error(`[social] falha ao publicar o post ${id} no ${label} (tentativa ${attempts}/${MAX_ATTEMPTS}):`, message);
    if (final) {
      await notifyUser(post.user_id, {
        type: "instagram_post",
        title: `Falha ao publicar no ${label}`,
        body: message.slice(0, 160),
        link: "/instagram",
        metadata: { socialPostId: id },
      }).catch(() => {});
    }
  }
}

/** Chamado pelo worker a cada minuto: publica o que já venceu. */
export async function runDuePosts(): Promise<void> {
  const due = await prisma.socialPost.findMany({
    where: { status: "scheduled", scheduled_at: { lte: new Date() }, account: { connected: true } },
    orderBy: { scheduled_at: "asc" },
    take: 10,
    select: { id: true },
  });
  for (const p of due) await publishPost(p.id);
}

/** Uma publicação interrompida por reinício pode ter saído na rede: não repete, pede conferência. */
export async function sweepStuckPosts(): Promise<void> {
  await prisma.socialPost.updateMany({
    where: { status: "publishing" },
    data: { status: "failed", error: "Publicação interrompida por reinício do servidor. Confira na rede social antes de tentar de novo." },
  });
}

// ─── Ganchos da agenda (task.service) ───────────────────────────────────────────

export async function onTaskChanged(task: { id: number; template?: string | null; due_at?: Date | null }): Promise<void> {
  if (task.template !== TASK_TEMPLATE) return;
  const post = await prisma.socialPost.findUnique({ where: { task_id: task.id } });
  if (!post || !["scheduled", "failed"].includes(post.status) || !task.due_at) return;
  if (post.scheduled_at?.getTime() === task.due_at.getTime()) return;
  await prisma.socialPost.update({
    where: { id: post.id },
    data: { scheduled_at: task.due_at, ...(post.status === "failed" ? { status: "scheduled", attempts: 0, error: null } : {}) },
  });
}

export async function onTaskDeleted(taskId: number): Promise<void> {
  const post = await prisma.socialPost.findUnique({ where: { task_id: taskId } });
  if (!post) return;
  if (post.status === "published") {
    await prisma.socialPost.update({ where: { id: post.id }, data: { task_id: null } });
    return;
  }
  if (post.status === "publishing") return;
  await prisma.socialPost.delete({ where: { id: post.id } });
}

export { PLATFORM_LABEL };
