import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { transcodeToOggOpus } from "../../lib/ffmpeg";
import { storeBuffer, extFromMime } from "../../controllers/upload.controller";
import { ensureConnected } from "../whatsapp/connectionManager";
import { jidOf } from "./contact.service";
import { saveMessage, markDeleted } from "./message.service";
import { getTicket } from "./core";

interface SendContext {
  connectionId: number;
  jid: string;
  contactId: number;
}

async function loadContext(ticketId: number): Promise<SendContext> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { contact: true } });
  if (!ticket) throw new HttpError("Ticket não encontrado.", 404);
  if (!ticket.connection_id) {
    throw new HttpError("Este ticket não tem uma conexão de WhatsApp ativa. Escolha uma conexão para responder.");
  }
  return { connectionId: ticket.connection_id, jid: jidOf(ticket.contact), contactId: ticket.contact_id };
}

async function buildQuoted(ticketId: number, messageId: number | undefined, jid: string) {
  if (!messageId) return { quoted: undefined, quotedWaId: null as string | null };
  const row = await prisma.ticketMessage.findFirst({ where: { id: messageId, ticket_id: ticketId } });
  if (!row) return { quoted: undefined, quotedWaId: null };
  return {
    quotedWaId: row.wa_id,
    quoted: { key: { remoteJid: jid, fromMe: row.from_me, id: row.wa_id }, message: { conversation: row.body ?? "" } } as any,
  };
}

const localId = (prefix: string) => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

export interface SendTextInput {
  ticketId: number;
  body: string;
  senderUserId: number | null;
  quotedMessageId?: number;
  isInternal?: boolean;
}

export async function sendText(input: SendTextInput) {
  const body = input.body.trim();
  if (!body) throw new HttpError("A mensagem está vazia.");

  // Nota interna: fica só no histórico do ticket, nunca vai para o WhatsApp.
  if (input.isInternal) {
    const ctx = await prisma.ticket.findUnique({ where: { id: input.ticketId }, select: { connection_id: true, contact_id: true } });
    if (!ctx) throw new HttpError("Ticket não encontrado.", 404);
    return (
      await saveMessage({
        waId: localId("note"),
        connectionId: ctx.connection_id,
        ticketId: input.ticketId,
        contactId: ctx.contact_id,
        senderUserId: input.senderUserId,
        fromMe: true,
        body,
        mediaType: "chat",
        ack: 3,
        isInternal: true,
      })
    ).message;
  }

  const ctx = await loadContext(input.ticketId);
  const sock = await ensureConnected(ctx.connectionId);
  const { quoted, quotedWaId } = await buildQuoted(input.ticketId, input.quotedMessageId, ctx.jid);

  const sent = await sock.sendMessage(ctx.jid, { text: body }, quoted ? { quoted } : undefined);
  return (
    await saveMessage({
      waId: sent?.key?.id || localId("out"),
      connectionId: ctx.connectionId,
      ticketId: input.ticketId,
      contactId: ctx.contactId,
      senderUserId: input.senderUserId,
      fromMe: true,
      body,
      mediaType: "chat",
      ack: 1,
      quotedWaId,
    })
  ).message;
}

export interface SendMediaInput {
  ticketId: number;
  buffer: Buffer;
  mimetype: string;
  filename: string;
  caption?: string;
  senderUserId: number | null;
  asDocument?: boolean;
  /** Áudio gravado no navegador: vai como mensagem de voz (OGG/Opus). */
  voice?: boolean;
  quotedMessageId?: number;
}

export function mediaCategory(mimetype: string, asDocument?: boolean): "image" | "video" | "audio" | "document" {
  if (asDocument) return "document";
  if (mimetype.startsWith("image/") && mimetype !== "image/svg+xml") return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
}

export async function sendMedia(input: SendMediaInput) {
  const ctx = await loadContext(input.ticketId);
  const sock = await ensureConnected(ctx.connectionId);
  const { quoted, quotedWaId } = await buildQuoted(input.ticketId, input.quotedMessageId, ctx.jid);

  let { buffer, mimetype, filename } = input;
  const category = mediaCategory(mimetype, input.asDocument);
  const caption = input.caption?.trim() || undefined;

  let ptt = false;
  if (category === "audio" && input.voice) {
    try {
      buffer = await transcodeToOggOpus(buffer);
      mimetype = "audio/ogg; codecs=opus";
      filename = filename.replace(/\.[^.]+$/, "") + ".ogg";
      ptt = true;
    } catch (err: any) {
      console.warn("[tickets] Não foi possível converter o áudio para OGG/Opus; enviando como arquivo de áudio:", err?.message || err);
    }
  }

  const content: any =
    category === "image"
      ? { image: buffer, caption, mimetype }
      : category === "video"
        ? { video: buffer, caption, mimetype }
        : category === "audio"
          ? { audio: buffer, mimetype, ptt }
          : { document: buffer, mimetype, fileName: filename, caption };

  const sent = await sock.sendMessage(ctx.jid, content, quoted ? { quoted } : undefined);

  const cleanMime = mimetype.split(";")[0];
  const mediaUrl = await storeBuffer(buffer, extFromMime(cleanMime), cleanMime);

  return (
    await saveMessage({
      waId: sent?.key?.id || localId("out"),
      connectionId: ctx.connectionId,
      ticketId: input.ticketId,
      contactId: ctx.contactId,
      senderUserId: input.senderUserId,
      fromMe: true,
      body: caption ?? null,
      mediaUrl,
      mediaType: category,
      mediaName: filename,
      ack: 1,
      quotedWaId,
    })
  ).message;
}

/** Apagar para todos: revoga no WhatsApp e marca a mensagem como apagada no histórico. */
export async function deleteForEveryone(ticketId: number, messageId: number) {
  const row = await prisma.ticketMessage.findFirst({ where: { id: messageId, ticket_id: ticketId } });
  if (!row) throw new HttpError("Mensagem não encontrada.", 404);
  if (row.is_internal) {
    await prisma.ticketMessage.delete({ where: { id: row.id } });
    return { success: true };
  }
  if (!row.from_me) throw new HttpError("Só é possível apagar mensagens enviadas por você.");

  const ctx = await loadContext(ticketId);
  const sock = await ensureConnected(ctx.connectionId);
  await sock.sendMessage(ctx.jid, { delete: { remoteJid: ctx.jid, fromMe: true, id: row.wa_id } });
  await markDeleted(ctx.connectionId, row.wa_id);
  return { success: true };
}

/** Despedida configurada na conexão, enviada quando o ticket é fechado. */
export async function sendConnectionFarewell(ticketId: number) {
  const ticket = await getTicket(ticketId);
  if (!ticket.connection_id || ticket.is_group) return;
  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: ticket.connection_id }, select: { farewell_message: true } });
  const text = connection?.farewell_message?.trim();
  if (!text) return;
  await sendText({ ticketId, body: renderTemplate(text, ticket.contact.name), senderUserId: null });
}

/** `{{name}}` / `{{firstName}}` nas mensagens automáticas. */
export function renderTemplate(text: string, contactName: string, extra: Record<string, string> = {}): string {
  const vars: Record<string, string> = { name: contactName, firstName: contactName.split(" ")[0] || contactName, ...extra };
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}
