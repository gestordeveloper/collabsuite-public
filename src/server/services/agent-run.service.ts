import { prisma } from "../lib/prisma";
import { resolveApiKey } from "./ai-credential.service";
import { getAdapter } from "../lib/ai-providers/registry";
import { getToolDefinitions, executeTool } from "../lib/ai-providers/tools/registry";
import type { AiProvider, ChatContent, ChatContentPart, ChatMessageParam } from "../lib/ai-providers/types";
import { validatePipelineGraph, type PipelineNode } from "./agent-pipeline.service";
import { emitToRun } from "../lib/socket";
import { notifyUser } from "./notification.service";
import { fetchStoredFileBytes } from "../lib/fileStorage";
import { classifyAttachment, extractTextFromDocument, isSupportedImageMime } from "../lib/documentAnalysis";
import { injectRagContext } from "./agent-rag/rag.service";
import { openMcpToolset } from "./agent-mcp/mcp.service";
import { openCalendarToolset } from "./agent-calendar/calendar.service";
import { openRecordingsToolset } from "./recording-index/recordings.tools";
import type { ToolDefinition } from "../lib/ai-providers/types";

export interface MessageAttachmentInput {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

const MAX_TOOL_ITERATIONS = 8;

interface AgentLike {
  id: number;
  provider: string;
  model: string;
  system_prompt: string;
  temperature: number | null;
  max_tokens: number | null;
  allowed_tools: string | null;
  company_id?: number | null;
  rag_enabled?: boolean;
  recordings_enabled?: boolean;
}

/** Ferramentas adicionais por turno (ex.: "transferir para humano" no canal WhatsApp). */
export interface ExtraToolset {
  definitions: ToolDefinition[];
  /** Retorna null quando a ferramenta não é desta lista. */
  execute(name: string, args: Record<string, unknown>): Promise<string | null>;
}

export interface ToolCallLogEntry {
  tool: string;
  arguments: unknown;
  result: string;
}

interface RunTurnResult {
  text: string;
  toolCallLog: ToolCallLogEntry[];
  usage: { inputTokens: number; outputTokens: number; llmCalls: number };
  usedRag: boolean;
}

/** Runs one agent "turn": calls the provider, executes any requested tools, and re-calls the
 *  model with the tool results until it produces a final answer (bounded to avoid infinite loops).
 *  Shared by the standalone chat playground and, per pipeline node, the pipeline execution engine. */
export async function runAgentTurn(
  agent: AgentLike,
  messages: ChatMessageParam[],
  ctx: {
    userId: number;
    companyId: number | null;
    runId?: number;
    extraTools?: ExtraToolset;
    /** Origem do turno (para o registro de agendamentos feitos pelo agente). */
    channel?: string;
    contactJid?: string | null;
    contactName?: string | null;
  }
): Promise<RunTurnResult> {
  const provider = agent.provider as AiProvider;
  const apiKey = await resolveApiKey(provider, ctx.userId, ctx.companyId);
  const adapter = getAdapter(provider);

  let allowedTools: string[] = [];
  try {
    allowedTools = agent.allowed_tools ? JSON.parse(agent.allowed_tools) : [];
  } catch {
    allowedTools = [];
  }
  // Base de conhecimento (RAG): trechos relevantes à última mensagem do usuário entram no system prompt.
  let systemPrompt = agent.system_prompt;
  let usedRag = false;
  if (agent.rag_enabled) {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const query = !last ? "" : typeof last.content === "string" ? last.content : last.content.filter((p) => p.type === "text").map((p: any) => p.text).join(" ");
    if (query.trim()) systemPrompt = await injectRagContext({ id: agent.id, user_id: ctx.userId, company_id: ctx.companyId, system_prompt: systemPrompt }, query);
    usedRag = systemPrompt !== agent.system_prompt;
  }

  // Agenda: se o agente tem agendas liberadas, ganha as ferramentas de agenda e a data/hora atuais.
  const calendar = await openCalendarToolset(
    { id: agent.id, name: (agent as { name?: string }).name ?? "agente" },
    { channel: ctx.channel ?? "web", contactJid: ctx.contactJid, contactName: ctx.contactName }
  ).catch(() => null);
  if (calendar) systemPrompt = `${systemPrompt}

${calendar.promptNote}`;

  // Gravações: só no chat web/Telegram (o usuário é quem consulta); nunca no WhatsApp, onde quem fala é o cliente.
  const recordings = agent.recordings_enabled && (ctx.channel ?? "web") !== "whatsapp" ? openRecordingsToolset({ userId: ctx.userId, companyId: ctx.companyId }) : null;
  if (recordings) systemPrompt = `${systemPrompt}

${recordings.promptNote}`;

  // Ferramentas de servidores MCP do agente: uma sessão por turno, reaproveitada entre as chamadas.
  const mcp = await openMcpToolset(agent.id).catch(() => null);
  try {
    const tools = [
      ...getToolDefinitions(allowedTools),
      ...(ctx.extraTools?.definitions ?? []),
      ...(calendar?.definitions ?? []),
      ...(recordings?.definitions ?? []),
      ...(mcp?.definitions ?? []),
    ];
    const usage = { inputTokens: 0, outputTokens: 0, llmCalls: 0 };

    const conversation = [...messages];
    const toolCallLog: ToolCallLogEntry[] = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await adapter.chat({
        apiKey,
        model: agent.model,
        systemPrompt,
        messages: conversation,
        tools: tools.length ? tools : undefined,
        temperature: agent.temperature ?? undefined,
        maxTokens: agent.max_tokens ?? undefined,
      });

      usage.llmCalls++;
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;

      if (result.stopReason !== "tool_calls" || result.toolCalls.length === 0) {
        return { text: result.text || "", toolCallLog, usage, usedRag };
      }

      conversation.push({ role: "assistant", content: result.text || "", toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const toolResult =
          (await ctx.extraTools?.execute(call.name, call.arguments)) ??
          (await calendar?.execute(call.name, call.arguments)) ??
          (await recordings?.execute(call.name, call.arguments)) ??
          (await mcp?.execute(call.name, call.arguments)) ??
          (await executeTool(call.name, call.arguments, { ...ctx, agentId: agent.id }));
        toolCallLog.push({ tool: call.name, arguments: call.arguments, result: toolResult });
        conversation.push({ role: "tool", content: toolResult, tool_call_id: call.id });
      }
    }

    return { text: "Não foi possível concluir a resposta: limite de chamadas de ferramentas atingido.", toolCallLog, usage, usedRag };
  } finally {
    await mcp?.close();
  }
}

/** Deterministic ICP injection: resolved from an explicit @menção in the UI (icpIds), never left
 *  to the model's own judgment — this is what keeps different clients' ICPs from bleeding into
 *  each other across a conversation. Ownership-scoped so an id can't reference another user's ICP. */
async function buildMessageWithIcpContext(message: string, userId: number, icpIds?: number[]): Promise<string> {
  if (!icpIds || icpIds.length === 0) return message;

  const icps = await prisma.icp.findMany({ where: { id: { in: icpIds }, user_id: userId } });
  if (icps.length === 0) return message;

  const context = icps
    .map((icp) => `### ICP: ${icp.name}${icp.niche ? ` (${icp.niche})` : ""}\n${icp.description}`)
    .join("\n\n");

  return `[Contexto de ICP selecionado pelo usuário — use como referência de público-alvo para esta mensagem]\n\n${context}\n\n[Fim do contexto de ICP]\n\n${message}`;
}

/** Enriches the CURRENT user turn with any attached files — transient, exactly like ICP
 *  injection above: images become vision content blocks, documents/spreadsheets get their text
 *  extracted and appended. Never persisted "enriched" and never replayed on later turns, so
 *  attaching more files to a long conversation doesn't make every future turn's context grow
 *  unboundedly (the assistant's own reply about a file does stay in history normally, though). */
async function buildUserContentWithAttachments(
  enrichedText: string,
  attachments?: MessageAttachmentInput[]
): Promise<ChatContent> {
  if (!attachments || attachments.length === 0) return enrichedText;

  const imageParts: ChatContentPart[] = [];
  let addendum = "";

  for (const att of attachments) {
    const kind = classifyAttachment(att.mimeType, att.filename);
    try {
      if (kind === "image" && isSupportedImageMime(att.mimeType)) {
        const buffer = await fetchStoredFileBytes(att.url);
        imageParts.push({ type: "image", mimeType: att.mimeType, base64: buffer.toString("base64") });
      } else if (kind === "text-document") {
        const buffer = await fetchStoredFileBytes(att.url);
        const text = await extractTextFromDocument(buffer, att.mimeType, att.filename);
        addendum += `\n\n[Conteúdo do arquivo anexado: ${att.filename}]\n${text}\n[Fim do arquivo ${att.filename}]`;
      } else {
        addendum += `\n\n[Arquivo anexado "${att.filename}" não pôde ser analisado: tipo de arquivo não suportado.]`;
      }
    } catch (err: any) {
      addendum += `\n\n[Não foi possível ler o arquivo anexado "${att.filename}": ${err?.message || "erro desconhecido"}.]`;
    }
  }

  const fullText = enrichedText + addendum;
  if (imageParts.length === 0) return fullText;
  return [{ type: "text", text: fullText }, ...imageParts];
}

export async function runStandaloneAgent(
  agentId: number,
  userId: number,
  companyId: number | null,
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  icpIds?: number[],
  attachments?: MessageAttachmentInput[]
) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, user_id: userId } });
  if (!agent) {
    throw new Error("Agente não encontrado ou você não tem acesso a ele.");
  }

  const run = await prisma.agentRun.create({
    data: { user_id: userId, company_id: companyId, agent_id: agentId, status: "running", input: message, started_at: new Date() },
  });
  const step = await prisma.agentRunStep.create({
    data: { run_id: run.id, agent_id: agentId, step_order: 0, status: "running", input: message, started_at: new Date() },
  });

  const enrichedMessage = await buildMessageWithIcpContext(message, userId, icpIds);
  const userContent = await buildUserContentWithAttachments(enrichedMessage, attachments);
  const messages: ChatMessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userContent },
  ];

  try {
    const { text, toolCallLog } = await runAgentTurn(agent, messages, { userId, companyId, runId: run.id });

    await prisma.$transaction([
      prisma.agentRunStep.update({
        where: { id: step.id },
        data: { status: "done", output: text, tool_calls: JSON.stringify(toolCallLog), finished_at: new Date() },
      }),
      prisma.agentRun.update({
        where: { id: run.id },
        data: { status: "done", output: text, finished_at: new Date() },
      }),
    ]);

    return { run_id: run.id, output: text, tool_calls: toolCallLog };
  } catch (err: any) {
    const errorMessage = String(err?.message || err).slice(0, 500);
    await prisma.$transaction([
      prisma.agentRunStep.update({ where: { id: step.id }, data: { status: "error", error: errorMessage, finished_at: new Date() } }),
      prisma.agentRun.update({ where: { id: run.id }, data: { status: "error", error: errorMessage, finished_at: new Date() } }),
    ]);
    throw new Error(errorMessage);
  }
}

