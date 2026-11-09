import type { Prisma, User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";

export type Actor = Pick<User, "id" | "role">;

export const isAdmin = (u: Pick<User, "role">) => u.role === "admin" || u.role === "super_admin";

export async function queueIdsOf(userId: number): Promise<number[]> {
  const rows = await prisma.ticketQueueUser.findMany({ where: { user_id: userId }, select: { queue_id: true } });
  return rows.map((r) => r.queue_id);
}

/**
 * Quais tickets o usuário enxerga: os que são dele + os pendentes (aguardando alguém assumir) das
 * suas filas ou ainda sem fila. Admin com `showAll` enxerga tudo, inclusive o que é de outro atendente.
 */
export async function visibilityWhere(user: Actor, showAll = false): Promise<Prisma.TicketWhereInput> {
  if (isAdmin(user)) {
    return showAll ? {} : { OR: [{ user_id: user.id }, { status: "pending" }] };
  }
  const queueIds = await queueIdsOf(user.id);
  return {
    OR: [
      { user_id: user.id },
      { status: "pending", OR: [{ queue_id: null }, ...(queueIds.length ? [{ queue_id: { in: queueIds } }] : [])] },
    ],
  };
}

/** Lança 404 se o ticket não existir ou o usuário não puder vê-lo (admin vê qualquer ticket). */
export async function assertCanAccessTicket(user: Actor, ticketId: number): Promise<void> {
  const where = await visibilityWhere(user, isAdmin(user));
  const found = await prisma.ticket.findFirst({ where: { AND: [{ id: ticketId }, where] }, select: { id: true } });
  if (!found) throw new HttpError("Ticket não encontrado.", 404);
}

/** Quem deve receber eventos em tempo real deste ticket: admins, o atendente e os membros da fila (ou todos, se sem fila). */
export async function audienceUserIds(ticket: { user_id: number | null; queue_id: number | null }): Promise<number[]> {
  const ids = new Set<number>();
  if (ticket.user_id) ids.add(ticket.user_id);

  const admins = await prisma.user.findMany({ where: { role: { in: ["admin", "super_admin"] } }, select: { id: true } });
  admins.forEach((a) => ids.add(a.id));

  if (ticket.queue_id) {
    const members = await prisma.ticketQueueUser.findMany({ where: { queue_id: ticket.queue_id }, select: { user_id: true } });
    members.forEach((m) => ids.add(m.user_id));
  } else {
    const everyone = await prisma.user.findMany({ select: { id: true } });
    everyone.forEach((u) => ids.add(u.id));
  }
  return [...ids];
}
