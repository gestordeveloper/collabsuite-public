import api from "./api";

export interface ChannelSettings {
  channel_connection_id: number | null;
  channel_enabled: boolean;
  rag_enabled: boolean;
  session_ttl_seconds: number;
  buffer_delay_seconds: number;
  humanize_replies: boolean;
  handoff_enabled: boolean;
  recordings_enabled: boolean;
  connection: { id: number; label: string; phone_number: string | null; status: string; receive_tickets: boolean } | null;
  qdrant_configured: boolean;
}

export type ChannelSettingsPatch = Partial<
  Pick<
    ChannelSettings,
    "channel_connection_id" | "channel_enabled" | "rag_enabled" | "session_ttl_seconds" | "buffer_delay_seconds" | "humanize_replies" | "handoff_enabled" | "recordings_enabled"
  >
>;

export interface ChannelSession {
  id: number;
  contact_jid: string;
  contact_name: string | null;
  phone: string;
  messages: number;
  handed_off: boolean;
  expires_at: string | null;
  expired: boolean;
  updated_at: string;
}

export interface KnowledgeFile {
  id: number;
  filename: string;
  chunks_count: number;
  status: "processing" | "ready" | "error";
  error: string | null;
  created_at: string;
}

export interface KnowledgeStatus {
  qdrant_configured: boolean;
  qdrant_connected: boolean;
  collection: string;
  files: KnowledgeFile[];
}

export interface KnowledgeHit {
  text: string;
  score: number;
  metadata: { source_file?: string; chunk_type?: string; title?: string };
}

export interface McpServer {
  id: number;
  name: string;
  type: "url" | "stdio";
  url: string | null;
  command: string | null;
  args: string[];
  enabled: boolean;
  has_token: boolean;
  has_env: boolean;
}

export interface McpServerInput {
  name: string;
  type: "url" | "stdio";
  url?: string;
  authorization_token?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

const base = (agentId: number) => `/agents/${agentId}/channel`;

export const errorMessage = (err: any, fallback = "Não foi possível concluir a ação.") => err?.response?.data?.error || err?.message || fallback;

export async function fetchChannelSettings(agentId: number) {
  return (await api.get(`${base(agentId)}/settings`)).data as ChannelSettings;
}
export async function saveChannelSettings(agentId: number, patch: ChannelSettingsPatch) {
  return (await api.put(`${base(agentId)}/settings`, patch)).data as ChannelSettings;
}

export async function fetchSessions(agentId: number) {
  return (await api.get(`${base(agentId)}/sessions`)).data as ChannelSession[];
}
export async function fetchSessionMessages(agentId: number, id: number) {
  return (await api.get(`${base(agentId)}/sessions/${id}/messages`)).data as { role: "user" | "assistant"; content: string }[];
}
export async function deleteSession(agentId: number, id: number) {
  await api.delete(`${base(agentId)}/sessions/${id}`);
}
export async function resumeSession(agentId: number, id: number) {
  await api.post(`${base(agentId)}/sessions/${id}/resume`);
}

export async function fetchKnowledge(agentId: number) {
  return (await api.get(`${base(agentId)}/knowledge`)).data as KnowledgeStatus;
}
export async function uploadKnowledge(agentId: number, file: File) {
  const form = new FormData();
  form.append("file", file);
  return (await api.post(`${base(agentId)}/knowledge`, form)).data as KnowledgeFile;
}
export async function deleteKnowledge(agentId: number, id: number) {
  await api.delete(`${base(agentId)}/knowledge/${id}`);
}
export async function searchKnowledge(agentId: number, query: string) {
  return (await api.post(`${base(agentId)}/knowledge/search`, { query })).data as KnowledgeHit[];
}

export async function fetchMcpServers(agentId: number) {
  return (await api.get(`${base(agentId)}/mcp`)).data as McpServer[];
}
export async function createMcpServer(agentId: number, data: McpServerInput) {
  return (await api.post(`${base(agentId)}/mcp`, data)).data as McpServer;
}
export async function updateMcpServer(agentId: number, id: number, data: Partial<McpServerInput> & { enabled?: boolean }) {
  return (await api.put(`${base(agentId)}/mcp/${id}`, data)).data as McpServer;
}
export async function deleteMcpServer(agentId: number, id: number) {
  await api.delete(`${base(agentId)}/mcp/${id}`);
}
export async function testMcpServer(agentId: number, id: number) {
  return (await api.post(`${base(agentId)}/mcp/${id}/test`)).data as { ok: boolean; error?: string; tools: { name: string; description: string }[] };
}

// ─── Dashboard ──────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  turns: number;
  messages_in: number;
  contacts: number;
  errors: number;
  error_rate: number;
  handoffs: number;
  handoff_rate: number;
  autonomous_rate: number;
  agent_ms: { avg: number | null; p50: number | null; p95: number | null };
  wait_ms: { avg: number | null; p50: number | null; p95: number | null };
  input_tokens: number;
  output_tokens: number;
  tokens_per_turn: number;
  rag_rate: number;
  tool_calls: number;
  appointments: number;
  conversion_rate: number;
}

