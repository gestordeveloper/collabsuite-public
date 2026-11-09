import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { emitToUsers } from "../../lib/socket";
import { HttpError } from "../../lib/httpError";
import { notifyUser, notifyUsers } from "../notification.service";
import { Actor, audienceUserIds, isAdmin, visibilityWhere } from "./access";
import { ticketInclude, TicketFull, digitsOnly } from "./shape";
import { upsertChatContact } from "./contact.service";
import { sendConnectionFarewell } from "./send.service";
import { getTicket, broadcastTicket } from "./core";

export const PAGE_SIZE = 40;

export { getTicket, broadcastTicket };

export interface ListQuery {
  status?: string;
  search?: string;
  queueIds?: number[];
  tagIds?: number[];
  isGroup?: boolean;
  isParallel?: boolean;
  connectionId?: number;
  assignedUserId?: number;
  showAll?: boolean;
  withUnread?: boolean;
  page?: number;
}

export async function listTickets(user: Actor, q: ListQuery) {
  const admin = isAdmin(user);
  const and: Prisma.TicketWhereInput[] = [await visibilityWhere(user, admin && !!q.showAll)];

  if (q.withUnread) and.push({ user_id: user.id, status: "open", unread_messages: { gt: 0 } });
  if (q.status === "pending" || q.status === "open" || q.status === "closed") and.push({ status: q.status });
  if (q.queueIds?.length) and.push({ OR: [{ queue_id: { in: q.queueIds } }, { queue_id: null }] });
  if (q.tagIds?.length) and.push({ tags: { some: { id: { in: q.tagIds } } } });
  if (q.isGroup !== undefined) and.push({ is_group: q.isGroup });
  if (q.isParallel !== undefined) and.push({ is_parallel: q.isParallel });
  if (q.connectionId) and.push({ connection_id: q.connectionId });
  if (q.assignedUserId && admin) and.push({ user_id: q.assignedUserId });

  const term = q.search?.trim();
  if (term) {
    const digits = digitsOnly(term);
    and.push({
      OR: [
        { contact: { name: { contains: term } } },
        ...(digits ? [{ contact: { number: { contains: digits } } }] : []),
        { messages: { some: { body: { contains: term }, is_internal: false } } },
      ],
    });
  }

  const where: Prisma.TicketWhereInput = { AND: and };
  const page = Math.max(1, q.page ?? 1);
  const [count, tickets] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: ticketInclude,
      orderBy: { updated_at: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
  ]);
  return { tickets, count, hasMore: count > page * PAGE_SIZE };
}

/** Contadores das abas (aguardando / em atendimento) respeitando a mesma visibilidade da listagem. */
export async function countTickets(user: Actor, showAll = false) {
  const base = await visibilityWhere(user, isAdmin(user) && showAll);
  const [pending, open, unread] = await Promise.all([
    prisma.ticket.count({ where: { AND: [base, { status: "pending" }] } }),
    prisma.ticket.count({ where: { AND: [base, { status: "open" }] } }),
    prisma.ticket.count({ where: { user_id: user.id, status: "open", unread_messages: { gt: 0 } } }),
  ]);
  return { pending, open, unread };
}

/** Inicia (ou retoma) uma conversa com um número pela plataforma. */
export async function startConversation(
  actor: Actor,
  input: { contact_id?: number; number?: string; name?: string; connection_id: number; queue_id?: number | null }
) {
  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: input.connection_id } });
  if (!connection) throw new HttpError("Conexão do WhatsApp não encontrada.", 404);
  if (!connection.receive_tickets) throw new HttpError("Essa conexão não está habilitada para atendimento.");

  const contact = input.contact_id
    ? await prisma.chatContact.findUnique({ where: { id: input.contact_id } })
    : input.number
      ? await upsertChatContact({ name: input.name, number: input.number, isGroup: false })
      : null;
  if (!contact) throw new HttpError("Informe um contato ou um número.");

  const existing = await prisma.ticket.findFirst({
    where: { contact_id: contact.id, status: { in: ["open", "pending"] }, OR: [{ connection_id: connection.id }, { connection_id: null }] },
    orderBy: { updated_at: "desc" },
  });
  if (existing) {
    if (existing.user_id && existing.user_id !== actor.id && !isAdmin(actor)) {
      throw new HttpError("Já existe um atendimento aberto com esse contato, de outro atendente.", 409);
    }
    return getTicket(existing.id);
  }

  const created = await prisma.ticket.create({
    data: {
      contact_id: contact.id,
      connection_id: connection.id,
      queue_id: input.queue_id ?? null,
      user_id: actor.id,
      status: "open",
      started_at: new Date(),
    },
  });
  const full = await getTicket(created.id);
  await broadcastTicket(full);
  return full;
}

