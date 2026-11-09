import { prisma } from "../../lib/prisma";
import { emitToUsers } from "../../lib/socket";
import { audienceUserIds } from "./access";
import { broadcastTicket, getTicket } from "./core";
import { messageInclude, MessageFull, serializeMessage } from "./shape";

export const MESSAGES_PAGE = 40;

const MEDIA_PREVIEW: Record<string, string> = {
  image: "📷 Imagem",
  video: "🎥 Vídeo",
  audio: "🎤 Áudio",
  document: "📄 Documento",
  sticker: "Figurinha",
  location: "📍 Localização",
  vcard: "👤 Contato",
};

export interface SaveMessageInput {
  waId: string;
  connectionId: number | null;
  ticketId: number;
  contactId?: number | null;
  senderUserId?: number | null;
  fromMe: boolean;
  body?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaName?: string | null;
  ack?: number;
  isRead?: boolean;
  isInternal?: boolean;
  quotedWaId?: string | null;
  createdAt?: Date;
}

const previewOf = (body?: string | null, mediaType?: string | null) => (body && body.trim() ? body : (mediaType && MEDIA_PREVIEW[mediaType]) || "");

/** Grava a mensagem (idempotente por conexão + id do WhatsApp), atualiza a prévia do ticket e avisa a equipe. */
export async function saveMessage(input: SaveMessageInput): Promise<{ message: ReturnType<typeof serializeMessage>; created: boolean }> {
  const existing = input.connectionId
    ? await prisma.ticketMessage.findUnique({
        where: { connection_id_wa_id: { connection_id: input.connectionId, wa_id: input.waId } },
        include: messageInclude,
      })
    : null;

  if (existing) {
    // Reentrega/backfill nunca pode fazer ack/leitura andarem para trás nem perder a mídia já salva.
    const data: Record<string, unknown> = {};
    if (input.ack !== undefined && input.ack > existing.ack) data.ack = input.ack;
    if (input.mediaUrl && !existing.media_url) data.media_url = input.mediaUrl;
    // O eco do que enviamos pode chegar antes de a plataforma gravar a própria cópia: não perde quem enviou.
    if (input.senderUserId && !existing.sender_user_id) data.sender_user_id = input.senderUserId;
    if (input.quotedWaId && !existing.quoted_wa_id) data.quoted_wa_id = input.quotedWaId;
    if (!Object.keys(data).length) return { message: serializeMessage(existing), created: false };
    const updated = await prisma.ticketMessage.update({ where: { id: existing.id }, data, include: messageInclude });
    await emitMessage("update", updated);
    return { message: serializeMessage(updated), created: false };
  }

  const row = await prisma.ticketMessage.create({
    data: {
      wa_id: input.waId,
      connection_id: input.connectionId,
      ticket_id: input.ticketId,
      contact_id: input.contactId ?? null,
      sender_user_id: input.senderUserId ?? null,
      from_me: input.fromMe,
      body: input.body ?? null,
      media_url: input.mediaUrl ?? null,
      media_type: input.mediaType ?? null,
      media_name: input.mediaName ?? null,
      ack: input.ack ?? 0,
      is_read: input.isRead ?? input.fromMe,
      is_internal: input.isInternal ?? false,
      quoted_wa_id: input.quotedWaId ?? null,
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
    },
    include: messageInclude,
  });

  if (!input.isInternal) {
    const preview = previewOf(input.body, input.mediaType);
    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: {
        last_message: preview.slice(0, 1000),
        last_message_at: row.created_at,
        ...(input.fromMe ? {} : { unread_messages: { increment: 1 } }),
      },
    });
  }

  await emitMessage("create", row);
  return { message: serializeMessage(row), created: true };
}

async function emitMessage(action: "create" | "update", row: MessageFull) {
  const ticket = await getTicket(row.ticket_id);
  const audience = await audienceUserIds(ticket);
  emitToUsers(audience, "ticket_message", { action, ticketId: row.ticket_id, message: serializeMessage(row) });
  if (action === "create") await broadcastTicket(ticket);
}

export async function listMessages(ticketId: number, opts: { before?: number; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? MESSAGES_PAGE, 100);
  const rows = await prisma.ticketMessage.findMany({
    where: { ticket_id: ticketId, ...(opts.before ? { id: { lt: opts.before } } : {}) },
    include: messageInclude,
    orderBy: { id: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();

  const quotedIds = [...new Set(page.map((m) => m.quoted_wa_id).filter((v): v is string => !!v))];
  const quoted = quotedIds.length
    ? await prisma.ticketMessage.findMany({
        where: { ticket_id: ticketId, wa_id: { in: quotedIds } },
        select: { wa_id: true, body: true, from_me: true, media_type: true },
      })
    : [];
  const quotedByWaId = new Map(quoted.map((q) => [q.wa_id, q]));

  return {
    messages: page.map((m) => ({ ...serializeMessage(m), quoted: m.quoted_wa_id ? quotedByWaId.get(m.quoted_wa_id) ?? null : null })),
    hasMore,
  };
}

export async function updateAck(connectionId: number, waId: string, ack: number) {
  const row = await prisma.ticketMessage.findUnique({
    where: { connection_id_wa_id: { connection_id: connectionId, wa_id: waId } },
    include: messageInclude,
  });
  if (!row || row.ack >= ack) return;
  const updated = await prisma.ticketMessage.update({ where: { id: row.id }, data: { ack }, include: messageInclude });
  await emitMessage("update", updated);
}

export async function markDeleted(connectionId: number, waId: string) {
  const row = await prisma.ticketMessage.findUnique({
    where: { connection_id_wa_id: { connection_id: connectionId, wa_id: waId } },
    include: messageInclude,
  });
  if (!row || row.is_deleted) return;
  const updated = await prisma.ticketMessage.update({ where: { id: row.id }, data: { is_deleted: true }, include: messageInclude });
  await emitMessage("update", updated);
}

export async function editBody(connectionId: number, waId: string, body: string) {
  const row = await prisma.ticketMessage.findUnique({
    where: { connection_id_wa_id: { connection_id: connectionId, wa_id: waId } },
    include: messageInclude,
  });
  if (!row) return;
  const updated = await prisma.ticketMessage.update({ where: { id: row.id }, data: { body }, include: messageInclude });
  await emitMessage("update", updated);
}

export async function setReaction(connectionId: number, waId: string, reaction: { emoji: string; fromMe: boolean; senderId: string }) {
  const row = await prisma.ticketMessage.findUnique({
    where: { connection_id_wa_id: { connection_id: connectionId, wa_id: waId } },
    include: messageInclude,
  });
  if (!row) return;
  const current = serializeMessage(row).reactions as Array<{ emoji: string; fromMe: boolean; senderId: string }>;
  const others = current.filter((r) => r.senderId !== reaction.senderId);
  const next = reaction.emoji ? [...others, reaction] : others;
  const updated = await prisma.ticketMessage.update({ where: { id: row.id }, data: { reactions: JSON.stringify(next) }, include: messageInclude });
  await emitMessage("update", updated);
}