export interface AgentDashboard {
  days: number;
  summary: DashboardSummary;
  previous: DashboardSummary;
  daily: { date: string; turns: number; contacts: number; handoffs: number; errors: number; appointments: number }[];
  heatmap: number[][];
  tools: { name: string; count: number }[];
  media: { text: number; audio: number; image: number; sticker: number };
  appointments: {
    created: number;
    rescheduled: number;
    canceled: number;
    by_user: { name: string; count: number }[];
    recent: { id: number; action: string; user: string; contact: string | null; starts_at: string | null; created_at: string; task_id: number | null }[];
  };
  handoff_tickets: { total: number; pending: number; open: number; closed: number; avg_close_minutes: number | null };
  handoff_reasons: { at: string; reason: string; ticket_id: number | null }[];
  contacts_now: { total: number; new_in_period: number; active: number; with_human: number };
  recent_errors: { at: string; error: string | null }[];
}

export async function fetchDashboard(agentId: number, days: number) {
  return (await api.get(`${base(agentId)}/dashboard`, { params: { days } })).data as AgentDashboard;
}

// ─── Agenda ─────────────────────────────────────────────────────────────────────

export interface CalendarAccess {
  id: number;
  user_id: number;
  name: string;
  email: string;
  photo: string | null;
  can_write: boolean;
  enforce_availability: boolean;
  availability: { days: string[]; start: string; end: string; slot_minutes: number };
}

export interface GrantableUser {
  id: number;
  name: string;
  email: string;
  photo: string | null;
}

export async function fetchCalendarAccess(agentId: number) {
  return (await api.get(`${base(agentId)}/calendar`)).data as { access: CalendarAccess[]; grantable: GrantableUser[] };
}
export async function setCalendarAccess(agentId: number, userId: number, data: { can_write?: boolean; enforce_availability?: boolean }) {
  return (await api.put(`${base(agentId)}/calendar/${userId}`, data)).data as CalendarAccess[];
}
export async function removeCalendarAccess(agentId: number, userId: number) {
  return (await api.delete(`${base(agentId)}/calendar/${userId}`)).data as CalendarAccess[];
}

export interface TelegramSettings {
  configured: boolean;
  enabled: boolean;
  running: boolean;
  bot_username: string | null;
  bot_name: string | null;
  briefing_enabled: boolean;
  briefing_time: string;
  links: { id: number; chat_id: string; display_name: string | null; created_at: string }[];
}
export interface TelegramPairing {
  code: string;
  expires_at: string;
  deep_link: string | null;
}

export async function fetchTelegram(agentId: number) {
  return (await api.get(`${base(agentId)}/telegram`)).data as TelegramSettings;
}
export async function saveTelegram(agentId: number, patch: { bot_token?: string; enabled?: boolean; briefing_enabled?: boolean; briefing_time?: string }) {
  return (await api.put(`${base(agentId)}/telegram`, patch)).data as TelegramSettings;
}
export async function removeTelegram(agentId: number) {
  await api.delete(`${base(agentId)}/telegram`);
}
export async function createTelegramPairing(agentId: number) {
  return (await api.post(`${base(agentId)}/telegram/pairing`)).data as TelegramPairing;
}
export async function removeTelegramLink(agentId: number, linkId: number) {
  await api.delete(`${base(agentId)}/telegram/links/${linkId}`);
}
export async function sendTelegramBriefing(agentId: number) {
  return (await api.post(`${base(agentId)}/telegram/briefing`)).data as { sent: number };
}

export interface RecordingIndexStatus {
  qdrant_configured: boolean;
  qdrant_connected: boolean;
  collection: string;
  total: number;
  indexed: number;
  pending: number;
  failed: number;
}
export async function fetchRecordingIndexStatus() {
  return (await api.get("/recordings/index/status")).data as RecordingIndexStatus;
}
export async function reindexRecordings(force: boolean) {
  return (await api.post("/recordings/index/reindex", { force })).data as { queued: number };
}
