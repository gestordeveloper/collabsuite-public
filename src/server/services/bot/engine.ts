import type { BotFlow, BotFlowSession, ChatContact } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { emitToUsers } from "../../lib/socket";
import { notifyUser } from "../notification.service";
import { audienceUserIds } from "../tickets/access";
import { broadcastTicket, getTicket } from "../tickets/core";
import { sendMedia, sendText as sendTicketText, renderTemplate as renderText, mediaCategory } from "../tickets/send.service";
import { updateTicket } from "../tickets/ticket.service";
import { BotFlowEdge, BotFlowGraph, BotFlowMenuOption, BotFlowNode, matchMenuOption, parseGraph } from "./graph";

// Teto de nós não-interativos executados numa mesma chamada: um ciclo (message -> condition -> message…)
// travaria a requisição em vez de falhar alto; ao estourar, o ticket vai para um humano.
const MAX_STEPS = 50;

export interface EngineContext {
  connectionId: number | null;
  ticketId: number;
  contact: ChatContact;
  incomingBody?: string;
}

const render = (text: string | undefined, contact: ChatContact, variables: Record<string, string>): string =>
  text ? renderText(text, contact.name, variables) : "";

const nextEdge = (edges: BotFlowEdge[], nodeId: string, handle?: string): BotFlowEdge | undefined =>
  edges.find((e) => e.source === nodeId && (handle === undefined || e.sourceHandle === handle));

const minutesSince = (date: Date | null | undefined): number =>
  date ? Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000)) : 999999;

/** Variáveis reservadas (prefixo `__`), sempre recalculadas a partir do estado atual do ticket. */
async function loadBuiltInVariables(ticketId: number): Promise<Record<string, string>> {
  const [ticket, last, lastClient] = await Promise.all([
    prisma.ticket.findUnique({ where: { id: ticketId } }),
    prisma.ticketMessage.findFirst({ where: { ticket_id: ticketId, is_internal: false }, orderBy: { id: "desc" } }),
    prisma.ticketMessage.findFirst({ where: { ticket_id: ticketId, from_me: false }, orderBy: { id: "desc" } }),
  ]);
  return {
    __ticketStatus: ticket?.status ?? "",
    __ticketUserId: ticket?.user_id ? String(ticket.user_id) : "",
    __ticketQueueId: ticket?.queue_id ? String(ticket.queue_id) : "",
    __lastMessageFromMe: last?.from_me ? "true" : "false",
    __minutesSinceLastMessage: String(minutesSince(last?.created_at)),
    __minutesSinceLastClientMessage: String(minutesSince(lastClient?.created_at)),
    // O CollabSuite ainda não tem horário comercial configurável: sempre "dentro do horário".
    __isBusinessHours: "true",
    __businessHoursLabel: "",
    __businessHoursNextOpen: "",
  };
}

async function sendBotText(ctx: EngineContext, body: string) {
  if (!body.trim()) return;
  try {
    await sendTicketText({ ticketId: ctx.ticketId, body, senderUserId: null });
  } catch (err) {
    console.error("[bot] Falha ao enviar mensagem:", (err as Error)?.message || err);
  }
}

async function sendMenuPrompt(node: BotFlowNode, ctx: EngineContext, variables: Record<string, string>) {
  const options: BotFlowMenuOption[] = node.data.options || [];
  let text = render(node.data.prompt, ctx.contact, variables);
  options.forEach((option, index) => {
    text += `\n*${index + 1}* - ${option.label}`;
  });
  await sendBotText(ctx, text);
}