export interface UpdateInput {
  status?: "pending" | "open" | "closed";
  user_id?: number | null;
  queue_id?: number | null;
  connection_id?: number;
  tag_ids?: number[];
  is_parallel?: boolean;
  mark_unread?: boolean;
  close_reason?: string | null;
  customer_sentiment?: string | null;
  closing_observations?: string | null;
  /** Bot: a fila tem um fluxo de triagem que ainda vai rodar — o rodízio só entra depois dele (ver `distributeAfterTriage`). */
  defer_distribution?: boolean;
}

/**
 * Única porta de entrada para mudar o estado de um ticket (humano, bot ou rodízio). `actor`
 * ausente = chamada interna (bot/sistema), que não passa pelas regras de permissão.
 */
export async function updateTicket(id: number, data: UpdateInput, actor?: Actor): Promise<TicketFull> {
  const ticket = await getTicket(id);

  if (data.mark_unread && actor && !isAdmin(actor)) {
    throw new HttpError("Apenas administradores podem marcar como não lido.", 403);
  }

  if (data.queue_id) {
    const q = await prisma.ticketQueue.findUnique({ where: { id: data.queue_id }, select: { id: true } });
    if (!q) throw new HttpError("Fila não encontrada.", 404);
  }
  if (data.user_id) {
    const u = await prisma.user.findUnique({ where: { id: data.user_id }, select: { id: true } });
    if (!u) throw new HttpError("Usuário não encontrado.", 404);
  }
  if (data.connection_id) {
    const c = await prisma.whatsAppConnection.findUnique({ where: { id: data.connection_id }, select: { id: true } });
    if (!c) throw new HttpError("Conexão não encontrada.", 404);
  }
  if (data.tag_ids?.length) {
    const found = await prisma.ticketTag.count({ where: { id: { in: data.tag_ids } } });
    if (found !== new Set(data.tag_ids).size) throw new HttpError("Etiqueta não encontrada.", 404);
  }

  // Um atendente comum só assume ticket que já tem fila; sem fila quem decide é o admin (ou o bot).
  const nextQueueId = data.queue_id !== undefined ? data.queue_id : ticket.queue_id;
  if (data.user_id && !ticket.user_id && !nextQueueId && actor && !isAdmin(actor)) {
    throw new HttpError("Esse ticket ainda aguarda a escolha da fila pelo cliente.");
  }

  // started_at: primeira vez em "open" (nunca zera). closed_at: não-nulo exatamente enquanto fechado.
  const timing: { started_at?: Date; closed_at?: Date | null } = {};
  if (data.status && data.status !== ticket.status) {
    if (data.status === "open" && !ticket.started_at) timing.started_at = new Date();
    if (data.status === "closed") timing.closed_at = new Date();
    else if (ticket.status === "closed") timing.closed_at = null;
  }

  const markRead = actor && !data.mark_unread;
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.user_id !== undefined ? { user_id: data.user_id } : {}),
        ...(data.queue_id !== undefined ? { queue_id: data.queue_id } : {}),
        ...(data.connection_id !== undefined ? { connection_id: data.connection_id } : {}),
        ...(data.is_parallel !== undefined ? { is_parallel: data.is_parallel } : {}),
        ...(data.close_reason !== undefined ? { close_reason: data.close_reason } : {}),
        ...(data.customer_sentiment !== undefined ? { customer_sentiment: data.customer_sentiment } : {}),
        ...(data.closing_observations !== undefined ? { closing_observations: data.closing_observations } : {}),
        ...(data.tag_ids ? { tags: { set: [...new Set(data.tag_ids)].map((tagId) => ({ id: tagId })) } } : {}),
        ...(data.mark_unread ? { unread_messages: Math.max(ticket.unread_messages, 1) } : {}),
        ...(markRead ? { unread_messages: 0 } : {}),
        ...timing,
      },
    });
    if (markRead) {
      await tx.ticketMessage.updateMany({ where: { ticket_id: id, from_me: false, is_read: false }, data: { is_read: true } });
    }
  });

  let updated = await getTicket(id);

  // Entrou numa fila sem atendente definido: o rodízio (se a fila usar) escolhe quem assume.
  const noExplicitUser = data.user_id === undefined || data.user_id === null;
  if (data.queue_id && noExplicitUser && !updated.user_id && !data.defer_distribution) {
    const distributed = await autoDistribute(updated.id, data.queue_id);
    if (distributed) updated = distributed;
  }

  await broadcastTicket(updated, { user_id: ticket.user_id, queue_id: ticket.queue_id });

  const becameClosed = updated.status === "closed" && ticket.status !== "closed";
  if (becameClosed) {
    sendConnectionFarewell(updated.id).catch((err) => console.error("[tickets] Falha ao enviar despedida:", err?.message || err));
  }

  const assigneeChanged = updated.user_id && updated.user_id !== ticket.user_id;
  if (assigneeChanged && updated.user_id !== actor?.id) {
    emitToUsers([updated.user_id!], "ticket_transferred", { ticket: updated });
    notifyUser(updated.user_id!, {
      type: "ticket_created",
      title: "Atendimento atribuído a você",
      body: `${updated.contact.name} foi encaminhado para você.`,
      link: `/atendimento/${updated.id}`,
      metadata: { ticketId: updated.id },
    }).catch(() => {});
  } else if (!updated.user_id && updated.queue_id && updated.queue_id !== ticket.queue_id) {
    notifyQueueMembers(updated).catch(() => {});
  }

  return updated;
}

