import api from "./api";
import type { AiProvider } from "./ai-credential.service";

export interface Agent {
  id: number;
  company_id?: number | null;
  user_id: number;
  name: string;
  description?: string | null;
  avatar_emoji?: string | null;
  avatar_color?: string | null;
  provider: AiProvider;
  model: string;
  system_prompt: string;
  temperature?: number | null;
  max_tokens?: number | null;
  allowed_tools: string[];
  is_active: boolean;
  channel_connection_id?: number | null;
  channel_enabled?: boolean;
  rag_enabled?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentPayload {
  name: string;
  description?: string | null;
  avatar_emoji?: string | null;
  avatar_color?: string | null;
  provider: AiProvider;
  model: string;
  system_prompt: string;
  temperature?: number;
  max_tokens?: number;
  allowed_tools?: string[];
  is_active?: boolean;
}

export type ChatRole = "user" | "assistant";

export interface ToolCallEntry {
  tool: string;
  arguments: unknown;
  result: string;
}

export interface ChatHistoryMessage {
  role: ChatRole;
  content: string;
}

export interface AgentRunResult {
  run_id: number;
  output: string;
  tool_calls: ToolCallEntry[];
}

export async function fetchAgents() {
  const { data } = await api.get("/agents");
  return data as Agent[];
}

export async function fetchAgent(agentId: number) {
  const { data } = await api.get(`/agents/${agentId}`);
  return data as Agent;
}

export async function createAgent(payload: AgentPayload) {
  const { data } = await api.post("/agents", payload);
  return data as Agent;
}

export async function updateAgent(agentId: number, payload: Partial<AgentPayload>) {
  const { data } = await api.put(`/agents/${agentId}`, payload);
  return data as Agent;
}

export async function deleteAgent(agentId: number) {
  await api.delete(`/agents/${agentId}`);
}

export async function runAgent(agentId: number, message: string, history?: ChatHistoryMessage[], icpIds?: number[]) {
  const { data } = await api.post(`/agents/${agentId}/run`, { message, history, icp_ids: icpIds });
  return data as AgentRunResult;
}
