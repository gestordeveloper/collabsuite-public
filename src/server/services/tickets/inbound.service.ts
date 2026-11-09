import { downloadMediaMessage, getContentType, normalizeMessageContent } from "baileys";
import type { WASocket, WAMessage } from "baileys";
import type { ChatContact } from "@prisma/client";
import pino from "pino";
import { prisma } from "../../lib/prisma";
import { runExclusive } from "../../lib/keyedMutex";
import { notifyUsers } from "../notification.service";
import { storeBuffer, extFromMime } from "../../controllers/upload.controller";
import { upsertChatContact } from "./contact.service";
import { broadcastTicket, getTicket } from "./core";
import { editBody, markDeleted, saveMessage, setReaction, updateAck } from "./message.service";
import { ensureAutomationSessions, routeIncomingMessage } from "../bot/router";
import { agentOwnsChat } from "../agent-channel/channel.service";

const silent = pino({ level: "silent" });

const MEDIA_TYPES: Record<string, string> = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
  stickerMessage: "sticker",
};

/** Mensagens que não têm nada para mostrar/guardar (chaves de grupo, sincronização, etc.). */
const IGNORED_TYPES = new Set([
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "protocolMessage",
  "reactionMessage",
  "pollUpdateMessage",
  "keepInChatMessage",
  "encReactionMessage",
]);

// Baileys: 0 erro, 1 pendente, 2 ack do servidor, 3 entregue, 4 lido, 5 reproduzido. Aqui: 0 pendente, 1 enviado, 2 entregue, 3 lido.
const ackFromStatus = (status: number | null | undefined): number => {
  if (!status || status < 2) return 0;
  if (status === 2) return 1;
  if (status === 3) return 2;
  return 3;
};

const userOf = (jid: string | null | undefined) => (jid ? jid.split("@")[0].split(":")[0] : "");

// Cache curto do flag "esta conexão recebe tickets", para não consultar o banco a cada mensagem.
const flagCache = new Map<number, { receive: boolean; at: number }>();
async function receivesTickets(connectionId: number): Promise<boolean> {
  const hit = flagCache.get(connectionId);
  if (hit && Date.now() - hit.at < 30_000) return hit.receive;
  const row = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId }, select: { receive_tickets: true } });
  const receive = !!row?.receive_tickets;
  flagCache.set(connectionId, { receive, at: Date.now() });
  return receive;
}
export const invalidateConnectionFlag = (connectionId: number) => flagCache.delete(connectionId);

const groupNames = new Map<string, string>();
async function groupSubject(sock: WASocket, jid: string): Promise<string> {
  const cached = groupNames.get(jid);
  if (cached) return cached;
  try {
    const meta = await sock.groupMetadata(jid);
    groupNames.set(jid, meta.subject || userOf(jid));
  } catch {
    return userOf(jid);
  }
  return groupNames.get(jid) as string;
}

/** Extrai texto e tipo do conteúdo (já normalizado) da mensagem. */
function describeContent(content: any, type: string): { body: string; mediaType: string; mediaName?: string } {
  const mediaType = MEDIA_TYPES[type];
  const inner = content[type] ?? {};
  switch (type) {
    case "conversation":
      return { body: content.conversation ?? "", mediaType: "chat" };
    case "extendedTextMessage":
      return { body: inner.text ?? "", mediaType: "chat" };
    case "imageMessage":
    case "videoMessage":
      return { body: inner.caption ?? "", mediaType };
    case "documentMessage":
      return { body: inner.caption ?? "", mediaType, mediaName: inner.fileName };
    case "documentWithCaptionMessage": {
      const doc = inner.message?.documentMessage ?? {};
      return { body: doc.caption ?? "", mediaType, mediaName: doc.fileName };
    }
    case "audioMessage":
    case "stickerMessage":
      return { body: "", mediaType };
    case "locationMessage":
      return { body: `https://maps.google.com/?q=${inner.degreesLatitude},${inner.degreesLongitude}`, mediaType: "location" };
    case "contactMessage":
      return { body: inner.displayName ? `👤 ${inner.displayName}` : "👤 Contato", mediaType: "vcard" };
    case "contactsArrayMessage":
      return { body: "👤 Contatos", mediaType: "vcard" };
    case "buttonsResponseMessage":
      return { body: inner.selectedDisplayText ?? inner.selectedButtonId ?? "", mediaType: "chat" };
    case "listResponseMessage":
      return { body: inner.title ?? inner.singleSelectReply?.selectedRowId ?? "", mediaType: "chat" };
    case "templateButtonReplyMessage":
      return { body: inner.selectedDisplayText ?? "", mediaType: "chat" };
    default:
      return { body: "", mediaType: "chat" };
  }
}

