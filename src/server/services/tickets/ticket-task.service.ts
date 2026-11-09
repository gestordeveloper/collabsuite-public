import { prisma } from "../../lib/prisma";
import { emitAll } from "../../lib/socket";
import { HttpError } from "../../lib/httpError";
import { createTask } from "../task.service";
import { Actor } from "./access";
import { getTicket } from "./core";
import { sendText } from "./send.service";

export interface TicketTaskInput {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "none" | null;
  user_id?: number | null;
  due_at?: string | null;
  funnel_id?: number | null;
  stage_id?: number | null;
}

const taskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  due_at: true,
  user: { select: { id: true, first_name: true, last_name: true, photo: true } },
} as const;

export async function listTicketTasks(ticketId: number) {
  return prisma.task.findMany({ where: { ticket_id: ticketId, deleted_at: null }, select: taskSelect, orderBy: { created_at: "desc" } });
}

/** Cria uma tarefa a partir da conversa, ligada ao ticket (contexto do cliente já preenchido) e registra uma nota interna. */
export async function createTaskFromTicket(ticketId: number, actor: Actor, data: TicketTaskInput) {
  const ticket = await getTicket(ticketId);
  const number = ticket.contact.number ? `+${ticket.contact.number}` : "";
  const origin = [`Origem: atendimento via WhatsApp — ${ticket.contact.name}${number ? ` (${number})` : ""}`, ticket.queue ? `Fila: ${ticket.queue.name}` : ""]
    .filter(Boolean)
    .join("\n");
  const description = [data.description?.trim(), origin].filter(Boolean).join("\n\n");

  const assignee = data.user_id ?? actor.id;
  const task = await createTask(
    {
      title: data.title,
      description,
      priority: data.priority ?? undefined,
      user_id: assignee,
      due_at: data.due_at ?? undefined,
      funnel_id: data.funnel_id ?? undefined,
      stage_id: data.stage_id ?? undefined,
      first_name: ticket.contact.name,
    },
    actor.id
  );
  if (!task) throw new HttpError("Não foi possível criar a tarefa.");

  await prisma.task.update({ where: { id: task.id }, data: { ticket_id: ticketId } });
  const created = await prisma.task.findUnique({ where: { id: task.id }, select: taskSelect });
  emitAll("task_created", task);

  const author = await prisma.user.findUnique({ where: { id: actor.id }, select: { first_name: true } });
  await sendText({
    ticketId,
    body: `📌 ${author?.first_name ?? "Alguém"} criou a tarefa "${data.title}" a partir desta conversa.`,
    senderUserId: actor.id,
    isInternal: true,
  }).catch(() => {});

  return created;
}
