import { prisma } from "../../lib/prisma";
import { emitToUsers } from "../../lib/socket";
import { HttpError } from "../../lib/httpError";
import { audienceUserIds } from "./access";
import { ticketInclude, TicketFull } from "./shape";

export async function getTicket(id: number): Promise<TicketFull> {
  const ticket = await prisma.ticket.findUnique({ where: { id }, include: ticketInclude });
  if (!ticket) throw new HttpError("Ticket não encontrado.", 404);
  return ticket;
}

/** Avisa em tempo real todo mundo que enxerga (ou enxergava) o ticket; o front reconcilia as listas. */
export async function broadcastTicket(ticket: TicketFull, previous?: { user_id: number | null; queue_id: number | null }) {
  const audience = new Set(await audienceUserIds(ticket));
  if (previous) (await audienceUserIds(previous)).forEach((id) => audience.add(id));
  emitToUsers([...audience], "ticket", { action: "update", ticket });
}
