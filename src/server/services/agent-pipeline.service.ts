import { prisma } from "../lib/prisma";

export interface PipelineNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
}

export interface PipelineInput {
  name: string;
  description?: string | null;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

function toSafePipeline<T extends { nodes: string; edges: string }>(pipeline: T) {
  const { nodes, edges, ...rest } = pipeline;
  return { ...rest, nodes: JSON.parse(nodes), edges: JSON.parse(edges) };
}

async function findOwnedPipeline(pipelineId: number, userId: number) {
  const pipeline = await prisma.agentPipeline.findFirst({ where: { id: pipelineId, user_id: userId } });
  if (!pipeline) {
    throw new Error("Pipeline não encontrado ou você não tem acesso a ele.");
  }
  return pipeline;
}

/** Cadeia linear estrita para v1: cada nó pode ter no máximo 1 conexão de entrada e 1 de saída.
 *  Retorna os nós já ordenados do primeiro ao último. Branching/fan-in ficam fora do MVP. */
export function validatePipelineGraph(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
  if (nodes.length === 0) {
    throw new Error("O pipeline precisa de pelo menos um agente.");
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const nextOf = new Map<string, string>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    outgoing.set(n.id, 0);
  }

  for (const e of edges) {
    if (!incoming.has(e.target) || !outgoing.has(e.source)) {
      throw new Error("Conexão inválida: nó não encontrado no pipeline.");
    }
    incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
    outgoing.set(e.source, (outgoing.get(e.source) || 0) + 1);
    nextOf.set(e.source, e.target);
  }

  for (const n of nodes) {
    if ((incoming.get(n.id) || 0) > 1 || (outgoing.get(n.id) || 0) > 1) {
      throw new Error(
        "Este pipeline só suporta cadeias lineares por enquanto: cada agente pode ter no máximo 1 conexão de entrada e 1 de saída."
      );
    }
  }

  const starts = nodes.filter((n) => (incoming.get(n.id) || 0) === 0);
  if (starts.length !== 1) {
    throw new Error("O pipeline precisa ter exatamente um agente inicial, sem conexões de entrada.");
  }

  const ordered: PipelineNode[] = [];
  const visited = new Set<string>();
  let current: PipelineNode | undefined = starts[0];
  while (current) {
    if (visited.has(current.id)) {
      throw new Error("Ciclo detectado no pipeline.");
    }
    visited.add(current.id);
    ordered.push(current);
    const nextId = nextOf.get(current.id);
    current = nextId ? nodes.find((n) => n.id === nextId) : undefined;
  }

  if (ordered.length !== nodes.length) {
    throw new Error("Todos os agentes do pipeline precisam estar conectados em uma única cadeia.");
  }

  return ordered;
}

export async function listPipelines(userId: number) {
  const pipelines = await prisma.agentPipeline.findMany({ where: { user_id: userId }, orderBy: { created_at: "desc" } });
  return pipelines.map(toSafePipeline);
}

export async function getPipeline(pipelineId: number, userId: number) {
  const pipeline = await findOwnedPipeline(pipelineId, userId);
  return toSafePipeline(pipeline);
}

export async function createPipeline(userId: number, companyId: number | null, data: PipelineInput) {
  const pipeline = await prisma.agentPipeline.create({
    data: {
      user_id: userId,
      company_id: companyId,
      name: data.name,
      description: data.description ?? null,
      nodes: JSON.stringify(data.nodes),
      edges: JSON.stringify(data.edges),
    },
  });
  return toSafePipeline(pipeline);
}

export async function updatePipeline(pipelineId: number, userId: number, data: Partial<PipelineInput> & { is_active?: boolean }) {
  await findOwnedPipeline(pipelineId, userId);

  // No graph validation here on purpose: the canvas autosaves on every change, and a
  // work-in-progress pipeline is routinely disconnected or empty while being edited.
  // The linear-chain rule is only enforced where it matters — at run time (startPipelineRun).
  const pipeline = await prisma.agentPipeline.update({
    where: { id: pipelineId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.nodes !== undefined ? { nodes: JSON.stringify(data.nodes) } : {}),
      ...(data.edges !== undefined ? { edges: JSON.stringify(data.edges) } : {}),
      ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
    },
  });
  return toSafePipeline(pipeline);
}

export async function deletePipeline(pipelineId: number, userId: number) {
  await findOwnedPipeline(pipelineId, userId);
  await prisma.agentPipeline.delete({ where: { id: pipelineId } });
  return { success: true };
}
