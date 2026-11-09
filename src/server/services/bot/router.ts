import type { BotFlow, BotFlowSession, ChatContact } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getTicket } from "../tickets/core";
import { renderTemplate, sendText } from "../tickets/send.service";
import { distributeAfterTriage, updateTicket } from "../tickets/ticket.service";
import { EngineContext, resumeSession } from "./engine";

export const ACTIVE_SESSION_STATUSES = ["running", "waiting_input", "waiting_timer"];

/**
 * Inicia ou retoma a sessão de um fluxo num ticket. Há no máximo uma sessão por (ticket, fluxo): se já existe,
 * retoma a que está em andamento ou — quando o fluxo permite — descarta a finalizada e recomeça do zero.
 */
export async function startOrResumeSession(flow: BotFlow, ctx: EngineContext): Promise<void> {
  if (!flow.published_graph) return;

  const existing = await prisma.botFlowSession.findUnique({ where: { ticket_id_flow_id: { ticket_id: ctx.ticketId, flow_id: flow.id } } });
  if (existing) {
    if (ACTIVE_SESSION_STATUSES.includes(existing.status)) {
      await resumeSession(existing, flow, ctx);
      return;
    }
    if (!flow.restart_on_reopen) return; // rodou uma vez e o fluxo não repete
    await prisma.botFlowSession.delete({ where: { id: existing.id } });
  }

  let session: BotFlowSession;
  try {
    session = await prisma.botFlowSession.create({ data: { ticket_id: ctx.ticketId, flow_id: flow.id, status: "running", variables: "{}" } });
  } catch (err: any) {
    if (err?.code !== "P2002") throw err;
    // Outra chamada criou a sessão no meio-tempo: aproveita a que ficou.
    const collision = await prisma.botFlowSession.findUnique({ where: { ticket_id_flow_id: { ticket_id: ctx.ticketId, flow_id: flow.id } } });
    if (collision && ACTIVE_SESSION_STATUSES.includes(collision.status)) await resumeSession(collision, flow, ctx);
    return;
  }
  await resumeSession(session, flow, ctx);
}

/**
 * Fluxos "automation" rodam em segundo plano para todo ticket (ex.: follow-up com um nó `wait`) e nunca assumem
 * a conversa — por isso são iniciados mesmo depois de um humano ter assumido o ticket.
 */
export async function ensureAutomationSessions(ticketId: number, contact: ChatContact, connectionId: number | null, body: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
  if (!ticket || ticket.status === "closed") return;

  const flows = await prisma.botFlow.findMany({ where: { type: "automation", is_active: true, published_graph: { not: null } } });
  for (const flow of flows) {
    if (flow.status_filter) {
      const allowed: string[] = JSON.parse(flow.status_filter);
      if (!allowed.includes(ticket.status)) continue;
    }
    const existing = await prisma.botFlowSession.findUnique({ where: { ticket_id_flow_id: { ticket_id: ticketId, flow_id: flow.id } } });
    if (existing) continue;
    // Sequencial de propósito: dois fluxos podem mexer no mesmo ticket (fila, atendente, etiqueta).
    await startOrResumeSession(flow, { connectionId, ticketId, contact, incomingBody: body });
  }
}

/** Menu numérico "clássico" — usado quando não há fluxo de entrada: uma fila só atribui direto, várias mostram a lista. */
async function legacyQueueMenu(ctx: EngineContext, greeting: string | null) {
  const queues = await prisma.ticketQueue.findMany({ orderBy: { id: "asc" } });
  if (queues.length === 0) return;

  if (queues.length === 1) {
    const [only] = queues;
    await updateTicket(ctx.ticketId, { queue_id: only.id });
    if (only.greeting_message) await sendText({ ticketId: ctx.ticketId, body: renderTemplate(only.greeting_message, ctx.contact.name), senderUserId: null });
    return;
  }

  const chosen = queues[parseInt((ctx.incomingBody || "").trim(), 10) - 1];
  if (chosen) {
    await updateTicket(ctx.ticketId, { queue_id: chosen.id });
    if (chosen.greeting_message) await sendText({ ticketId: ctx.ticketId, body: renderTemplate(chosen.greeting_message, ctx.contact.name), senderUserId: null });
    return;
  }

  const options = queues.map((q, i) => `*${i + 1}* - ${q.name}`).join("\n");
  const head = greeting ? `${greeting}\n` : "";
  await sendText({ ticketId: ctx.ticketId, body: renderTemplate(`${head}${options}`, ctx.contact.name), senderUserId: null });
}