async function resolveContacts(sock: WASocket, msg: WAMessage) {
  const remoteJid = msg.key.remoteJid as string;
  const fromMe = !!msg.key.fromMe;
  const isGroup = remoteJid.endsWith("@g.us");

  if (isGroup) {
    const group = await upsertChatContact({ name: await groupSubject(sock, remoteJid), number: userOf(remoteJid), isGroup: true });
    // Quem escreveu no grupo (para mostrar o nome em cada mensagem).
    const participant = msg.key.participant || (msg.key as any).participantAlt;
    let sender: ChatContact | null = null;
    if (participant && !fromMe) {
      const alt = (msg.key as any).participantAlt as string | undefined;
      const isLid = participant.endsWith("@lid");
      sender = await upsertChatContact({
        name: msg.pushName,
        number: isLid ? (alt ? userOf(alt) : null) : userOf(participant),
        lid: isLid ? userOf(participant) : null,
        isGroup: false,
      }).catch(() => null);
    }
    return { contact: group, sender, isGroup: true };
  }

  const alt = (msg.key as any).remoteJidAlt as string | undefined;
  const remoteIsLid = remoteJid.endsWith("@lid");
  const contact = await upsertChatContact({
    name: fromMe ? null : msg.pushName,
    number: remoteIsLid ? (alt ? userOf(alt) : null) : userOf(remoteJid),
    lid: remoteIsLid ? userOf(remoteJid) : alt?.endsWith("@lid") ? userOf(alt) : null,
    isGroup: false,
  });
  return { contact, sender: contact, isGroup: false };
}

const TWO_HOURS = 2 * 60 * 60 * 1000;

/** Acha o ticket em andamento do contato nesta conexão, reabre um recente ou cria um novo. */
async function findOrCreateTicket(contact: ChatContact, connectionId: number, isGroup: boolean) {
  const connectionFilter = [{ connection_id: connectionId }, { connection_id: null }];

  let ticket = await prisma.ticket.findFirst({
    where: { contact_id: contact.id, status: { in: ["open", "pending"] }, OR: connectionFilter },
    orderBy: { updated_at: "desc" },
  });
  if (ticket) {
    if (ticket.connection_id !== connectionId) ticket = await prisma.ticket.update({ where: { id: ticket.id }, data: { connection_id: connectionId } });
    return { ticket, created: false };
  }

  // Grupo: reabre sempre o último. Conversa individual: só se for recente (cliente que voltou logo depois de fechar).
  const reopenable = await prisma.ticket.findFirst({
    where: { contact_id: contact.id, OR: connectionFilter, ...(isGroup ? {} : { updated_at: { gte: new Date(Date.now() - TWO_HOURS) } }) },
    orderBy: { updated_at: "desc" },
  });
  if (reopenable) {
    // Volta para "aguardando", sem fila nem atendente: a conversa passa de novo pelo bot/menu de filas.
    const reopened = await prisma.ticket.update({
      where: { id: reopenable.id },
      data: { status: "pending", user_id: null, queue_id: null, connection_id: connectionId, closed_at: null, unread_messages: 0 },
    });
    return { ticket: reopened, created: false };
  }

  const created = await prisma.ticket.create({
    data: { contact_id: contact.id, connection_id: connectionId, status: "pending", is_group: isGroup },
  });
  return { ticket: created, created: true };
}

