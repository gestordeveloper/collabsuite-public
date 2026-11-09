import { downloadMediaMessage, getContentType, normalizeMessageContent } from "baileys";
import type { WASocket, WAMessage } from "baileys";
import pino from "pino";
import type { Agent } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { runExclusive } from "../../lib/keyedMutex";
import { isSupportedImageMime } from "../../lib/documentAnalysis";
import type { ChatContentPart, ChatMessageParam, SupportedImageMimeType } from "../../lib/ai-providers/types";
import { runAgentTurn, type ExtraToolset } from "../agent-run.service";
import { notifyUsers } from "../notification.service";
import { upsertChatContact } from "../tickets/contact.service";
import { broadcastTicket, getTicket } from "../tickets/core";
import { sendText as sendTicketNote } from "../tickets/send.service";
import { pushAndFlush } from "./buffer";
import { GAP_MS, splitMessage, typingDelayMs } from "./humanize";
import { transcribeVoiceNote } from "./media";
import { logTurn } from "../agent-metrics/metrics.service";
import { getSession, markHandedOff, saveSession, type HistoryMessage } from "./session.service";

const silent = pino({ level: "silent" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UNSUPPORTED_REPLY = "Ops... Eu não consigo entender este tipo de mensagem.";
const ERROR_REPLY = "Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.";

// ─── Agente da conexão (cache curto) ───────────────────────────────────────────

const agentCache = new Map<number, { agent: Agent | null; at: number }>();

/** Agente ativo que atende esta conexão (um por conexão). */
export async function getChannelAgent(connectionId: number): Promise<Agent | null> {
  const hit = agentCache.get(connectionId);
  if (hit && Date.now() - hit.at < 30_000) return hit.agent;
  const agent = await prisma.agent.findFirst({
    where: { channel_connection_id: connectionId, channel_enabled: true, is_active: true },
    orderBy: { id: "asc" },
  });
  agentCache.set(connectionId, { agent, at: Date.now() });
  return agent;
}
export const invalidateChannelAgent = (connectionId?: number | null) => (connectionId ? agentCache.delete(connectionId) : agentCache.clear());

/** O agente responde esta conversa (e o fluxo de tickets deve ignorá-la) enquanto não houver transferência para humano. */
export async function agentOwnsChat(connectionId: number, jid: string): Promise<boolean> {
  const agent = await getChannelAgent(connectionId);
  if (!agent) return false;
  const { handedOff } = await getSession(agent.id, jid);
  return !handedOff;
}

// ─── Envio ──────────────────────────────────────────────────────────────────────

async function sendReply(sock: WASocket, jid: string, text: string, humanize: boolean) {
  const chunks = humanize ? splitMessage(text) : [text.trim()].filter(Boolean);
  for (let i = 0; i < chunks.length; i++) {
    if (humanize) {
      await sock.sendPresenceUpdate("composing", jid).catch(() => {});
      await sleep(typingDelayMs(chunks[i]));
    }
    await sock.sendMessage(jid, { text: chunks[i] });
    if (humanize && i < chunks.length - 1) await sleep(GAP_MS);
  }
  await sock.sendPresenceUpdate("paused", jid).catch(() => {});
}

// ─── Transferência para humano ──────────────────────────────────────────────────

async function createHandoffTicket(agent: Agent, connectionId: number, jid: string, name: string | null, reason: string, history: HistoryMessage[]): Promise<number> {
  const isLid = jid.endsWith("@lid");
  const id = jid.split("@")[0].split(":")[0];
  const contact = await upsertChatContact({ name, number: isLid ? null : id, lid: isLid ? id : null, isGroup: false });

  let ticket = await prisma.ticket.findFirst({
    where: { contact_id: contact.id, status: { in: ["open", "pending"] } },
    orderBy: { updated_at: "desc" },
  });
  if (!ticket) {
    ticket = await prisma.ticket.create({ data: { contact_id: contact.id, connection_id: connectionId, status: "pending", is_group: false } });
  }

  const transcript = history
    .slice(-8)
    .map((m) => `${m.role === "user" ? "Cliente" : agent.name}: ${m.content}`)
    .join("\n");
  await sendTicketNote({
    ticketId: ticket.id,
    senderUserId: null,
    isInternal: true,
    body: `🤖 Transferido pelo agente "${agent.name}".\nMotivo: ${reason || "não informado"}\n\nÚltimas mensagens:\n${transcript}`,
  }).catch((err) => console.warn("[agent-channel] Não foi possível registrar a nota de transferência:", err?.message || err));

  // Avisos em tempo real/notificações são best-effort: o ticket já existe e a transferência não pode falhar por causa deles.
  try {
    await broadcastTicket(await getTicket(ticket.id));
    const admins = await prisma.user.findMany({ where: { role: { in: ["admin", "super_admin"] } }, select: { id: true } });
    await notifyUsers([agent.user_id, ...admins.map((a) => a.id)], {
      type: "ticket_created",
      title: "Agente transferiu um atendimento",
      body: `${name || id} precisa de um atendente humano.`,
      link: `/atendimento/${ticket.id}`,
      metadata: { ticketId: ticket.id },
    });
  } catch (err: any) {
    console.warn("[agent-channel] Não foi possível avisar a equipe sobre a transferência:", err?.message || err);
  }
  return ticket.id;
}

interface HandoffInfo {
  reason: string;
  ticketId: number | null;
}

function handoffToolset(agent: Agent, connectionId: number, jid: string, name: string | null, history: HistoryMessage[], info: { value: HandoffInfo | null }): ExtraToolset {
  return {
    definitions: [
      {
        name: "transferir_para_humano",
        description:
          "Transfere a conversa para um atendente humano. Use quando o cliente pedir para falar com uma pessoa, quando não houver como resolver ou em situações sensíveis. Depois de chamar, avise o cliente que um atendente continuará a conversa.",
        parameters: {
          type: "object",
          properties: { motivo: { type: "string", description: "Resumo curto do motivo da transferência." } },
          required: ["motivo"],
        },
      },
    ],
    async execute(toolName, args) {
      if (toolName !== "transferir_para_humano") return null;
      try {
        const reason = String(args.motivo ?? "");
        const ticketId = await createHandoffTicket(agent, connectionId, jid, name, reason, history);
        info.value = { reason, ticketId };
        await markHandedOff(agent.id, jid, name);
        invalidateChannelAgent(connectionId);
        return "Conversa transferida para um atendente humano. Avise o cliente.";
      } catch (err: any) {
        console.error("[agent-channel] Falha na transferência:", err?.message || err);
        return "Não foi possível transferir agora. Peça desculpas e diga que um atendente entrará em contato.";
      }
    },
  };
}

// ─── Turno do agente ────────────────────────────────────────────────────────────

interface BufferedInput {
  text: string;
  receivedAt: number;
  media?: "audio" | "image" | "sticker";
  image?: { mimeType: SupportedImageMimeType; base64: string };
}

async function processTurn(sock: WASocket, agentId: number, connectionId: number, jid: string, name: string | null, inputs: BufferedInput[]) {
  const startedAt = Date.now();
  // Recarrega: a configuração pode ter mudado durante o buffer.
  const agent = await prisma.agent.findFirst({ where: { id: agentId, channel_enabled: true, is_active: true } });
  if (!agent) return;
  const { history, handedOff } = await getSession(agent.id, jid);
  if (handedOff) return;

  await sock.sendPresenceUpdate("composing", jid).catch(() => {});

  const joined = inputs.map((i) => i.text).join("\n");
  const images = inputs.flatMap((i) => (i.image ? [i.image] : []));
  const userText = `Contato: ${name || "Desconhecido"}\nMensagem: ${joined}`;

  const content: ChatMessageParam["content"] = images.length
    ? [{ type: "text", text: userText } as ChatContentPart, ...images.map((im) => ({ type: "image", ...im }) as ChatContentPart)]
    : userText;
  const messages: ChatMessageParam[] = [...history.map((h) => ({ role: h.role, content: h.content })), { role: "user", content }];

  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId }, select: { receive_tickets: true } });
  const handoff: { value: HandoffInfo | null } = { value: null };
  const extraTools = agent.handoff_enabled && connection?.receive_tickets ? handoffToolset(agent, connectionId, jid, name, history, handoff) : undefined;
  const firstReceivedAt = Math.min(...inputs.map((i) => i.receivedAt));
  const base = { agentId: agent.id, contactJid: jid, messagesIn: inputs.length, media: inputs.flatMap((i) => (i.media ? [i.media] : [])) };

  let output: string;
  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn(
      { ...agent, system_prompt: `Seu nome é ${agent.name}.

${agent.system_prompt}` },
      messages,
      { userId: agent.user_id, companyId: agent.company_id, extraTools, channel: "whatsapp", contactJid: jid, contactName: name }
    );
    output = result.text.trim();
  } catch (err: any) {
    console.error(`[agent-channel] Erro do agente ${agent.id}:`, err?.message || err);
    await logTurn({ ...base, status: "error", error: String(err?.message || err), agentMs: Date.now() - startedAt });
    await sendReply(sock, jid, ERROR_REPLY, false).catch(() => {});
    return;
  }
  const agentMs = Date.now() - startedAt;
  if (!output) {
    await logTurn({ ...base, status: "error", error: "O modelo não devolveu texto.", agentMs });
    return;
  }

  // Como no modelo de referência, só o texto fica na memória (imagens viram um marcador).
  const stored = images.length ? `${userText}\n[${images.length} imagem(ns) enviada(s) pelo contato]` : userText;
  await saveSession(agent.id, jid, name, [...history, { role: "user", content: stored }, { role: "assistant", content: output }], agent.session_ttl_seconds);

  // Tempo percebido pelo cliente: da primeira mensagem do lote até a primeira resposta sair (os pedaços seguintes não contam).
  let firstSentAt: number | null = null;
  const timedSock = Object.create(sock) as WASocket;
  timedSock.sendMessage = ((...a: Parameters<WASocket["sendMessage"]>) => {
    firstSentAt ??= Date.now();
    return sock.sendMessage(...a);
  }) as WASocket["sendMessage"];
  await sendReply(timedSock, jid, output, agent.humanize_replies);

  await logTurn({
    ...base,
    status: "ok",
    agentMs,
    waitMs: firstSentAt ? firstSentAt - firstReceivedAt : null,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    toolNames: result.toolCallLog.map((t) => t.tool),
    usedRag: result.usedRag,
    handoff: handoff.value,
  });
}

