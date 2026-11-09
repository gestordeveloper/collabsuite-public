import api from "./api";

// ─── Tipos ───

export type TicketStatus = "pending" | "open" | "closed";

export interface ChatContact {
  id: number;
  name: string;
  number: string | null;
  lid: string | null;
  profile_pic_url: string | null;
  is_group: boolean;
}

export interface TicketUserBrief {
  id: number;
  first_name: string;
  last_name?: string | null;
  photo?: string | null;
}

export interface TicketTag {
  id: number;
  name: string;
  color: string;
}

export interface TicketQueue {
  id: number;
  name: string;
  color: string;
  greeting_message: string | null;
  auto_distribution: boolean;
  users: TicketUserBrief[];
  user_ids: number[];
  _count?: { tickets: number };
}

export interface Ticket {
  id: number;
  status: TicketStatus;
  contact_id: number;
  connection_id: number | null;
  queue_id: number | null;
  user_id: number | null;
  unread_messages: number;
  last_message: string | null;
  last_message_at: string | null;
  is_group: boolean;
  is_parallel: boolean;
  close_reason: string | null;
  customer_sentiment: string | null;
  closing_observations: string | null;
  started_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  contact: ChatContact;
  queue: Pick<TicketQueue, "id" | "name" | "color"> | null;
  user: TicketUserBrief | null;
  connection: { id: number; label: string; phone_number: string | null } | null;
  tags: TicketTag[];
  _count?: { tasks: number };
}

export interface MessageReaction {
  emoji: string;
  fromMe: boolean;
  senderId: string;
}

export interface TicketMessage {
  id: number;
  wa_id: string;
  ticket_id: number;
  contact_id: number | null;
  sender_user_id: number | null;
  from_me: boolean;
  body: string | null;
  media_url: string | null;
  media_type: string | null;
  media_name: string | null;
  ack: number;
  is_read: boolean;
  is_deleted: boolean;
  is_internal: boolean;
  reactions: MessageReaction[];
  quoted_wa_id: string | null;
  created_at: string;
  sender: TicketUserBrief | null;
  contact: { id: number; name: string } | null;
  quoted?: { wa_id: string; body: string | null; from_me: boolean; media_type: string | null } | null;
}

export interface TicketTaskSummary {
  id: number;
  title: string | null;
  status: string;
  priority: string | null;
  due_at: string | null;
  user: TicketUserBrief | null;
}

export interface TeamMember extends TicketUserBrief {
  role: string;
}

export interface AttendanceConnection {
  id: number;
  label: string;
  phone_number: string | null;
  status: string;
}

export interface TicketFilters {
  status?: TicketStatus;
  search?: string;
  queueIds?: number[];
  tagIds?: number[];
  isGroup?: boolean;
  isParallel?: boolean;
  connectionId?: number;
  assignedUserId?: number;
  showAll?: boolean;
  withUnread?: boolean;
  page?: number;
}

// ─── Tickets ───

const BASE = "/atendimento";

export async function fetchTickets(f: TicketFilters) {
  const params: Record<string, string | number> = {};
  if (f.status) params.status = f.status;
  if (f.search) params.search = f.search;
  if (f.queueIds?.length) params.queue_ids = f.queueIds.join(",");
  if (f.tagIds?.length) params.tag_ids = f.tagIds.join(",");
  if (f.isGroup !== undefined) params.is_group = String(f.isGroup);
  if (f.isParallel !== undefined) params.is_parallel = String(f.isParallel);
  if (f.connectionId) params.connection_id = f.connectionId;
  if (f.assignedUserId) params.assigned_user_id = f.assignedUserId;
  if (f.showAll) params.show_all = "true";
  if (f.withUnread) params.with_unread = "true";
  if (f.page) params.page = f.page;
  const { data } = await api.get(`${BASE}/tickets`, { params });
  return data as { tickets: Ticket[]; count: number; hasMore: boolean };
}

export async function fetchTicketCounts(showAll = false) {
  const { data } = await api.get(`${BASE}/tickets/counts`, { params: showAll ? { show_all: "true" } : {} });
  return data as { pending: number; open: number; unread: number };
}

export async function fetchTicket(id: number) {
  const { data } = await api.get(`${BASE}/tickets/${id}`);
  return data as Ticket;
}

export interface TicketUpdate {
  status?: TicketStatus;
  user_id?: number | null;
  queue_id?: number | null;
  connection_id?: number;
  tag_ids?: number[];
  is_parallel?: boolean;
  mark_unread?: boolean;
  close_reason?: string | null;
  customer_sentiment?: string | null;
  closing_observations?: string | null;
}

export async function updateTicket(id: number, payload: TicketUpdate) {
  const { data } = await api.put(`${BASE}/tickets/${id}`, payload);
  return data as Ticket;
}

export async function deleteTicket(id: number) {
  await api.delete(`${BASE}/tickets/${id}`);
}

export async function startConversation(payload: { contact_id?: number; number?: string; name?: string; connection_id: number; queue_id?: number | null }) {
  const { data } = await api.post(`${BASE}/tickets`, payload);
  return data as Ticket;
}

export async function bulkTransfer(payload: { ticket_ids: number[]; user_id?: number | null; queue_id?: number | null; status?: TicketStatus }) {
  const { data } = await api.put(`${BASE}/tickets/bulk-transfer`, payload);
  return data as { updated: number; failed: number[] };
}

export async function fetchTicketIdsByUser(userId: number) {
  const { data } = await api.get(`${BASE}/tickets/ids-by-user`, { params: { user_id: userId } });
  return (data as { ticket_ids: number[] }).ticket_ids;
}