async function handleProtocol(connectionId: number, msg: WAMessage, content: any): Promise<boolean> {
  const proto = content?.protocolMessage;
  if (!proto) return false;
  const targetId = proto.key?.id as string | undefined;
  if (targetId && proto.type === 0) await markDeleted(connectionId, targetId); // REVOKE
  if (targetId && proto.type === 14) {
    const edited = normalizeMessageContent(proto.editedMessage);
    const text = (edited as any)?.conversation ?? (edited as any)?.extendedTextMessage?.text ?? (edited as any)?.imageMessage?.caption;
    if (typeof text === "string") await editBody(connectionId, targetId, text); // EDIT
  }
  return true;
}

async function processMessage(sock: WASocket, connectionId: number, msg: WAMessage, fresh: boolean) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.endsWith("@newsletter") || remoteJid.endsWith("@broadcast")) return;
  if (!msg.message || !msg.key.id) return;

  const content = normalizeMessageContent(msg.message) as any;
  if (!content) return;

  if (await handleProtocol(connectionId, msg, content)) return;

  if (content.reactionMessage) {
    const r = content.reactionMessage;
    if (r.key?.id) {
      await setReaction(connectionId, r.key.id, {
        emoji: r.text ?? "",
        fromMe: !!msg.key.fromMe,
        senderId: msg.key.participant || msg.key.remoteJid || "",
      });
    }
    return;
  }

  const type = getContentType(content);
  if (!type || IGNORED_TYPES.has(type as string)) return;

  const { body, mediaType, mediaName } = describeContent(content, type as string);
  if (!body && !MEDIA_TYPES[type as string] && mediaType === "chat") return; // tipo sem conteúdo útil

  const fromMe = !!msg.key.fromMe;
  const { contact, sender, isGroup } = await resolveContacts(sock, msg);
  const { ticket, created: ticketCreated } = await findOrCreateTicket(contact, connectionId, isGroup);

  // Foto de perfil: busca em segundo plano só quando o contato ainda não tem.
  if (!contact.profile_pic_url && !isGroup) {
    void sock
      .profilePictureUrl(remoteJid, "image")
      .then((url) => (url ? prisma.chatContact.update({ where: { id: contact.id }, data: { profile_pic_url: url } }) : null))
      .catch(() => {});
  }

  let mediaUrl: string | null = null;
  if (MEDIA_TYPES[type as string]) {
    try {
      const buffer = (await downloadMediaMessage(msg, "buffer", {}, { logger: silent, reuploadRequest: sock.updateMediaMessage })) as Buffer;
      const inner = (content as any)[type as string] ?? {};
      const mime = String(inner.mimetype || (type === "stickerMessage" ? "image/webp" : "application/octet-stream")).split(";")[0];
      mediaUrl = await storeBuffer(buffer, extFromMime(mime), mime);
    } catch (err: any) {
      console.warn(`[tickets] Não foi possível baixar a mídia da mensagem ${msg.key.id}:`, err?.message || err);
    }
  }

  const timestamp = Number(msg.messageTimestamp ?? 0);
  const quotedWaId = (content as any)[type as string]?.contextInfo?.stanzaId as string | undefined;

  const { created } = await saveMessage({
    waId: msg.key.id,
    connectionId,
    ticketId: ticket.id,
    contactId: sender?.id ?? contact.id,
    fromMe,
    body,
    mediaUrl,
    mediaType,
    mediaName: mediaName ?? null,
    ack: fromMe ? ackFromStatus(msg.status as number | undefined) || 1 : 0,
    isRead: fromMe,
    quotedWaId: quotedWaId ?? null,
    createdAt: timestamp ? new Date(timestamp * 1000) : undefined,
  });

  if (!created || !fresh) return;

  // Ticket novo/reaberto: precisa aparecer para a equipe mesmo que o bot não faça nada com ele.
  if (ticketCreated || ticket.status === "pending") await broadcastTicket(await getTicket(ticket.id));

  if (!fromMe && !isGroup) {
    try {
      await ensureAutomationSessions(ticket.id, contact, connectionId, body);
      // Depois que um humano assume, a conversa deixa de ser automática.
      const current = await prisma.ticket.findUnique({ where: { id: ticket.id }, select: { user_id: true } });
      if (!current?.user_id) await routeIncomingMessage(ticket.id, contact, connectionId, body);
    } catch (err: any) {
      console.error(`[tickets] Erro no roteamento automático do ticket ${ticket.id}:`, err?.message || err);
    }
  }

  if (ticketCreated && !fromMe) await notifyUnclaimed(ticket.id).catch(() => {});
}

