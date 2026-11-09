import api from "./api";

export type WhatsAppConnectionStatus = "disconnected" | "pairing" | "connected" | "error";

export interface WhatsAppConnection {
  id: number;
  user_id: number;
  label: string;
  phone_number: string | null;
  status: WhatsAppConnectionStatus;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
  has_session: boolean;
  qr_data_url: string | null;
}

export async function fetchConnections() {
  const { data } = await api.get("/whatsapp/connections");
  return data as WhatsAppConnection[];
}

export async function fetchConnection(connectionId: number) {
  const { data } = await api.get(`/whatsapp/connections/${connectionId}`);
  return data as WhatsAppConnection;
}

export async function createConnection(label: string) {
  const { data } = await api.post("/whatsapp/connections", { label });
  return data as WhatsAppConnection;
}

export async function renameConnection(connectionId: number, label: string) {
  const { data } = await api.put(`/whatsapp/connections/${connectionId}`, { label });
  return data as WhatsAppConnection;
}

export async function connectConnection(connectionId: number) {
  const { data } = await api.post(`/whatsapp/connections/${connectionId}/connect`);
  return data as WhatsAppConnection;
}

export async function disconnectConnection(connectionId: number) {
  const { data } = await api.post(`/whatsapp/connections/${connectionId}/disconnect`);
  return data as WhatsAppConnection;
}

export async function deleteConnection(connectionId: number) {
  await api.delete(`/whatsapp/connections/${connectionId}`);
}

export interface WhatsAppGroupSummary {
  jid: string;
  subject: string;
  participantCount: number;
}

export async function fetchGroups(connectionId: number) {
  const { data } = await api.get(`/whatsapp/connections/${connectionId}/groups`);
  return data as WhatsAppGroupSummary[];
}
