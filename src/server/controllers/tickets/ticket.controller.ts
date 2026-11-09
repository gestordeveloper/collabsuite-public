import type { Request, Response } from "express";
import multer from "multer";
import { sendError } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import { Actor, assertCanAccessTicket, isAdmin } from "../../services/tickets/access";
import { searchContacts } from "../../services/tickets/contact.service";
import { getTicket } from "../../services/tickets/core";
import { listMessages } from "../../services/tickets/message.service";
import { deleteForEveryone, sendMedia, sendText } from "../../services/tickets/send.service";
import { createTaskFromTicket, listTicketTasks } from "../../services/tickets/ticket-task.service";
import * as ticketService from "../../services/tickets/ticket.service";

const actorOf = (req: Request): Actor => ({ id: req.user!.id, role: req.user!.role });
const idParam = (req: Request, name = "ticketId") => parseInt(req.params[name], 10);

const bool = (v: unknown): boolean | undefined => (v === "true" ? true : v === "false" ? false : undefined);
const intList = (v: unknown): number[] | undefined => {
  if (typeof v !== "string" || !v) return undefined;
  const list = v.split(",").map((n) => parseInt(n, 10)).filter(Number.isFinite);
  return list.length ? list : undefined;
};
const int = (v: unknown): number | undefined => {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
};

export async function list(req: Request, res: Response) {
  try {
    const q = req.query;
    res.json(
      await ticketService.listTickets(actorOf(req), {
        status: q.status as string | undefined,
        search: q.search as string | undefined,
        queueIds: intList(q.queue_ids),
        tagIds: intList(q.tag_ids),
        isGroup: bool(q.is_group),
        isParallel: bool(q.is_parallel),
        connectionId: int(q.connection_id),
        assignedUserId: int(q.assigned_user_id),
        showAll: bool(q.show_all),
        withUnread: bool(q.with_unread),
        page: int(q.page),
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

export async function counts(req: Request, res: Response) {
  try {
    res.json(await ticketService.countTickets(actorOf(req), bool(req.query.show_all)));
  } catch (err) {
    sendError(res, err);
  }
}

/** Conexões habilitadas para atendimento — qualquer membro da equipe precisa vê-las para iniciar conversas. */
export async function connections(_req: Request, res: Response) {
  try {
    res.json(
      await prisma.whatsAppConnection.findMany({
        where: { receive_tickets: true },
        select: { id: true, label: true, phone_number: true, status: true },
        orderBy: { label: "asc" },
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

export async function team(_req: Request, res: Response) {
  try {
    res.json(await prisma.user.findMany({ select: { id: true, first_name: true, last_name: true, photo: true, role: true }, orderBy: { first_name: "asc" } }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function contacts(req: Request, res: Response) {
  try {
    res.json(await searchContacts(String(req.query.search ?? "")));
  } catch (err) {
    sendError(res, err);
  }
}

export async function start(req: Request, res: Response) {
  try {
    res.status(201).json(await ticketService.startConversation(actorOf(req), req.body));
  } catch (err) {
    sendError(res, err);
  }
}

export async function get(req: Request, res: Response) {
  try {
    const id = idParam(req);
    await assertCanAccessTicket(actorOf(req), id);
    res.json(await getTicket(id));
  } catch (err) {
    sendError(res, err);
  }
}

export async function update(req: Request, res: Response) {
  try {
    const id = idParam(req);
    const actor = actorOf(req);
    await assertCanAccessTicket(actor, id);
    res.json(await ticketService.updateTicket(id, req.body, actor));
  } catch (err) {
    sendError(res, err);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    if (!isAdmin(req.user!)) return void res.status(403).json({ error: "Apenas administradores podem excluir tickets." });
    res.json(await ticketService.deleteTicket(idParam(req)));
  } catch (err) {
    sendError(res, err);
  }
}

export async function bulkTransfer(req: Request, res: Response) {
  try {
    if (!isAdmin(req.user!)) return void res.status(403).json({ error: "Apenas administradores podem transferir em massa." });
    const { ticket_ids, ...target } = req.body;
    res.json(await ticketService.bulkTransfer(ticket_ids, target));
  } catch (err) {
    sendError(res, err);
  }
}

export async function idsByUser(req: Request, res: Response) {
  try {
    if (!isAdmin(req.user!)) return void res.status(403).json({ error: "Apenas administradores." });
    const userId = int(req.query.user_id);
    if (!userId) return void res.status(400).json({ error: "Informe o atendente." });
    res.json({ ticket_ids: await ticketService.listTicketIdsByUser(userId) });
  } catch (err) {
    sendError(res, err);
  }
}

// ─── Mensagens ───

export async function messages(req: Request, res: Response) {
  try {
    const id = idParam(req);
    await assertCanAccessTicket(actorOf(req), id);
    res.json(await listMessages(id, { before: int(req.query.before), limit: int(req.query.limit) }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function send(req: Request, res: Response) {
  try {
    const id = idParam(req);
    await assertCanAccessTicket(actorOf(req), id);
    const { body, quoted_message_id, is_internal } = req.body;
    res.status(201).json(await sendText({ ticketId: id, body, senderUserId: req.user!.id, quotedMessageId: quoted_message_id, isInternal: is_internal }));
  } catch (err) {
    sendError(res, err);
  }
}

const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });
export const mediaMiddleware = mediaUpload.single("file");

export async function sendFile(req: Request, res: Response) {
  try {
    const id = idParam(req);
    await assertCanAccessTicket(actorOf(req), id);
    const file = req.file;
    if (!file) return void res.status(400).json({ error: "Nenhum arquivo enviado." });
    res.status(201).json(
      await sendMedia({
        ticketId: id,
        buffer: file.buffer,
        mimetype: file.mimetype || "application/octet-stream",
        filename: file.originalname || "arquivo",
        caption: typeof req.body.caption === "string" ? req.body.caption : undefined,
        asDocument: req.body.as_document === "true",
        voice: req.body.voice === "true",
        quotedMessageId: int(req.body.quoted_message_id),
        senderUserId: req.user!.id,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

export async function removeMessage(req: Request, res: Response) {
  try {
    const id = idParam(req);
    await assertCanAccessTicket(actorOf(req), id);
    res.json(await deleteForEveryone(id, idParam(req, "messageId")));
  } catch (err) {
    sendError(res, err);
  }
}

// ─── Tarefas a partir da conversa ───

export async function tasks(req: Request, res: Response) {
  try {
    const id = idParam(req);
    await assertCanAccessTicket(actorOf(req), id);
    res.json(await listTicketTasks(id));
  } catch (err) {
    sendError(res, err);
  }
}

export async function createTask(req: Request, res: Response) {
  try {
    const id = idParam(req);
    const actor = actorOf(req);
    await assertCanAccessTicket(actor, id);
    res.status(201).json(await createTaskFromTicket(id, actor, req.body));
  } catch (err) {
    sendError(res, err);
  }
}