async function sendMediaFromUrl(ctx: EngineContext, node: BotFlowNode, category: "image" | "video" | "audio", variables: Record<string, string>) {
  const url = render(node.data.url, ctx.contact, variables).trim();
  if (!/^https?:\/\//i.test(url)) throw new Error(`URL de mídia inválida: ${url}`);

  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar a mídia`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const headerMime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const fallbackMime = category === "image" ? "image/jpeg" : category === "video" ? "video/mp4" : "audio/mpeg";
  const mimetype = headerMime && headerMime !== "application/octet-stream" ? headerMime : fallbackMime;
  const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || `${category}`) || category;

  await sendMedia({
    ticketId: ctx.ticketId,
    buffer,
    mimetype,
    filename,
    caption: render(node.data.caption, ctx.contact, variables) || undefined,
    senderUserId: null,
    voice: category === "audio" && mediaCategory(mimetype) === "audio",
  });
}

function evaluateCondition(node: BotFlowNode, variables: Record<string, string>): boolean {
  const { variable, operator, value } = node.data;
  const actual = (variables[variable] ?? "").toString();
  const expected = (value ?? "").toString();
  switch (operator) {
    case "equals":
      return actual.trim().toLowerCase() === expected.trim().toLowerCase();
    case "contains":
      return actual.toLowerCase().includes(expected.toLowerCase());
    case "gt":
      return parseFloat(actual) > parseFloat(expected);
    case "lt":
      return parseFloat(actual) < parseFloat(expected);
    default:
      return false;
  }
}

/** Aplica a resposta que acabou de chegar ao nó interativo (pergunta/menu) em que a sessão estava parada. */
function consumeAnswer(node: BotFlowNode, graph: BotFlowGraph, variables: Record<string, string>, incoming: string): { nextNodeId: string | null; invalid?: boolean } {
  if (node.type === "question") {
    if (node.data.variable) variables[node.data.variable] = (incoming || "").trim();
    return { nextNodeId: nextEdge(graph.edges, node.id)?.target ?? null };
  }
  if (node.type === "menu") {
    const chosen = matchMenuOption(node.data.options || [], incoming || "");
    if (!chosen) return { nextNodeId: null, invalid: true };
    return { nextNodeId: nextEdge(graph.edges, node.id, chosen.id)?.target ?? null };
  }
  // O fluxo foi editado depois de a sessão parar: recomeça deste nó como um passo novo.
  return { nextNodeId: node.id };
}

type SessionPatch = Partial<{ status: string; current_node_id: string | null; waiting_since: Date | null; resume_at: Date | null }>;

/**
 * Roda (ou retoma) uma sessão no grafo *publicado* até um nó interativo (pergunta/menu — espera a próxima
 * mensagem) ou terminal (transferir/fim). A posição é gravada a cada parada, então a próxima mensagem do
 * cliente continua exatamente de onde esta chamada parou.
 */
export async function resumeSession(session: BotFlowSession, flow: BotFlow, ctx: EngineContext): Promise<void> {
  const graph = parseGraph(flow.published_graph);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const variables: Record<string, string> = JSON.parse(session.variables || "{}");
  Object.assign(variables, await loadBuiltInVariables(ctx.ticketId));

  const persist = async (patch: SessionPatch) => {
    await prisma.botFlowSession.update({ where: { id: session.id }, data: { ...patch, variables: JSON.stringify(variables) } });
  };

  // Primeira execução: a mensagem que iniciou a sessão pode já dizer o que o cliente quer — um menu
  // alcançado agora consome essa mensagem por palavra-chave em vez de perguntar de novo.
  let pendingFirstMessage: string | null = session.status === "running" && !session.current_node_id ? ctx.incomingBody || "" : null;

  let nodeId: string | null = session.current_node_id || graph.startNodeId || null;
  let node = nodeId ? nodesById.get(nodeId) : undefined;

  // Sessão acordada pelo worker de timers: pula o próprio nó `wait` e segue pela aresta que sai dele.
  if (session.status === "waiting_timer" && node && node.type === "wait") {
    nodeId = nextEdge(graph.edges, node.id)?.target ?? null;
    node = nodeId ? nodesById.get(nodeId) : undefined;
  }

  if (session.status === "waiting_input" && node) {
    const answer = consumeAnswer(node, graph, variables, ctx.incomingBody || "");
    if (answer.invalid) {
      if (node.type === "menu" && node.data.fallbackMessage) {
        await sendBotText(ctx, render(node.data.fallbackMessage, ctx.contact, variables));
      } else {
        await sendMenuPrompt(node, ctx, variables);
      }
      return;
    }
    nodeId = answer.nextNodeId;
    node = nodeId ? nodesById.get(nodeId) : undefined;
  }

  let steps = 0;
  while (node) {
    if (steps++ > MAX_STEPS) {
      console.error(`[bot] Limite de passos excedido (fluxo ${flow.id}, ticket ${ctx.ticketId}); entregando a um humano.`);
      await persist({ status: "transferred", current_node_id: node.id });
      return;
    }

    switch (node.type) {
      case "message": {
        await sendBotText(ctx, render(node.data.text, ctx.contact, variables));
        nodeId = nextEdge(graph.edges, node.id)?.target ?? null;
        break;
      }

      case "image":
      case "video":
      case "audio": {
        try {
          await sendMediaFromUrl(ctx, node, node.type, variables);
        } catch (err) {
          console.error(`[bot] Nó de mídia falhou (fluxo ${flow.id}, nó ${node.id}):`, (err as Error)?.message || err);
        }
        nodeId = nextEdge(graph.edges, node.id)?.target ?? null;
        break;
      }

      case "set_variable": {
        if (node.data.variable) variables[node.data.variable] = render(node.data.value, ctx.contact, variables);
        nodeId = nextEdge(graph.edges, node.id)?.target ?? null;
        break;
      }

      case "wait": {
        const minutes = parseFloat(node.data.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          nodeId = nextEdge(graph.edges, node.id)?.target ?? null;
          break;
        }
        await persist({ status: "waiting_timer", current_node_id: node.id, resume_at: new Date(Date.now() + minutes * 60000) });
        return;
      }

      case "add_tag": {
        const tagIds: number[] = Array.isArray(node.data.tagIds) ? node.data.tagIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : [];
        if (tagIds.length) {
          try {
            const valid = await prisma.ticketTag.findMany({ where: { id: { in: tagIds } }, select: { id: true } });
            await prisma.ticket.update({ where: { id: ctx.ticketId }, data: { tags: { connect: valid.map((t) => ({ id: t.id })) } } });
            await broadcastTicket(await getTicket(ctx.ticketId));
          } catch (err) {
            console.error("[bot] Falha ao aplicar etiquetas:", (err as Error)?.message || err);
          }
        }
        nodeId = nextEdge(graph.edges, node.id)?.target ?? null;
        break;
      }

      case "condition": {
        const result = evaluateCondition(node, variables);
        nodeId = nextEdge(graph.edges, node.id, result ? "true" : "false")?.target ?? null;
        break;
      }

      case "question": {
        await sendBotText(ctx, render(node.data.prompt, ctx.contact, variables));
        await persist({ status: "waiting_input", current_node_id: node.id, waiting_since: new Date() });
        return;
      }

      case "menu": {
        const firstMessage = pendingFirstMessage;
        pendingFirstMessage = null;
        const early = firstMessage ? matchMenuOption(node.data.options || [], firstMessage, false) : null;
        if (early) {
          nodeId = nextEdge(graph.edges, node.id, early.id)?.target ?? null;
          break;
        }
        await sendMenuPrompt(node, ctx, variables);
        await persist({ status: "waiting_input", current_node_id: node.id, waiting_since: new Date() });
        return;
      }

      case "transfer_queue": {
        if (node.data.queueId) {
          try {
            // Se a fila tem fluxo de triagem próprio, ele precisa rodar antes de o rodízio entregar o ticket a alguém
            // (atendente atribuído = o roteador não inicia mais o fluxo da fila).
            const queueId = Number(node.data.queueId);
            const triage = await prisma.botFlow.findFirst({ where: { type: "queue", queue_id: queueId, is_active: true, published_graph: { not: null } }, select: { id: true } });
            await updateTicket(ctx.ticketId, { queue_id: queueId, defer_distribution: !!triage });
          } catch (err) {
            console.error("[bot] Falha ao transferir para a fila:", (err as Error)?.message || err);
          }
        }
        await persist({ status: "transferred", current_node_id: node.id, waiting_since: null });
        return;
      }

      case "transfer_agent": {
        if (node.data.userId) {
          try {
            await updateTicket(ctx.ticketId, { user_id: Number(node.data.userId), status: "open" });
          } catch (err) {
            console.error("[bot] Falha ao atribuir ao atendente:", (err as Error)?.message || err);
          }
        }
        await persist({ status: "transferred", current_node_id: node.id, waiting_since: null });
        return;
      }

      case "notify_agent": {
        const body = render(node.data.message, ctx.contact, variables);
        if (body) {
          try {
            // Vira uma nota interna no histórico (o cliente nunca recebe) e avisa o responsável/a fila.
            await sendTicketText({ ticketId: ctx.ticketId, body: `🤖 ${body}`, senderUserId: null, isInternal: true });
            const ticket = await getTicket(ctx.ticketId);
            const targets = node.data.userId ? [Number(node.data.userId)] : ticket.user_id ? [ticket.user_id] : await audienceUserIds(ticket);
            emitToUsers(targets, "ticket_alert", { ticketId: ticket.id, message: body });
            if (node.data.userId || ticket.user_id) {
              notifyUser(targets[0], {
                type: "ticket_created",
                title: `Aviso do bot — ${ticket.contact.name}`,
                body,
                link: `/atendimento/${ticket.id}`,
                metadata: { ticketId: ticket.id },
              }).catch(() => {});
            }
          } catch (err) {
            console.error("[bot] Falha ao avisar atendente:", (err as Error)?.message || err);
          }
        }
        nodeId = nextEdge(graph.edges, node.id)?.target ?? null;
        break;
      }

      case "http_request": {
        const currentNodeId = node.id;
        const method = (node.data.method || "GET").toString().toUpperCase();
        const url = render(node.data.url, ctx.contact, variables);
        const body = render(node.data.body, ctx.contact, variables);
        const headers: Record<string, string> = {};
        (Array.isArray(node.data.headers) ? node.data.headers : []).forEach((h: { key?: string; value?: string }) => {
          if (h?.key) headers[h.key] = render(h.value, ctx.contact, variables);
        });
        const follow = (ok: boolean): string | null =>
          nextEdge(graph.edges, currentNodeId, ok ? "success" : "error")?.target ?? nextEdge(graph.edges, currentNodeId)?.target ?? null;

        try {
          if (!url || !/^https?:\/\//i.test(url.trim())) throw new Error(`URL inválida: ${JSON.stringify(url)}`);
          const init: RequestInit = { method, signal: AbortSignal.timeout(15000) };
          if (Object.keys(headers).length) init.headers = headers;
          if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && body) init.body = body;
          const resp = await fetch(url.trim(), init);
          const text = await resp.text().catch(() => "");
          if (node.data.variable) variables[node.data.variable] = text;
          variables["__http_status"] = String(resp.status);
          nodeId = follow(resp.status >= 200 && resp.status < 400);
        } catch (err) {
          console.error(`[bot] http_request falhou (fluxo ${flow.id}, nó ${node.id}):`, (err as Error)?.message || err);
          variables["__http_status"] = "0";
          nodeId = follow(false);
        }
        break;
      }

      case "end": {
        await sendBotText(ctx, render(node.data.text, ctx.contact, variables));
        await persist({ status: "completed", current_node_id: node.id, waiting_since: null });
        return;
      }

      default: {
        console.error(`[bot] Tipo de nó desconhecido "${node.type}" (fluxo ${flow.id}); entregando a um humano.`);
        await persist({ status: "transferred", current_node_id: node.id });
        return;
      }
    }

    node = nodeId ? nodesById.get(nodeId) : undefined;
  }

  // Saiu do grafo (último nó sem aresta de saída) sem um nó terminal: encerra como um "fim".
  await persist({ status: "completed", current_node_id: null, waiting_since: null });
}