/** Creates the run + one pending step per pipeline node, then kicks off execution without
 *  awaiting it (fire-and-forget, like notifyUser) so the endpoint responds immediately. */
export async function startPipelineRun(pipelineId: number, userId: number, companyId: number | null, input: string) {
  const pipeline = await prisma.agentPipeline.findFirst({ where: { id: pipelineId, user_id: userId } });
  if (!pipeline) {
    throw new Error("Pipeline não encontrado ou você não tem acesso a ele.");
  }

  const nodes: PipelineNode[] = JSON.parse(pipeline.nodes);
  const edges = JSON.parse(pipeline.edges);
  const orderedNodes = validatePipelineGraph(nodes, edges);

  const run = await prisma.agentRun.create({
    data: { user_id: userId, company_id: companyId, pipeline_id: pipelineId, status: "pending", input },
  });

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    const agentId = Number((node.data as any)?.agentId);
    await prisma.agentRunStep.create({
      data: {
        run_id: run.id,
        node_id: node.id,
        agent_id: Number.isFinite(agentId) ? agentId : null,
        step_order: i,
        status: "pending",
      },
    });
  }

  executePipelineRun(run.id, userId, companyId).catch((err) => {
    console.error(`[agent-pipeline] Erro inesperado ao executar a run ${run.id}:`, err);
  });

  return { run_id: run.id };
}

