import { prisma } from "../lib/prisma";

export interface AgentInput {
  name: string;
  description?: string | null;
  avatar_emoji?: string | null;
  avatar_color?: string | null;
  provider: string;
  model: string;
  system_prompt: string;
  temperature?: number;
  max_tokens?: number;
  allowed_tools?: string[];
}

function toSafeAgent<T extends { allowed_tools: string | null }>(agent: T) {
  const { allowed_tools, ...rest } = agent;
  let tools: string[] = [];
  try {
    tools = allowed_tools ? JSON.parse(allowed_tools) : [];
  } catch {
    tools = [];
  }
  return { ...rest, allowed_tools: tools };
}

async function findOwnedAgent(agentId: number, userId: number) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, user_id: userId } });
  if (!agent) {
    throw new Error("Agente não encontrado ou você não tem acesso a ele.");
  }
  return agent;
}

export async function listAgents(userId: number) {
  const agents = await prisma.agent.findMany({ where: { user_id: userId }, orderBy: { created_at: "desc" } });
  return agents.map(toSafeAgent);
}

export async function getAgent(agentId: number, userId: number) {
  const agent = await findOwnedAgent(agentId, userId);
  return toSafeAgent(agent);
}

export async function getOwnedAgentRaw(agentId: number, userId: number) {
  return findOwnedAgent(agentId, userId);
}

export async function createAgent(userId: number, companyId: number | null, data: AgentInput) {
  const agent = await prisma.agent.create({
    data: {
      user_id: userId,
      company_id: companyId,
      name: data.name,
      description: data.description ?? null,
      avatar_emoji: data.avatar_emoji ?? null,
      avatar_color: data.avatar_color ?? "#6366f1",
      provider: data.provider,
      model: data.model,
      system_prompt: data.system_prompt,
      temperature: data.temperature ?? 0.7,
      max_tokens: data.max_tokens ?? 2048,
      allowed_tools: JSON.stringify(data.allowed_tools ?? []),
    },
  });
  return toSafeAgent(agent);
}

export async function updateAgent(agentId: number, userId: number, data: Partial<AgentInput> & { is_active?: boolean }) {
  await findOwnedAgent(agentId, userId);
  const agent = await prisma.agent.update({
    where: { id: agentId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.avatar_emoji !== undefined ? { avatar_emoji: data.avatar_emoji } : {}),
      ...(data.avatar_color !== undefined ? { avatar_color: data.avatar_color } : {}),
      ...(data.provider !== undefined ? { provider: data.provider } : {}),
      ...(data.model !== undefined ? { model: data.model } : {}),
      ...(data.system_prompt !== undefined ? { system_prompt: data.system_prompt } : {}),
      ...(data.temperature !== undefined ? { temperature: data.temperature } : {}),
      ...(data.max_tokens !== undefined ? { max_tokens: data.max_tokens } : {}),
      ...(data.allowed_tools !== undefined ? { allowed_tools: JSON.stringify(data.allowed_tools) } : {}),
      ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
    },
  });
  if (data.is_active !== undefined) void import("./agent-telegram/telegram.service").then((m) => m.syncTelegramBot(agentId)).catch(() => {});
  return toSafeAgent(agent);
}

export async function deleteAgent(agentId: number, userId: number) {
  await findOwnedAgent(agentId, userId);
  const { removeTelegram } = await import("./agent-telegram/telegram.service");
  await removeTelegram(agentId).catch(() => {});
  await prisma.agent.delete({ where: { id: agentId } });
  return { success: true };
}