/** Conversa nova que o bot/rodízio não encaminhou para ninguém: avisa os admins para ela não ficar esquecida. */
async function notifyUnclaimed(ticketId: number) {
  const ticket = await getTicket(ticketId);
  if (ticket.user_id || ticket.queue_id) return; // fila → membros já foram avisados pelo updateTicket
  const admins = await prisma.user.findMany({ where: { role: { in: ["admin", "super_admin"] } }, select: { id: true } });
  await notifyUsers(
    admins.map((a) => a.id),
    {
      type: "ticket_created",
      title: "Nova conversa aguardando atendimento",
      body: `${ticket.contact.name} enviou uma mensagem.`,
      link: `/atendimento/${ticket.id}`,
      metadata: { ticketId: ticket.id },
    }
  );
}

/** Liga os eventos do Baileys deste socket ao sistema de atendimento. */
export function attachInboundHandlers(sock: WASocket, connectionId: number) {
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    for (const msg of messages) {
      // "append" = histórico/enviadas pelo celular; só as nossas e recentes interessam.
      const recent = Number(msg.messageTimestamp ?? 0) * 1000 > Date.now() - 60 * 60 * 1000;
      if (type !== "notify" && !(msg.key.fromMe && recent)) continue;

      const key = `ticket-in:${connectionId}:${msg.key.remoteJid}`;
      void (async () => {
        if (!(await receivesTickets(connectionId))) return;
        // Conexão atendida por um agente de IA: a conversa só vira ticket depois da transferência para humano.
        if (msg.key.remoteJid && (await agentOwnsChat(connectionId, msg.key.remoteJid))) return;
        await runExclusive(key, () => processMessage(sock, connectionId, msg, type === "notify" || recent));
      })().catch((err) => console.error(`[tickets] Erro ao processar mensagem recebida (conexão ${connectionId}):`, err?.message || err));
    }
  });

  sock.ev.on("messages.update", (updates) => {
    void (async () => {
      if (!(await receivesTickets(connectionId))) return;
      for (const { key, update } of updates) {
        if (!key.id) continue;
        if (typeof update.status === "number" && key.fromMe) await updateAck(connectionId, key.id, ackFromStatus(update.status));
        const edited = normalizeMessageContent((update as any).message?.editedMessage?.message) as any;
        const text = edited?.conversation ?? edited?.extendedTextMessage?.text;
        if (typeof text === "string") await editBody(connectionId, key.id, text);
      }
    })().catch((err) => console.error("[tickets] Erro ao atualizar status de mensagem:", err?.message || err));
  });

  sock.ev.on("messages.reaction", (reactions) => {
    void (async () => {
      if (!(await receivesTickets(connectionId))) return;
      for (const { key, reaction } of reactions) {
        if (!key.id) continue;
        await setReaction(connectionId, key.id, {
          emoji: reaction.text ?? "",
          fromMe: !!reaction.key?.fromMe,
          senderId: reaction.key?.participant || reaction.key?.remoteJid || "",
        });
      }
    })().catch((err) => console.error("[tickets] Erro ao processar reação:", err?.message || err));
  });
}