async function executePipelineRun(runId: number, userId: number, companyId: number | null) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, include: { steps: { orderBy: { step_order: "asc" } } } });
  if (!run) return;

  await prisma.agentRun.update({ where: { id: runId }, data: { status: "running", started_at: new Date() } });
  emitToRun(runId, "run:started", { runId });

  let pipelineName = "Pipeline";
  if (run.pipeline_id) {
    const pipeline = await prisma.agentPipeline.findUnique({ where: { id: run.pipeline_id }, select: { name: true } });
    pipelineName = pipeline?.name || pipelineName;
  }

  let currentInput = run.input || "";
  let lastOutput = "";
  let failed = false;

  for (const step of run.steps) {
    if (!step.agent_id) {
      await prisma.agentRunStep.update({
        where: { id: step.id },
        data: { status: "error", error: "Nó sem agente vinculado.", finished_at: new Date() },
      });
      failed = true;
      break;
    }

    const agent = await prisma.agent.findUnique({ where: { id: step.agent_id } });
    if (!agent) {
      await prisma.agentRunStep.update({
        where: { id: step.id },
        data: { status: "error", error: "Agente não encontrado.", finished_at: new Date() },
      });
      failed = true;
      break;
    }

    await prisma.agentRunStep.update({ where: { id: step.id }, data: { status: "running", input: currentInput, started_at: new Date() } });
    emitToRun(runId, "run:step_started", { runId, stepId: step.id, nodeId: step.node_id });

    try {
      const { text, toolCallLog } = await runAgentTurn(agent, [{ role: "user", content: currentInput }], { userId, companyId, runId });
      await prisma.agentRunStep.update({
        where: { id: step.id },
        data: { status: "done", output: text, tool_calls: JSON.stringify(toolCallLog), finished_at: new Date() },
      });
      emitToRun(runId, "run:step_finished", { runId, stepId: step.id, nodeId: step.node_id, output: text });
      lastOutput = text;
      currentInput = `Entrada original: ${run.input}\n\nSaída do agente anterior (${agent.name}): ${text}`;
    } catch (err: any) {
      const errorMessage = String(err?.message || err).slice(0, 500);
      await prisma.agentRunStep.update({ where: { id: step.id }, data: { status: "error", error: errorMessage, finished_at: new Date() } });
      emitToRun(runId, "run:step_finished", { runId, stepId: step.id, nodeId: step.node_id, error: errorMessage });
      failed = true;
      break;
    }
  }

  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: failed ? "error" : "done", output: failed ? null : lastOutput, finished_at: new Date() },
  });
  emitToRun(runId, "run:finished", { runId, status: failed ? "error" : "done", output: lastOutput });

  notifyUser(userId, {
    type: "agent_run_finished",
    title: failed ? `Pipeline "${pipelineName}" falhou` : `Pipeline "${pipelineName}" concluído`,
    body: failed ? "Confira os detalhes da execução para entender o erro." : lastOutput.slice(0, 200),
    link: "/agentes/pipelines",
    metadata: { runId },
  }).catch(() => {});
}