async function notifyQueueMembers(ticket: TicketFull) {
  if (!ticket.queue_id) return;
  const members = await prisma.ticketQueueUser.findMany({ where: { queue_id: ticket.queue_id }, select: { user_id: true } });
  await notifyUsers(
    members.map((m) => m.user_id),
    {
      type: "ticket_created",
      title: `Novo atendimento em ${ticket.queue?.name ?? "fila"}`,
      body: `${ticket.contact.name} está aguardando atendimento.`,
      link: `/atendimento/${ticket.id}`,
      metadata: { ticketId: ticket.id },
    }
  );
}

/** Rodízio: entrega o ticket ao próximo membro da fila (se a fila ligou a distribuição automática). */
export async function distributeAfterTriage(ticketId: number): Promise<void> {
  const ticket = await getTicket(ticketId);
  if (!ticket.queue_id || ticket.user_id || ticket.status === "closed") return;
  await autoDistribute(ticketId, ticket.queue_id);
}

async function autoDistribute(ticketId: number, queueId: number): Promise<TicketFull | null> {
  const queue = await prisma.ticketQueue.findUnique({
    where: { id: queueId },
    include: { users: { orderBy: { user_id: "asc" } } },
  });
  if (!queue?.auto_distribution || queue.users.length === 0) return null;

  const memberIds = queue.users.map((u) => u.user_id);
  const lastIndex = queue.last_distributed_user_id ? memberIds.indexOf(queue.last_distributed_user_id) : -1;
  const nextUserId = memberIds[(lastIndex + 1) % memberIds.length];
  await prisma.ticketQueue.update({ where: { id: queueId }, data: { last_distributed_user_id: nextUserId } });

  try {
    return await updateTicket(ticketId, { user_id: nextUserId, status: "open" });
  } catch (err) {
    console.error("[tickets] Falha ao distribuir ticket automaticamente:", err);
    return null;
  }
}

export async function deleteTicket(id: number) {
  const ticket = await getTicket(id);
  const audience = await audienceUserIds(ticket);
  await prisma.ticket.delete({ where: { id } });
  emitToUsers(audience, "ticket", { action: "delete", ticketId: id });
  return { success: true };
}

/** Transferência em massa (admin): move vários tickets de uma vez para um atendente/fila/status. */
export async function bulkTransfer(
  ticketIds: number[],
  target: { user_id?: number | null; queue_id?: number | null; status?: "pending" | "open" | "closed" }
) {
  let updated = 0;
  const failed: number[] = [];
  for (const id of ticketIds) {
    try {
      await updateTicket(id, target);
      updated += 1;
    } catch {
      failed.push(id);
    }
  }
  return { updated, failed };
}

export async function listTicketIdsByUser(userId: number) {
  const rows = await prisma.ticket.findMany({ where: { user_id: userId, status: { in: ["open", "pending"] } }, select: { id: true } });
  return rows.map((r) => r.id);
}