// ─── Mensagens ───

export async function fetchMessages(ticketId: number, before?: number) {
  const { data } = await api.get(`${BASE}/tickets/${ticketId}/messages`, { params: before ? { before } : {} });
  return data as { messages: TicketMessage[]; hasMore: boolean };
}

export async function sendMessage(ticketId: number, payload: { body: string; quoted_message_id?: number; is_internal?: boolean }) {
  const { data } = await api.post(`${BASE}/tickets/${ticketId}/messages`, payload);
  return data as TicketMessage;
}

export async function sendFile(
  ticketId: number,
  file: Blob,
  opts: { filename: string; caption?: string; asDocument?: boolean; voice?: boolean; quotedMessageId?: number }
) {
  const form = new FormData();
  form.append("file", file, opts.filename);
  if (opts.caption) form.append("caption", opts.caption);
  if (opts.asDocument) form.append("as_document", "true");
  if (opts.voice) form.append("voice", "true");
  if (opts.quotedMessageId) form.append("quoted_message_id", String(opts.quotedMessageId));
  const { data } = await api.post(`${BASE}/tickets/${ticketId}/messages/file`, form);
  return data as TicketMessage;
}

export async function deleteMessage(ticketId: number, messageId: number) {
  await api.delete(`${BASE}/tickets/${ticketId}/messages/${messageId}`);
}

// ─── Tarefas a partir da conversa ───

export async function fetchTicketTasks(ticketId: number) {
  const { data } = await api.get(`${BASE}/tickets/${ticketId}/tasks`);
  return data as TicketTaskSummary[];
}

export async function createTicketTask(
  ticketId: number,
  payload: { title: string; description?: string; priority?: string | null; user_id?: number | null; due_at?: string | null; funnel_id?: number | null; stage_id?: number | null }
) {
  const { data } = await api.post(`${BASE}/tickets/${ticketId}/tasks`, payload);
  return data as TicketTaskSummary;
}

// ─── Apoio ───

export async function fetchAttendanceConnections() {
  const { data } = await api.get(`${BASE}/connections`);
  return data as AttendanceConnection[];
}

export async function fetchTeam() {
  const { data } = await api.get(`${BASE}/team`);
  return data as TeamMember[];
}

export async function searchContacts(search: string) {
  const { data } = await api.get(`${BASE}/contacts`, { params: { search } });
  return data as ChatContact[];
}

export async function fetchQueues() {
  const { data } = await api.get(`${BASE}/queues`);
  return data as TicketQueue[];
}

export async function saveQueue(id: number | null, payload: { name: string; color: string; greeting_message?: string | null; auto_distribution?: boolean; user_ids?: number[] }) {
  const { data } = id ? await api.put(`${BASE}/queues/${id}`, payload) : await api.post(`${BASE}/queues`, payload);
  return data as TicketQueue;
}

export async function deleteQueue(id: number) {
  await api.delete(`${BASE}/queues/${id}`);
}

export async function fetchTags() {
  const { data } = await api.get(`${BASE}/tags`);
  return data as TicketTag[];
}

export async function saveTag(id: number | null, payload: { name: string; color: string }) {
  const { data } = id ? await api.put(`${BASE}/tags/${id}`, payload) : await api.post(`${BASE}/tags`, payload);
  return data as TicketTag;
}

export async function deleteTag(id: number) {
  await api.delete(`${BASE}/tags/${id}`);
}

// ─── Bot ───

export type BotFlowType = "entry" | "queue" | "automation";

export interface BotFlowSummary {
  id: number;
  name: string;
  type: BotFlowType;
  queue_id: number | null;
  queue: { id: number; name: string; color: string } | null;
  is_active: boolean;
  restart_on_reopen: boolean;
  status_filter: string | null;
  connection_ids: number[];
  published_at: string | null;
  has_unpublished_changes?: boolean;
  updated_at: string;
}

export interface BotFlowDetail extends BotFlowSummary {
  draft_graph: string | null;
  published_graph: string | null;
}

export async function fetchBotFlows() {
  const { data } = await api.get(`${BASE}/bot-flows`);
  return data as BotFlowSummary[];
}

export async function fetchBotFlow(id: number) {
  const { data } = await api.get(`${BASE}/bot-flows/${id}`);
  return data as BotFlowDetail;
}

export interface BotFlowInput {
  name?: string;
  type?: BotFlowType;
  queue_id?: number | null;
  is_active?: boolean;
  restart_on_reopen?: boolean;
  status_filter?: TicketStatus[] | null;
  connection_ids?: number[];
  draft_graph?: unknown;
}

export async function saveBotFlow(id: number | null, payload: BotFlowInput) {
  const { data } = id ? await api.put(`${BASE}/bot-flows/${id}`, payload) : await api.post(`${BASE}/bot-flows`, payload);
  return data as BotFlowDetail;
}

export async function deleteBotFlow(id: number) {
  await api.delete(`${BASE}/bot-flows/${id}`);
}

export async function publishBotFlow(id: number) {
  const { data } = await api.post(`${BASE}/bot-flows/${id}/publish`);
  return data as BotFlowDetail;
}

// ─── Ajustes de atendimento por conexão ───

export async function saveConnectionTicketSettings(
  connectionId: number,
  payload: { receive_tickets?: boolean; greeting_message?: string | null; farewell_message?: string | null }
) {
  const { data } = await api.put(`/whatsapp/connections/${connectionId}/ticket-settings`, payload);
  return data;
}

export function errorMessage(err: unknown, fallback = "Algo deu errado. Tente novamente."): string {
  return (err as any)?.response?.data?.error || (err as Error)?.message || fallback;
}
