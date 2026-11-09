import crypto from "crypto";
import type { Agent } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { decrypt, encrypt } from "../../lib/encryption";
import { runExclusive } from "../../lib/keyedMutex";
import { isSupportedImageMime } from "../../lib/documentAnalysis";
import type { ChatContentPart, ChatMessageParam } from "../../lib/ai-providers/types";
import { runAgentTurn } from "../agent-run.service";
import { pushAndFlush } from "../agent-channel/buffer";
import { transcribeVoiceNote } from "../agent-channel/media";
import { getSession, saveSession } from "../agent-channel/session.service";
import { logTurn } from "../agent-metrics/metrics.service";
import { notifyUser } from "../notification.service";
import { buildDayOverview, formatBriefing, openAssistantToolset } from "../agent-assistant/assistant.service";
import { dateStrOf, hhmmOf } from "../agent-calendar/calendar.service";
import { toDbDate } from "../habit.service";

/**
 * Canal Telegram do agente = assistente pessoal do dono. Recebe por long polling (getUpdates), então
 * funciona sem URL pública. Só conversam os chats pareados (código de uso único gerado no painel);
 * qualquer outro recebe uma recusa educada. Cada chat pareado age como o usuário que o vinculou.
 */

const TG_MAX = 4000; // limite do Telegram é 4096
const BUFFER_MS = 1500;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const ERROR_REPLY = "Desculpe, tive um problema ao processar sua mensagem. Tente de novo em instantes.";
const jidOf = (chatId: string) => `tg:${chatId}`;

// ─── Cliente da Bot API ─────────────────────────────────────────────────────────

class TelegramApiError extends Error {
  constructor(message: string, public code: number) {
    super(message);
  }
}

async function tg<T = any>(token: string, method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new TelegramApiError(json?.description || `HTTP ${res.status}`, json?.error_code ?? res.status);
  return json.result as T;
}

async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const file = await tg<{ file_path?: string }>(token, "getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Arquivo indisponível no Telegram.");
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`Falha ao baixar o arquivo (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Divide em mensagens de até TG_MAX caracteres, preferindo quebrar em parágrafos/linhas. */
export function splitForTelegram(text: string): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > TG_MAX) {
    let cut = rest.lastIndexOf("\n\n", TG_MAX);
    if (cut < TG_MAX / 2) cut = rest.lastIndexOf("\n", TG_MAX);
    if (cut < TG_MAX / 2) cut = rest.lastIndexOf(" ", TG_MAX);
    if (cut < TG_MAX / 2) cut = TG_MAX;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function send(token: string, chatId: string, text: string) {
  for (const chunk of splitForTelegram(text)) await tg(token, "sendMessage", { chat_id: chatId, text: chunk, disable_web_page_preview: true });
}

// ─── Configuração do bot ────────────────────────────────────────────────────────

const tokenOf = (row: { bot_token: string }) => decrypt(row.bot_token);

export async function getTelegramSettings(agentId: number) {
  const row = await prisma.agentTelegram.findUnique({ where: { agent_id: agentId } });
  const links = await prisma.agentTelegramLink.findMany({ where: { agent_id: agentId }, orderBy: { id: "asc" } });
  return {
    configured: !!row,
    enabled: !!row?.enabled,
    running: pollers.has(agentId),
    bot_username: row?.bot_username ?? null,
    bot_name: row?.bot_name ?? null,
    briefing_enabled: row?.briefing_enabled ?? true,
    briefing_time: row?.briefing_time ?? "08:00",
    links: links.map((l) => ({ id: l.id, chat_id: l.chat_id, display_name: l.display_name, created_at: l.created_at })),
  };
}

export async function saveTelegramSettings(
  agent: Agent,
  patch: { bot_token?: string; enabled?: boolean; briefing_enabled?: boolean; briefing_time?: string }
) {
  const existing = await prisma.agentTelegram.findUnique({ where: { agent_id: agent.id } });
  const data: Record<string, unknown> = {};

  if (patch.bot_token !== undefined && patch.bot_token.trim()) {
    const token = patch.bot_token.trim();
    let me: { username?: string; first_name?: string };
    try {
      me = await tg(token, "getMe");
    } catch {
      throw new HttpError("Token do bot inválido. Copie o token que o @BotFather enviou ao criar o bot.");
    }
    const sameBot = await prisma.agentTelegram.findFirst({ where: { bot_username: me.username ?? "__none__", agent_id: { not: agent.id } }, include: { agent: { select: { name: true } } } });
    if (sameBot) throw new HttpError(`Este bot já está ligado ao agente "${sameBot.agent.name}". Cada bot atende um único agente.`);
    // getUpdates não funciona com webhook configurado.
    await tg(token, "deleteWebhook", { drop_pending_updates: false }).catch(() => {});
    data.bot_token = encrypt(token);
    data.bot_username = me.username ?? null;
    data.bot_name = me.first_name ?? null;
    data.last_update_id = null;
  }
  if (patch.briefing_enabled !== undefined) data.briefing_enabled = !!patch.briefing_enabled;
  if (patch.briefing_time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.briefing_time)) throw new HttpError("Horário do briefing inválido (use HH:MM).");
    data.briefing_time = patch.briefing_time;
  }
  if (patch.enabled !== undefined) {
    if (patch.enabled && !existing && !data.bot_token) throw new HttpError("Informe o token do bot para ativar.");
    data.enabled = !!patch.enabled;
  }

  if (!existing) {
    if (!data.bot_token) throw new HttpError("Informe o token do bot.");
    await prisma.agentTelegram.create({ data: { agent_id: agent.id, bot_token: data.bot_token as string, ...data } as any });
  } else if (Object.keys(data).length) {
    await prisma.agentTelegram.update({ where: { agent_id: agent.id }, data });
  }
  await syncTelegramBot(agent.id);
  return getTelegramSettings(agent.id);
}

export async function removeTelegram(agentId: number) {
  stopPoller(agentId);
  await prisma.agentTelegramLink.deleteMany({ where: { agent_id: agentId } });
  await prisma.agentTelegramPairing.deleteMany({ where: { agent_id: agentId } });
  await prisma.agentTelegram.deleteMany({ where: { agent_id: agentId } });
}

export async function removeLink(agentId: number, linkId: number) {
  await prisma.agentTelegramLink.deleteMany({ where: { id: linkId, agent_id: agentId } });
}

// ─── Pareamento ─────────────────────────────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I

export async function createPairing(agentId: number, userId: number) {
  const row = await prisma.agentTelegram.findUnique({ where: { agent_id: agentId } });
  if (!row) throw new HttpError("Configure o token do bot antes de parear.");
  await prisma.agentTelegramPairing.deleteMany({ where: { agent_id: agentId } });
  const code = Array.from(crypto.randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  const expires = new Date(Date.now() + PAIRING_TTL_MS);
  await prisma.agentTelegramPairing.create({ data: { agent_id: agentId, user_id: userId, code, expires_at: expires } });
  return { code, expires_at: expires, deep_link: row.bot_username ? `https://t.me/${row.bot_username}?start=${code}` : null };
}

