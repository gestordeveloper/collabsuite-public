import type { Prisma } from "@prisma/client";

export const userBrief = { select: { id: true, first_name: true, last_name: true, photo: true } } as const;

export const ticketInclude = {
  contact: true,
  queue: { select: { id: true, name: true, color: true } },
  user: userBrief,
  connection: { select: { id: true, label: true, phone_number: true } },
  tags: true,
  _count: { select: { tasks: true } },
} satisfies Prisma.TicketInclude;

export type TicketFull = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export const messageInclude = {
  sender: userBrief,
  contact: { select: { id: true, name: true } },
} satisfies Prisma.TicketMessageInclude;

export type MessageFull = Prisma.TicketMessageGetPayload<{ include: typeof messageInclude }>;

export function serializeMessage(row: MessageFull) {
  let reactions: unknown[] = [];
  if (row.reactions) {
    try {
      const parsed = JSON.parse(row.reactions);
      if (Array.isArray(parsed)) reactions = parsed;
    } catch {
      reactions = [];
    }
  }
  return { ...row, reactions };
}

export const digitsOnly = (value: string) => value.replace(/\D/g, "");
