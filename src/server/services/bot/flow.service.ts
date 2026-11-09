import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { parseGraph } from "./graph";

const include = {
  connections: { select: { connection_id: true } },
  queue: { select: { id: true, name: true, color: true } },
} as const;

function shape(row: any) {
  const { connections, ...rest } = row;
  return {
    ...rest,
    connection_ids: connections.map((c: any) => c.connection_id),
    has_unpublished_changes: !!rest.draft_graph && rest.draft_graph !== rest.published_graph,
  };
}

export type FlowType = "entry" | "queue" | "automation";

export interface FlowInput {
  name?: string;
  type?: FlowType;
  queue_id?: number | null;
  is_active?: boolean;
  restart_on_reopen?: boolean;
  status_filter?: string[] | null;
  connection_ids?: number[];
  draft_graph?: unknown;
}

export async function listFlows() {
  const rows = await prisma.botFlow.findMany({ include, orderBy: { updated_at: "desc" } });
  // A lista não carrega os grafos (podem ser grandes); o editor busca o fluxo individual.
  return rows.map(({ draft_graph, published_graph, ...rest }) => shape({ ...rest, draft_graph, published_graph })).map(({ draft_graph, published_graph, ...rest }) => rest);
}

export async function getFlow(id: number) {
  const row = await prisma.botFlow.findUnique({ where: { id }, include });
  if (!row) throw new HttpError("Fluxo não encontrado.", 404);
  return shape(row);
}

async function validateRefs(type: FlowType, data: FlowInput) {
  if (type === "queue") {
    if (!data.queue_id) throw new HttpError("Escolha a fila deste fluxo.");
    const q = await prisma.ticketQueue.findUnique({ where: { id: data.queue_id }, select: { id: true } });
    if (!q) throw new HttpError("Fila não encontrada.", 404);
  }
  if (data.connection_ids?.length) {
    const found = await prisma.whatsAppConnection.count({ where: { id: { in: data.connection_ids } } });
    if (found !== new Set(data.connection_ids).size) throw new HttpError("Conexão não encontrada.", 404);
  }
}

const serializeGraph = (g: unknown) => (g === undefined ? undefined : typeof g === "string" ? g : JSON.stringify(g));

export async function createFlow(data: FlowInput & { name: string; type: FlowType }) {
  await validateRefs(data.type, data);
  const row = await prisma.botFlow.create({
    data: {
      name: data.name,
      type: data.type,
      queue_id: data.type === "queue" ? data.queue_id ?? null : null,
      is_active: data.is_active ?? true,
      restart_on_reopen: data.restart_on_reopen ?? false,
      status_filter: data.status_filter ? JSON.stringify(data.status_filter) : null,
      draft_graph: serializeGraph(data.draft_graph) ?? JSON.stringify({ nodes: [], edges: [], startNodeId: "" }),
      connections: data.type === "entry" ? { create: [...new Set(data.connection_ids ?? [])].map((connection_id) => ({ connection_id })) } : undefined,
    },
    include,
  });
  return shape(row);
}

export async function updateFlow(id: number, data: FlowInput) {
  const existing = await prisma.botFlow.findUnique({ where: { id } });
  if (!existing) throw new HttpError("Fluxo não encontrado.", 404);
  const type = (data.type ?? existing.type) as FlowType;
  await validateRefs(type, { ...data, queue_id: data.queue_id !== undefined ? data.queue_id : existing.queue_id });

  const row = await prisma.$transaction(async (tx) => {
    if (data.connection_ids) {
      await tx.botFlowConnection.deleteMany({ where: { flow_id: id } });
      if (type === "entry") {
        await tx.botFlowConnection.createMany({ data: [...new Set(data.connection_ids)].map((connection_id) => ({ flow_id: id, connection_id })) });
      }
    }
    return tx.botFlow.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.queue_id !== undefined || data.type ? { queue_id: type === "queue" ? (data.queue_id !== undefined ? data.queue_id : existing.queue_id) : null } : {}),
        ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
        ...(data.restart_on_reopen !== undefined ? { restart_on_reopen: data.restart_on_reopen } : {}),
        ...(data.status_filter !== undefined ? { status_filter: data.status_filter ? JSON.stringify(data.status_filter) : null } : {}),
        ...(data.draft_graph !== undefined ? { draft_graph: serializeGraph(data.draft_graph) } : {}),
      },
      include,
    });
  });
  return shape(row);
}

export async function deleteFlow(id: number) {
  const existing = await prisma.botFlow.findUnique({ where: { id } });
  if (!existing) throw new HttpError("Fluxo não encontrado.", 404);
  await prisma.botFlow.delete({ where: { id } });
  return { success: true };
}

/** O que está no rascunho passa a valer para os clientes; o rascunho continua editável sem afetar quem já está no fluxo. */
export async function publishFlow(id: number) {
  const flow = await prisma.botFlow.findUnique({ where: { id } });
  if (!flow) throw new HttpError("Fluxo não encontrado.", 404);

  const graph = parseGraph(flow.draft_graph);
  if (graph.nodes.length === 0 || !graph.startNodeId) throw new HttpError("O fluxo está vazio: adicione ao menos um nó e defina o início.");
  if (!graph.nodes.some((n) => n.id === graph.startNodeId)) throw new HttpError("O nó inicial do fluxo não existe mais.");

  const row = await prisma.botFlow.update({ where: { id }, data: { published_graph: flow.draft_graph, published_at: new Date() }, include });
  return shape(row);
}