/** O pareamento libera a agenda do dono para o agente, para as ferramentas de agenda funcionarem de imediato. */
async function redeemPairing(agent: Agent, chatId: string, displayName: string | null, code: string): Promise<boolean> {
  const pairing = await prisma.agentTelegramPairing.findFirst({ where: { agent_id: agent.id, code: code.toUpperCase(), expires_at: { gt: new Date() } } });
  if (!pairing) return false;
  await prisma.agentTelegramLink.upsert({
    where: { agent_id_chat_id: { agent_id: agent.id, chat_id: chatId } },
    create: { agent_id: agent.id, user_id: pairing.user_id, chat_id: chatId, display_name: displayName },
    update: { user_id: pairing.user_id, display_name: displayName },
  });
  await prisma.agentTelegramPairing.deleteMany({ where: { agent_id: agent.id } });
  await prisma.agentCalendarAccess.upsert({
    where: { agent_id_user_id: { agent_id: agent.id, user_id: pairing.user_id } },
    create: { agent_id: agent.id, user_id: pairing.user_id, can_write: true, enforce_availability: false },
    update: {},
  });
  return true;
}

// ─── Mensagens ──────────────────────────────────────────────────────────────────

interface TgInput {
  text: string;
  media?: "audio" | "image";
  image?: { mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };
}

const HELP = `Eu sou seu assistente pessoal. Peça em linguagem natural (texto ou áudio), por exemplo:
• "O que tenho hoje?"
• "Marca reunião com a Ana amanhã às 15h"
• "Me lembra de ligar pro João às 17h"
• "Cria a tarefa revisar proposta para sexta"
• "Marquei a meditação"

Comandos: /resumo (briefing do dia), /limpar (esquece a conversa), /ajuda.`;

