/** "Engajar": automações de comentário → resposta pública (IA) + DM com link. Pertencem à conta (projeto). */
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { memberProjectIds, requireAccount } from "./account.service";

export interface AutomationInput {
  /** Projeto (cliente) dono da conta. */
  project_id?: number;
  title?: string | null;
  /** Post já publicado no Instagram. Vazio quando a automação nasce junto de um post agendado. */
  ig_media_id?: string | null;
  post_image?: string | null;
  post_caption?: string | null;
  keywords: string[];
  reply_text?: string | null;
  ai_reply?: boolean;
  dm_text?: string | null;
  cta_text?: string | null;
  cta_link?: string | null;
  status?: "active" | "paused";
}

const parseKeywords = (raw: string | null): string[] => {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function normalizeInput(input: AutomationInput) {
  const keywords = (input.keywords ?? []).map((k) => String(k).trim()).filter(Boolean);
  if (keywords.length === 0) throw new HttpError("Informe ao menos uma palavra-chave.");
  const dm = input.dm_text?.trim() || null;
  const reply = input.reply_text?.trim() || null;
  const aiReply = input.ai_reply ?? true;
  if (!dm && !reply && !aiReply) throw new HttpError("Configure uma resposta pública (IA ou texto) e/ou uma mensagem direta.");
  const cta = input.cta_text?.trim() || null;
  const link = input.cta_link?.trim() || null;
  if ((cta && !link) || (!cta && link)) throw new HttpError("O botão da DM precisa de texto e link.");
  if (link && !/^https?:\/\//i.test(link)) throw new HttpError("O link do botão deve começar com http:// ou https://.");
  return { keywords: JSON.stringify(keywords), dm_text: dm, reply_text: reply, ai_reply: aiReply, cta_text: cta, cta_link: link };
}

const defaultTitle = (input: AutomationInput) => input.title?.trim() || `Automação — ${(input.keywords?.[0] ?? "comentários").toString().slice(0, 40)}`;

const include = {
  account: { select: { project_id: true, username: true, project: { select: { name: true, color: true } } } },
  posts: { select: { id: true, scheduled_at: true, status: true }, take: 1 },
} as const;

type Row = NonNullable<Awaited<ReturnType<typeof prisma.instagramAutomation.findFirst<{ include: typeof include }>>>>;

function shape(a: Row, counts?: Record<string, number>) {
  const p = a.posts[0];
  const waiting = !a.ig_media_id ? (p && p.status !== "published" ? { id: p.id, scheduled_at: p.scheduled_at } : true) : null;
  return {
    id: a.id,
    project: { id: a.account.project_id, name: a.account.project.name ?? `Projeto ${a.account.project_id}`, color: a.account.project.color, username: a.account.username },
    title: a.title,
    status: a.status,
    ig_media_id: a.ig_media_id,
    post_image: a.post_image,
    post_caption: a.post_caption,
    keywords: parseKeywords(a.keywords),
    reply_text: a.reply_text ?? "",
    ai_reply: a.ai_reply,
    dm_text: a.dm_text ?? "",
    cta_text: a.cta_text ?? "",
    cta_link: a.cta_link ?? "",
    waiting_post: waiting,
    stats: { comments: counts?.COMMENT ?? 0, replies: counts?.REPLY ?? 0, dms: counts?.DM ?? 0 },
    created_at: a.created_at,
  };
}

/** Cria já ligada à conta; usada junto de um post agendado (ativa quando o post sai). */
export async function createAutomationDraft(userId: number, accountId: number, input: AutomationInput, post: { post_image: string | null; post_caption: string | null }) {
  return prisma.instagramAutomation.create({
    data: { account_id: accountId, user_id: userId, title: defaultTitle(input), status: "paused", ig_media_id: null, post_image: post.post_image, post_caption: post.post_caption, ...normalizeInput(input) },
  });
}

async function owned(userId: number, id: number) {
  const ids = await memberProjectIds(userId);
  const a = await prisma.instagramAutomation.findFirst({ where: { id, account: { project_id: { in: ids } } }, include });
  if (!a) throw new HttpError("Automação não encontrada.", 404);
  return a;
}

export async function listAutomations(userId: number, projectId?: number) {
  const ids = await memberProjectIds(userId);
  const scope = projectId ? ids.filter((i) => i === projectId) : ids;
  const rows = await prisma.instagramAutomation.findMany({ where: { account: { project_id: { in: scope } } }, orderBy: { id: "desc" }, include });
  const grouped = await prisma.instagramEngagement.groupBy({ by: ["automation_id", "type"], where: { automation_id: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  const counts = new Map<number, Record<string, number>>();
  for (const g of grouped) counts.set(g.automation_id, { ...(counts.get(g.automation_id) ?? {}), [g.type]: g._count._all });
  return rows.map((r) => shape(r, counts.get(r.id)));
}

async function assertMediaFree(accountId: number, mediaId: string, exceptId?: number) {
  const clash = await prisma.instagramAutomation.findFirst({ where: { account_id: accountId, ig_media_id: mediaId, status: "active", ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw new HttpError(`Já existe uma automação ativa para este post ("${clash.title}"). Pause-a antes de criar outra.`);
}

export async function createAutomation(userId: number, input: AutomationInput) {
  if (!input.ig_media_id) throw new HttpError("Selecione o post do Instagram.");
  const acc = await requireAccount(userId, Number(input.project_id));
  const status = input.status ?? "active";
  if (status === "active") await assertMediaFree(acc.id, input.ig_media_id);
  const a = await prisma.instagramAutomation.create({
    data: { account_id: acc.id, user_id: userId, title: defaultTitle(input), status, ig_media_id: input.ig_media_id, post_image: input.post_image ?? null, post_caption: input.post_caption ?? null, ...normalizeInput(input) },
    include,
  });
  return shape(a);
}

export async function updateAutomation(userId: number, id: number, input: Partial<AutomationInput>) {
  const current = await owned(userId, id);
  const merged: AutomationInput = {
    keywords: input.keywords ?? parseKeywords(current.keywords),
    reply_text: input.reply_text !== undefined ? input.reply_text : current.reply_text,
    ai_reply: input.ai_reply ?? current.ai_reply,
    dm_text: input.dm_text !== undefined ? input.dm_text : current.dm_text,
    cta_text: input.cta_text !== undefined ? input.cta_text : current.cta_text,
    cta_link: input.cta_link !== undefined ? input.cta_link : current.cta_link,
  };
  const status = input.status ?? (current.status as "active" | "paused");
  if (status === "active") {
    await requireAccount(userId, current.account.project_id); // não ativa com a conta desconectada
    if (current.ig_media_id) await assertMediaFree(current.account_id, current.ig_media_id, id);
  }
  const a = await prisma.instagramAutomation.update({
    where: { id },
    data: { title: input.title?.trim() || current.title, status, ...normalizeInput(merged) },
    include,
  });
  return shape(a);
}

export async function removeAutomation(userId: number, id: number) {
  await owned(userId, id);
  await prisma.instagramAutomation.delete({ where: { id } });
  return { success: true };
}

export async function listEngagements(userId: number, id: number) {
  await owned(userId, id);
  return prisma.instagramEngagement.findMany({ where: { automation_id: id }, orderBy: { id: "desc" }, take: 100 });
}

/** Resumo para o topo da aba (totais das automações do projeto — ou de todos, se omitido). */
export async function summary(userId: number, projectId?: number) {
  const ids = await memberProjectIds(userId);
  const scope = projectId ? ids.filter((i) => i === projectId) : ids;
  const where = { account: { project_id: { in: scope } } };
  const rows = await prisma.instagramEngagement.groupBy({ by: ["type"], where: { automation: where }, _count: { _all: true } });
  const by = Object.fromEntries(rows.map((r) => [r.type, r._count._all]));
  const active = await prisma.instagramAutomation.count({ where: { ...where, status: "active" } });
  return { active, comments: by.COMMENT ?? 0, replies: by.REPLY ?? 0, dms: by.DM ?? 0 };
}
