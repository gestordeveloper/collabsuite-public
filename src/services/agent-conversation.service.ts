import api from "./api";
import type { ChatRole, ToolCallEntry } from "./agent.service";

export interface ConversationSummary {
  id: number;
  agent_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview: string | null;
}

export interface MessageAttachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ConversationMessage {
  id: number;
  role: ChatRole;
  content: string;
  tool_calls: ToolCallEntry[];
  attachments: MessageAttachment[];
  created_at: string;
}

export interface ConversationDetail {
  id: number;
  agent_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: ConversationMessage[];
}

export interface SendConversationMessageResult {
  conversation: { id: number; title: string | null; created_at: string; updated_at: string };
  message: ConversationMessage;
  run_id: number;
}

export async function fetchConversations(agentId: number) {
  const { data } = await api.get(`/agents/${agentId}/conversations`);
  return data as ConversationSummary[];
}

export async function fetchConversation(conversationId: number) {
  const { data } = await api.get(`/conversations/${conversationId}`);
  return data as ConversationDetail;
}

export async function renameConversation(conversationId: number, title: string) {
  const { data } = await api.put(`/conversations/${conversationId}`, { title });
  return data as { id: number; title: string | null; updated_at: string };
}

export async function deleteConversation(conversationId: number) {
  await api.delete(`/conversations/${conversationId}`);
}

export async function sendConversationMessage(
  agentId: number,
  payload: { conversation_id?: number | null; message: string; icp_ids?: number[]; attachments?: MessageAttachment[] }
) {
  const { data } = await api.post(`/agents/${agentId}/conversations/messages`, payload);
  return data as SendConversationMessageResult;
}