async function typingWhile<T>(token: string, chatId: string, work: () => Promise<T>): Promise<T> {
  const ping = () => void tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  ping();
  const timer = setInterval(ping, 4000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

async function processTurn(agentId: number, chatId: string, name: string | null, inputs: TgInput[]) {
  const startedAt = Date.now();
  const agent = await prisma.agent.findFirst({ where: { id: agentId, is_active: true } });
  const bot = await prisma.agentTelegram.findUnique({ where: { agent_id: agentId } });
  const link = await prisma.agentTelegramLink.findUnique({ where: { agent_id_chat_id: { agent_id: agentId, chat_id: chatId } } });
  if (!agent || !bot?.enabled || !link) return;
  const token = tokenOf(bot);
  const jid = jidOf(chatId);
  const base = { agentId, channel: "telegram", contactJid: jid, messagesIn: inputs.length, media: inputs.flatMap((i) => (i.media ? [i.media] : [])) };

  const user = await prisma.user.findUnique({ where: { id: link.user_id }, select: { first_name: true } });
  const { history } = await getSession(agent.id, jid);
  const userText = inputs.map((i) => i.text).join("\n");
  const images = inputs.flatMap((i) => (i.image ? [i.image] : []));
  const content: ChatMessageParam["content"] = images.length
    ? [{ type: "text", text: userText } as ChatContentPart, ...images.map((im) => ({ type: "image", ...im }) as ChatContentPart)]
    : userText;
  const messages: ChatMessageParam[] = [...history.map((h) => ({ role: h.role, content: h.content })), { role: "user", content }];

  const assistant = openAssistantToolset({ agentId: agent.id, userId: link.user_id, chatId, userName: user?.first_name ?? name ?? "o usuário" });
  try {
    const result = await typingWhile(token, chatId, () =>
      runAgentTurn(
        { ...agent, system_prompt: `Seu nome é ${agent.name}.\n\n${agent.system_prompt}\n\n${assistant.promptNote}` },
        messages,
        { userId: link.user_id, companyId: agent.company_id, extraTools: assistant, channel: "telegram", contactJid: jid, contactName: name }
      )
    );
    const output = result.text.trim();
    if (!output) {
      await logTurn({ ...base, status: "error", error: "O modelo não devolveu texto.", agentMs: Date.now() - startedAt });
      return;
    }
    const stored = images.length ? `${userText}\n[${images.length} imagem(ns) enviada(s)]` : userText;
    await saveSession(agent.id, jid, name, [...history, { role: "user", content: stored }, { role: "assistant", content: output }], agent.session_ttl_seconds);
    await send(token, chatId, output);
    await logTurn({
      ...base,
      status: "ok",
      agentMs: Date.now() - startedAt,
      waitMs: Date.now() - startedAt,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      toolNames: result.toolCallLog.map((t) => t.tool),
      usedRag: result.usedRag,
    });
  } catch (err: any) {
    console.error(`[telegram] Erro do agente ${agent.id}:`, err?.message || err);
    await logTurn({ ...base, status: "error", error: String(err?.message || err), agentMs: Date.now() - startedAt });
    await send(token, chatId, ERROR_REPLY).catch(() => {});
  }
}

async function handleMessage(agentId: number, token: string, msg: any) {
  if (msg.chat?.type !== "private") return;
  const chatId = String(msg.chat.id);
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || null;
  const agent = await prisma.agent.findFirst({ where: { id: agentId, is_active: true } });
  if (!agent) return;
  const text: string = (msg.text ?? msg.caption ?? "").trim();

  const link = await prisma.agentTelegramLink.findUnique({ where: { agent_id_chat_id: { agent_id: agentId, chat_id: chatId } } });
  const cmd = /^\/(\w+)(?:@\w+)?\s*(.*)$/s.exec(text);
  const cmdName = cmd?.[1]?.toLowerCase();
  const cmdArg = cmd?.[2]?.trim() ?? "";

  // Pareamento: "/start CÓDIGO", "/vincular CÓDIGO" ou o código sozinho.
  const codeCandidate = cmdName === "start" || cmdName === "vincular" ? cmdArg : /^[A-Za-z0-9]{8}$/.test(text) ? text : "";
  if (!link && codeCandidate && (await redeemPairing(agent, chatId, name, codeCandidate))) {
    await send(token, chatId, `Pronto, ${name ?? ""}! Chat vinculado à sua conta do Collab Suite.\n\n${HELP}`.replace("  ", " "));
    return;
  }
  if (!link) {
    await send(token, chatId, "Este assistente é pessoal e privado. Para vincular seu Telegram, gere um código no painel do agente (aba Telegram) e envie /start CÓDIGO aqui.");
    return;
  }

  if (cmdName === "ajuda" || cmdName === "help" || (cmdName === "start" && !cmdArg)) return void (await send(token, chatId, HELP));
  if (cmdName === "limpar") {
    await prisma.agentChannelSession.deleteMany({ where: { agent_id: agentId, contact_jid: jidOf(chatId) } });
    return void (await send(token, chatId, "Conversa limpa. Começando do zero!"));
  }
  if (cmdName === "resumo") {
    await sendBriefing(agent, token, link.user_id, chatId, name);
    return;
  }

  let input: TgInput | null = null;
  try {
    if (msg.voice || msg.audio) {
      const buffer = await downloadFile(token, (msg.voice ?? msg.audio).file_id);
      const transcript = await transcribeVoiceNote(buffer, agent.user_id, agent.company_id);
      if (transcript) input = { text: `(áudio transcrito) ${transcript}`, media: "audio" };
      else return void (await send(token, chatId, "Não consegui entender esse áudio. Pode repetir ou escrever?"));
    } else if (msg.photo?.length) {
      const buffer = await downloadFile(token, msg.photo[msg.photo.length - 1].file_id);
      input = { text: text ? `Imagem enviada: ${text}` : "Imagem enviada", media: "image", image: { mimeType: "image/jpeg", base64: buffer.toString("base64") } };
    } else if (text) {
      input = { text };
    }
  } catch (err: any) {
    console.warn("[telegram] Falha ao processar mídia:", err?.message || err);
    return void (await send(token, chatId, `Não consegui processar essa mensagem: ${err?.message || "erro desconhecido"}.`).catch(() => {}));
  }
  if (!input) return void (await send(token, chatId, "Ainda só entendo texto, áudio e fotos."));
  if (input.image && !isSupportedImageMime(input.image.mimeType)) return;

  pushAndFlush<TgInput>(`tg:${agentId}:${chatId}`, input, BUFFER_MS, (items) => {
    void runExclusive(`tg:${agentId}:${chatId}`, () => processTurn(agentId, chatId, name, items)).catch((err) => console.error("[telegram] Erro no turno:", err?.message || err));
  });
}

// ─── Briefing e lembretes ───────────────────────────────────────────────────────

async function sendBriefing(agent: Agent, token: string, userId: number, chatId: string, name: string | null) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { first_name: true } });
  const text = formatBriefing(user?.first_name ?? name ?? "", await buildDayOverview(userId));
  await send(token, chatId, text);
  // Entra na memória da conversa para o usuário poder responder ("remarca a das 10").
  const { history } = await getSession(agent.id, jidOf(chatId));
  await saveSession(agent.id, jidOf(chatId), name, [...history, { role: "assistant", content: text }], agent.session_ttl_seconds);
}

