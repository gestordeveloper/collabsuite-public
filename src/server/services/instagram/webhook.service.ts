/** Eventos do webhook do Instagram (substitui a fila RabbitMQ do campinsta: processa dentro do servidor). */
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { accountByIgId } from "./account.service";
import { replyToComment, sendCommentDm } from "./graph";
import { resolveCfg, chat } from "../carrossel/aiClient";
import { getConfig } from "./config.service";

export const verifyToken = async () => (await getConfig()).verifyToken;

export async function verifySignature(rawBody: Buffer | undefined, header: string | undefined): Promise<boolean> {
  const secret = (await getConfig()).appSecret;
  if (!secret) return true; // sem segredo configurado não há como validar (só em desenvolvimento)
  if (!rawBody || !header) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = header.replace(/^sha256=/, "");
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const AI_SYSTEM = (mentionsDm: boolean) => `Você escreve respostas públicas curtas para comentários no Instagram, em português do Brasil.

REGRAS
- Uma única frase, natural, informal, simpática e humana (nunca robótica).
- Sempre DIFERENTE das anteriores: varie estrutura, vocabulário e empolgação (show, top, boa, perfeito, maravilha...).
${mentionsDm ? "- Avise que a mensagem já foi enviada na DM (varie: direct, inbox, mensagem privada, DM).\n" : ""}- Não faça perguntas, não inclua links, não use hashtags.
- Emojis com muita moderação (no máximo um) ou nenhum.
- Nunca mencione automação, IA, sistema, bot ou resposta automática.

SAÍDA: apenas o texto da resposta.`;

async function aiReply(userId: number, companyId: number | null, comment: string, mentionsDm: boolean): Promise<string | null> {
  const cfg = await resolveCfg(userId, companyId);
  if (!cfg) return null;
  const { text } = await chat(cfg, AI_SYSTEM(mentionsDm), [{ role: "user", content: `Comentário recebido: ${comment}` }], 200, { json: false });
  return text.replace(/^["“]|["”]$/g, "").trim() || null;
}

async function record(automationId: number, type: "COMMENT" | "REPLY" | "DM", commentId: string, username: string, text: string, error?: string) {
  // skipDuplicates: a Meta reenvia eventos; a unique (automação, comentário, tipo) garante 1 tratamento só.
  const { count } = await prisma.instagramEngagement.createMany({
    data: [{ automation_id: automationId, type, comment_id: commentId, username, text: text.slice(0, 1000), error: error?.slice(0, 500) ?? null }],
    skipDuplicates: true,
  });
  return count > 0;
}

async function handleComment(igUserId: string, value: any) {
  const commentId = String(value?.id ?? "");
  const mediaId = String(value?.media?.id ?? "");
  const text: string = value?.text ?? "";
  const from = value?.from;
  if (!commentId || !mediaId || !text) return;
  if (String(from?.id ?? "") === igUserId) return; // nossa própria resposta

  const acc = await accountByIgId(igUserId);
  if (!acc) return;

  const automations = await prisma.instagramAutomation.findMany({ where: { account_id: acc.id, status: "active", ig_media_id: mediaId } });
  const hay = fold(text);
  const auto = automations.find((a) => (JSON.parse(a.keywords || "[]") as string[]).some((k) => k.trim() && hay.includes(fold(k))));
  if (!auto) return;

  const username: string = from?.username ?? "";
  if (!(await record(auto.id, "COMMENT", commentId, username, text))) return;

  // A chave de IA usada é a de quem criou a automação (pessoal > empresa).
  const user = await prisma.user.findUnique({ where: { id: auto.user_id }, select: { id: true, company_id: true } });
  const hasDm = !!auto.dm_text?.trim();

  // 1) resposta pública
  let reply: string | null = auto.reply_text?.trim() || null;
  if (auto.ai_reply && user) {
    try {
      reply = (await aiReply(user.id, user.company_id, text, hasDm)) ?? reply;
    } catch (e: any) {
      console.warn("[instagram] resposta por IA falhou, usando o texto fixo:", e.message);
    }
  }
  const sends: Promise<unknown>[] = [];
  if (reply) {
    sends.push(
      replyToComment(acc.token, commentId, username, reply).then(
        () => record(auto.id, "REPLY", commentId, username, reply!),
        (e) => record(auto.id, "REPLY", commentId, username, reply!, e.message)
      )
    );
  }
  // 2) DM privada (com botão de link, se houver CTA)
  if (hasDm) {
    const cta = auto.cta_text && auto.cta_link ? { title: auto.cta_text, url: auto.cta_link } : null;
    sends.push(
      sendCommentDm(acc.token, commentId, auto.dm_text!, cta).then(
        () => record(auto.id, "DM", commentId, username, auto.dm_text!),
        (e) => record(auto.id, "DM", commentId, username, auto.dm_text!, e.message)
      )
    );
  }
  await Promise.all(sends);
}

/** Processa o corpo do webhook. Chamado depois de responder 200 à Meta. */
export async function processPayload(payload: any): Promise<void> {
  if (payload?.object !== "instagram" && payload?.object !== "page") return;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === "comments" || change.field === "live_comments") {
        try {
          await handleComment(String(entry.id), change.value);
        } catch (e) {
          console.error("[instagram] erro ao tratar comentário:", e);
        }
      }
    }
  }
}