/** Marks any run/step still "running" at process boot as errored — this in-process, queue-less
 *  execution engine has no way to resume a run that was interrupted by a server restart. */
export async function sweepStuckRuns() {
  const now = new Date();
  await prisma.agentRunStep.updateMany({
    where: { status: "running" },
    data: { status: "error", error: "Interrompida por reinício do servidor.", finished_at: now },
  });
  await prisma.agentRun.updateMany({
    where: { status: { in: ["pending", "running"] } },
    data: { status: "error", error: "Interrompida por reinício do servidor.", finished_at: now },
  });
}

export async function getRun(runId: number, userId: number) {
  const run = await prisma.agentRun.findFirst({
    where: { id: runId, user_id: userId },
    include: {
      steps: { orderBy: { step_order: "asc" } },
      agent: { select: { id: true, name: true } },
      pipeline: { select: { id: true, name: true } },
    },
  });
  if (!run) {
    throw new Error("Execução não encontrada.");
  }
  return run;
}

export async function listRuns(userId: number, opts: { pipelineId?: number; agentId?: number } = {}) {
  return prisma.agentRun.findMany({
    where: {
      user_id: userId,
      ...(opts.pipelineId ? { pipeline_id: opts.pipelineId } : {}),
      ...(opts.agentId ? { agent_id: opts.agentId } : {}),
    },
    orderBy: { created_at: "desc" },
    take: 50,
  });
}