/** Envia o briefing agora para todos os chats pareados (botão de teste do painel). */
export async function sendBriefingNow(agent: Agent) {
  const bot = await prisma.agentTelegram.findUnique({ where: { agent_id: agent.id } });
  if (!bot) throw new HttpError("Bot do Telegram não configurado.");
  const links = await prisma.agentTelegramLink.findMany({ where: { agent_id: agent.id } });
  if (!links.length) throw new HttpError("Nenhum chat pareado ainda.");
  for (const l of links) await sendBriefing(agent, tokenOf(bot), l.user_id, l.chat_id, l.display_name);
  return { sent: links.length };
}

const REMINDER_GRACE_MS = 6 * 60 * 60 * 1000;
const BRIEFING_GRACE_MIN = 180;

export async function scheduleTick() {
  const now = new Date();

  const due = await prisma.assistantReminder.findMany({ where: { sent_at: null, remind_at: { lte: now } }, take: 50 });
  for (const r of due) {
    await prisma.assistantReminder.update({ where: { id: r.id }, data: { sent_at: now } }); // marca antes: nunca duplica
    if (now.getTime() - r.remind_at.getTime() > REMINDER_GRACE_MS) continue; // servidor ficou fora por muito tempo: perdeu o sentido
    try {
      const bot = await prisma.agentTelegram.findUnique({ where: { agent_id: r.agent_id } });
      const chatId = r.chat_id ?? (await prisma.agentTelegramLink.findFirst({ where: { agent_id: r.agent_id, user_id: r.user_id } }))?.chat_id;
      if (bot?.enabled && chatId) await send(tokenOf(bot), chatId, `⏰ Lembrete: ${r.text}`);
      else await notifyUser(r.user_id, { type: "meeting_reminder", title: "Lembrete do assistente", body: r.text, link: "/" });
    } catch (err: any) {
      console.warn(`[telegram] Falha ao enviar o lembrete ${r.id}:`, err?.message || err);
    }
  }

  const today = dateStrOf(now);
  const hhmm = hhmmOf(now);
  const bots = await prisma.agentTelegram.findMany({ where: { enabled: true, briefing_enabled: true }, include: { agent: true } });
  for (const bot of bots) {
    if (!bot.agent.is_active || hhmm < bot.briefing_time) continue;
    if (bot.last_briefing_on && bot.last_briefing_on.toISOString().slice(0, 10) === today) continue;
    const [h, m] = bot.briefing_time.split(":").map(Number);
    const [nh, nm] = hhmm.split(":").map(Number);
    if (nh * 60 + nm - (h * 60 + m) > BRIEFING_GRACE_MIN) continue;
    await prisma.agentTelegram.update({ where: { id: bot.id }, data: { last_briefing_on: toDbDate(today) } });
    const links = await prisma.agentTelegramLink.findMany({ where: { agent_id: bot.agent_id } });
    for (const l of links) {
      await sendBriefing(bot.agent, tokenOf(bot), l.user_id, l.chat_id, l.display_name).catch((err) => console.warn("[telegram] Falha no briefing:", err?.message || err));
    }
  }
}