/**
 * Ponto de entrada para toda mensagem recebida (individual, não enviada por nós) em ticket sem atendente humano.
 *  1. Sessão de bot em andamento tem prioridade: o fluxo é dono da conversa até um nó terminal.
 *  2. Sem fila: um fluxo de entrada ligado à conexão conduz; senão o menu numérico; senão só a saudação da conexão.
 *  3. Com fila e sem atendente: o fluxo da fila (se houver) tem uma chance antes de o ticket esperar um humano.
 */
export async function routeIncomingMessage(ticketId: number, contact: ChatContact, connectionId: number, body: string) {
  const ctx: EngineContext = { connectionId, ticketId, contact, incomingBody: body };
  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId }, select: { greeting_message: true } });
  let ticket = await getTicket(ticketId);

  const active = await prisma.botFlowSession.findFirst({ where: { ticket_id: ticketId, status: { in: ACTIVE_SESSION_STATUSES } } });
  if (active) {
    const flow = await prisma.botFlow.findUnique({ where: { id: active.flow_id } });
    if (flow?.published_graph) {
      await resumeSession(active, flow, ctx);
    } else {
      // Fluxo apagado/despublicado com sessão em andamento: não deixa o ticket preso, entrega a um humano.
      await prisma.botFlowSession.update({ where: { id: active.id }, data: { status: "transferred" } });
    }
  } else if (!ticket.queue_id && !ticket.user_id) {
    const entryFlow = await prisma.botFlow.findFirst({
      where: { type: "entry", is_active: true, published_graph: { not: null }, connections: { some: { connection_id: connectionId } } },
    });
    if (entryFlow) {
      await startOrResumeSession(entryFlow, ctx);
    } else if ((await prisma.ticketQueue.count()) > 0) {
      await legacyQueueMenu(ctx, connection?.greeting_message ?? null);
    } else if (connection?.greeting_message) {
      // Sem fila nenhuma: a saudação da conexão é a única boas-vindas possível — enviada uma vez só.
      const alreadyReplied = await prisma.ticketMessage.count({ where: { ticket_id: ticketId, from_me: true, is_internal: false } });
      if (!alreadyReplied) await sendText({ ticketId, body: renderTemplate(connection.greeting_message, contact.name), senderUserId: null });
    }
  }

  // Releitura: os ramos acima podem ter definido a fila numa outra instância.
  ticket = await getTicket(ticketId);
  if (ticket.queue_id && !ticket.user_id) {
    const queueFlow = await prisma.botFlow.findFirst({
      where: { type: "queue", queue_id: ticket.queue_id, is_active: true, published_graph: { not: null } },
    });
    if (queueFlow) {
      const existing = await prisma.botFlowSession.findUnique({ where: { ticket_id_flow_id: { ticket_id: ticketId, flow_id: queueFlow.id } } });
      const inFlight = existing && ACTIVE_SESSION_STATUSES.includes(existing.status);
      if (!existing || (!inFlight && queueFlow.restart_on_reopen)) await startOrResumeSession(queueFlow, ctx);
    }

    // Triagem concluída (nenhuma sessão esperando o cliente): agora o rodízio da fila pode escolher o atendente.
    const stillRunning = await prisma.botFlowSession.findFirst({ where: { ticket_id: ticketId, status: { in: ACTIVE_SESSION_STATUSES } }, select: { id: true } });
    if (!stillRunning) await distributeAfterTriage(ticketId).catch((err) => console.error("[bot] Falha no rodízio pós-triagem:", err?.message || err));
  }
}