// ─── Entrada de mensagens ───────────────────────────────────────────────────────

const IGNORED = new Set(["senderKeyDistributionMessage", "messageContextInfo", "protocolMessage", "reactionMessage", "pollUpdateMessage", "keepInChatMessage", "encReactionMessage"]);

async function handleMessage(sock: WASocket, connectionId: number, msg: WAMessage) {
  const arrivedAt = Date.now();
  const jid = msg.key.remoteJid;
  if (!jid || msg.key.fromMe || !msg.message) return;
  const sentAt = Number(msg.messageTimestamp ?? 0) * 1000;
  if (sentAt && Date.now() - sentAt > 10 * 60 * 1000) return; // backlog de reconexão: não responde mensagens antigas
  if (jid === "status@broadcast" || jid.endsWith("@g.us") || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return;

  const agent = await getChannelAgent(connectionId);
  if (!agent) return;
  if ((await getSession(agent.id, jid)).handedOff) return;

  const content = normalizeMessageContent(msg.message) as any;
  if (!content) return;
  const type = getContentType(content) as string | undefined;
  if (!type || IGNORED.has(type)) return;

  let input: BufferedInput | null = null;
  try {
    if (type === "conversation" || type === "extendedTextMessage") {
      const text = type === "conversation" ? content.conversation : content.extendedTextMessage?.text;
      if (text?.trim()) input = { text, receivedAt: arrivedAt };
    } else if (type === "audioMessage") {
      const buffer = (await downloadMediaMessage(msg, "buffer", {}, { logger: silent, reuploadRequest: sock.updateMediaMessage })) as Buffer;
      const text = await transcribeVoiceNote(buffer, agent.user_id, agent.company_id);
      if (text) input = { text: `(áudio transcrito) ${text}`, receivedAt: arrivedAt, media: "audio" };
    } else if (type === "imageMessage" || type === "stickerMessage") {
      const inner = content[type] ?? {};
      const mime = String(inner.mimetype || (type === "stickerMessage" ? "image/webp" : "image/jpeg")).split(";")[0];
      if (isSupportedImageMime(mime)) {
        const buffer = (await downloadMediaMessage(msg, "buffer", {}, { logger: silent, reuploadRequest: sock.updateMediaMessage })) as Buffer;
        const label = type === "imageMessage" ? "Imagem enviada" : "Sticker enviado";
        input = {
          text: `${label}${inner.caption ? `: ${inner.caption}` : ""}`,
          receivedAt: arrivedAt,
          media: type === "imageMessage" ? "image" : "sticker",
          image: { mimeType: mime, base64: buffer.toString("base64") },
        };
      }
    }
  } catch (err: any) {
    console.warn(`[agent-channel] Não foi possível processar a mídia (${type}):`, err?.message || err);
  }

  if (!input) {
    await sock.sendMessage(jid, { text: UNSUPPORTED_REPLY }).catch(() => {});
    return;
  }

  const name = msg.pushName || null;
  pushAndFlush<BufferedInput>(`${agent.id}:${jid}`, input, agent.buffer_delay_seconds * 1000, (items) => {
    void runExclusive(`agent-channel:${agent.id}:${jid}`, () => processTurn(sock, agent.id, connectionId, jid, name, items)).catch((err) =>
      console.error("[agent-channel] Erro ao processar o turno:", err?.message || err)
    );
  });
}

/** Liga o atendimento automático por agente a este socket (convive com o fluxo de tickets). */
export function attachAgentChannelHandlers(sock: WASocket, connectionId: number) {
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      void handleMessage(sock, connectionId, msg).catch((err) => console.error(`[agent-channel] Erro (conexão ${connectionId}):`, err?.message || err));
    }
  });
}