// ─── Polling ────────────────────────────────────────────────────────────────────

interface Poller {
  abort: AbortController;
  stopped: boolean;
}
const pollers = new Map<number, Poller>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stopPoller(agentId: number) {
  const p = pollers.get(agentId);
  if (!p) return;
  p.stopped = true;
  p.abort.abort();
  pollers.delete(agentId);
}

async function pollLoop(agentId: number, token: string, state: Poller) {
  await tg(token, "setMyCommands", {
    commands: [
      { command: "resumo", description: "Briefing do dia" },
      { command: "limpar", description: "Esquecer a conversa" },
      { command: "ajuda", description: "O que eu sei fazer" },
    ],
  }).catch(() => {});

  const row = await prisma.agentTelegram.findUnique({ where: { agent_id: agentId }, select: { last_update_id: true } });
  let lastId = row?.last_update_id != null ? Number(row.last_update_id) : 0;

  while (!state.stopped) {
    try {
      const updates = await tg<any[]>(token, "getUpdates", { offset: lastId + 1, timeout: 25, allowed_updates: ["message"] }, state.abort.signal);
      for (const u of updates) {
        if (u.update_id <= lastId) continue;
        lastId = u.update_id;
        if (u.message) void handleMessage(agentId, token, u.message).catch((err) => console.error("[telegram] Erro ao tratar a mensagem:", err?.message || err));
      }
      if (updates.length) await prisma.agentTelegram.update({ where: { agent_id: agentId }, data: { last_update_id: BigInt(lastId) } }).catch(() => {});
    } catch (err: any) {
      if (state.stopped) return;
      if (err instanceof TelegramApiError && err.code === 401) {
        console.warn(`[telegram] Token do agente ${agentId} foi revogado; desativando o bot.`);
        await prisma.agentTelegram.update({ where: { agent_id: agentId }, data: { enabled: false } }).catch(() => {});
        pollers.delete(agentId);
        return;
      }
      if (err instanceof TelegramApiError && err.code === 409) console.warn(`[telegram] Conflito no agente ${agentId}: outro processo está lendo este bot.`);
      else console.warn(`[telegram] Erro no polling do agente ${agentId}:`, err?.message || err);
      await sleep(5000);
    }
  }
}

/** Liga/desliga o polling do agente conforme a configuração atual. */
export async function syncTelegramBot(agentId: number) {
  stopPoller(agentId);
  const row = await prisma.agentTelegram.findUnique({ where: { agent_id: agentId }, include: { agent: { select: { is_active: true } } } });
  if (!row?.enabled || !row.agent.is_active) return;
  const state: Poller = { abort: new AbortController(), stopped: false };
  pollers.set(agentId, state);
  void pollLoop(agentId, tokenOf(row), state).catch((err) => console.error("[telegram] Polling encerrou:", err?.message || err));
}

let scheduler: ReturnType<typeof setInterval> | null = null;

export async function startTelegramService() {
  if (scheduler) return;
  const rows = await prisma.agentTelegram.findMany({ where: { enabled: true }, select: { agent_id: true } });
  for (const r of rows) await syncTelegramBot(r.agent_id);
  scheduler = setInterval(() => scheduleTick().catch((err) => console.error("[telegram] Erro no agendador:", err)), 30_000);
  console.log(`[telegram] Serviço iniciado (${rows.length} bot(s) ativo(s)).`);
}
