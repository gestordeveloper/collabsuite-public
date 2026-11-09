import { prisma } from "../lib/prisma";
import { getOwnedAgentRaw } from "./agent.service";
import { runStandaloneAgent } from "./agent-run.service";
import type { ToolCallLogEntry, MessageAttachmentInput } from "./agent-run.service";

const TITLE_MAX_LEN = 80;
const PREVIEW_MAX_LEN = 80;

function truncate(text: string, max: number): string {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function parseToolCalls(json: string | null): ToolCallLogEntry[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function parseAttachments(json: string | null): MessageAttachmentInput[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

async function findOwnedConversation(conversationId: number, userId: number) {
  const conversation = await prisma.agentConversation.findFirst({ where: { id: conversationId, user_id: userId } });
  if (!conversation) {
    throw new Error("Conversa não encontrada ou você não tem acesso a ela.");
  }
  return conversation;
}

export async function listConversations(agentId: number, userId: number) {
  const conversations = await prisma.agentConversation.findMany({
    where: { agent_id: agentId, user_id: userId },
    orderBy: { updated_at: "desc" },
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { created_at: "desc" }, take: 1 },
    },
  });
  return conversations.map((c) => ({
    id: c.id,
    agent_id: c.agent_id,
    title: c.title,
    created_at: c.created_at,
    updated_at: c.updated_at,
    message_count: c._count.messages,
    last_message_preview: c.messages[0] ? truncate(c.messages[0].content, PREVIEW_MAX_LEN) : null,
  }));
}

export async function getConversation(conversationId: number, userId: number) {
  const conversation = await findOwnedConversation(conversationId, userId);
  const messages = await prisma.agentConversationMessage.findMany({
    where: { conversation_id: conversationId },
    orderBy: { created_at: "asc" },
  });
  return {
    id: conversation.id,
    agent_id: conversation.agent_id,
    title: conversation.title,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      tool_calls: parseToolCalls(m.tool_calls),
      attachments: parseAttachments(m.attachments),
      created_at: m.created_at,
    })),
  };
}

export async function renameConversation(conversationId: number, userId: number, title: string) {
  await findOwnedConversation(conversationId, userId);
  const updated = await prisma.agentConversation.update({ where: { id: conversationId }, data: { title } });
  return { id: updated.id, title: updated.title, updated_at: updated.updated_at };
}

export async function deleteConversation(conversationId: number, userId: number) {
  await findOwnedConversation(conversationId, userId);
  await prisma.agentConversation.delete({ where: { id: conversationId } });
  return { success: true };
}

export async function sendMessage(params: {
  agentId: number;
  conversationId: number | null;
  userId: number;
  companyId: number | null;
  message: string;
  icpIds?: number[];
  attachments?: MessageAttachmentInput[];
}) {
  const { agentId, conversationId, userId, companyId, message, icpIds, attachments } = params;

  await getOwnedAgentRaw(agentId, userId);

  let existing: { id: number; title: string | null } | null = null;
  let history: { role: "user" | "assistant"; content: string }[] = [];

  if (conversationId != null) {
    const conversation = await findOwnedConversation(conversationId, userId);
    if (conversation.agent_id !== agentId) {
      throw new Error("Esta conversa pertence a outro agente.");
    }
    existing = conversation;
    const priorMessages = await prisma.agentConversationMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: "asc" },
    });
    history = priorMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  // Mensagem sem texto (só anexo) ainda precisa de algo para salvar/exibir e para o próprio modelo
  // entender o pedido — "message" continua obrigatório na função abaixo, mas nunca fica vazio aqui.
  const displayMessage = message.trim() || "(arquivo anexado)";

  // Chama o executor de turno já existente sem alterá-lo — ele cuida de tool calls,
  // AgentRun/AgentRunStep de auditoria e do vínculo de imagens geradas.
  const { run_id, output, tool_calls } = await runStandaloneAgent(
    agentId,
    userId,
    companyId,
    displayMessage,
    history,
    icpIds,
    attachments
  );

  return prisma.$transaction(async (tx) => {
    const conversation = existing
      ? existing
      : await tx.agentConversation.create({
          data: { agent_id: agentId, user_id: userId, company_id: companyId, title: null },
        });

    await tx.agentConversationMessage.create({
      data: {
        conversation_id: conversation.id,
        role: "user",
        content: displayMessage,
        attachments: attachments && attachments.length > 0 ? JSON.stringify(attachments) : null,
      },
    });
    const assistantMessage = await tx.agentConversationMessage.create({
      data: { conversation_id: conversation.id, role: "assistant", content: output, tool_calls: JSON.stringify(tool_calls) },
    });

    const updatedConversation = await tx.agentConversation.update({
      where: { id: conversation.id },
      data: conversation.title == null ? { title: truncate(displayMessage, TITLE_MAX_LEN) } : {},
    });

    return {
      conversation: {
        id: updatedConversation.id,
        title: updatedConversation.title,
        created_at: updatedConversation.created_at,
        updated_at: updatedConversation.updated_at,
      },
      message: {
        id: assistantMessage.id,
        role: "assistant" as const,
        content: assistantMessage.content,
        tool_calls,
        created_at: assistantMessage.created_at,
      },
      run_id,
    };
  });
}
