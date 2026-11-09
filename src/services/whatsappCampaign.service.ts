import api from "./api";

export type WhatsAppCampaignStatus = "draft" | "scheduled" | "sending" | "paused" | "done" | "failed";
export type WhatsAppRecipientStatus = "pending" | "sent" | "failed" | "skipped";
export type WhatsAppMediaType = "image" | "video" | "audio" | "document";

export interface RecipientCounts {
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface WhatsAppCampaign {
  id: number;
  user_id: number;
  connection_id: number;
  list_id: number | null;
  task_id: number | null;
  group_jid: string | null;
  media_url: string | null;
  media_type: WhatsAppMediaType | null;
  media_filename: string | null;
  name: string;
  message: string;
  status: WhatsAppCampaignStatus;
  scheduled_at: string | null;
  min_delay_seconds: number;
  max_delay_seconds: number;
  daily_limit: number | null;
  created_at: string;
  updated_at: string;
  recipient_counts: RecipientCounts;
  _count?: { recipients: number };
}

export interface WhatsAppCampaignRecipient {
  id: number;
  campaign_id: number;
  contact_id: number | null;
  phone: string;
  name: string | null;
  status: WhatsAppRecipientStatus;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export interface AdhocRecipientPayload {
  name?: string | null;
  phone: string;
}

export interface CampaignPayload {
  connection_id: number;
  list_id?: number | null;
  group_jid?: string | null;
  media_url?: string | null;
  media_type?: WhatsAppMediaType | null;
  media_filename?: string | null;
  name: string;
  message: string;
  scheduled_at?: string | null;
  min_delay_seconds?: number;
  max_delay_seconds?: number;
  daily_limit?: number | null;
  recipients?: AdhocRecipientPayload[];
}

export async function fetchCampaigns() {
  const { data } = await api.get("/whatsapp/campaigns");
  return data as WhatsAppCampaign[];
}

export async function fetchCampaign(campaignId: number) {
  const { data } = await api.get(`/whatsapp/campaigns/${campaignId}`);
  return data as WhatsAppCampaign;
}

export async function createCampaign(payload: CampaignPayload) {
  const { data } = await api.post("/whatsapp/campaigns", payload);
  return data as WhatsAppCampaign;
}

export async function updateCampaign(campaignId: number, payload: Partial<CampaignPayload>) {
  const { data } = await api.put(`/whatsapp/campaigns/${campaignId}`, payload);
  return data as WhatsAppCampaign;
}

export async function deleteCampaign(campaignId: number) {
  await api.delete(`/whatsapp/campaigns/${campaignId}`);
}

export async function scheduleCampaign(campaignId: number, scheduledAt: string | null) {
  const { data } = await api.post(`/whatsapp/campaigns/${campaignId}/schedule`, { scheduled_at: scheduledAt });
  return data as WhatsAppCampaign;
}

export async function pauseCampaign(campaignId: number) {
  const { data } = await api.post(`/whatsapp/campaigns/${campaignId}/pause`);
  return data as WhatsAppCampaign;
}

export async function unscheduleCampaign(campaignId: number) {
  const { data } = await api.post(`/whatsapp/campaigns/${campaignId}/unschedule`);
  return data as WhatsAppCampaign;
}

export async function fetchCampaignRecipients(campaignId: number) {
  const { data } = await api.get(`/whatsapp/campaigns/${campaignId}/recipients`);
  return data as WhatsAppCampaignRecipient[];
}

/** The "whatsapp" task template — one campaign lives 1:1 with a task, and IS the task's content. */
export async function fetchCampaignForTask(taskId: number) {
  const { data } = await api.get(`/tasks/${taskId}/whatsapp-campaign`);
  return data as WhatsAppCampaign | null;
}

export async function upsertCampaignForTask(taskId: number, payload: CampaignPayload) {
  const { data } = await api.put(`/tasks/${taskId}/whatsapp-campaign`, payload);
  return data as WhatsAppCampaign;
}
