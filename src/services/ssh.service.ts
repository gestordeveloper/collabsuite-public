import { io, type Socket } from "socket.io-client";
import api from "./api";

export interface SshConnection {
  id: number;
  project_id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "key" | "password";
  has_secret: boolean;
  has_passphrase: boolean;
  /** Impressão digital do servidor já confirmada por uma pessoa (null = ainda não confiável). */
  host_fingerprint: string | null;
  record_sessions: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface SshConnectionInput {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "key" | "password";
  /** Chave privada ou senha. Na edição, vazio = manter o que já está salvo. */
  secret?: string;
  passphrase?: string | null;
  record_sessions: boolean;
  reset_fingerprint?: boolean;
}

export interface SshTestResult {
  ok: boolean;
  code: string | null;
  message: string | null;
  fingerprint: string | null;
  pinned: boolean;
  matches: boolean | null;
}

export interface SshCommand { id: number; name: string; command: string; description: string | null; confirm: boolean }
export interface SshCommandInput { name: string; command: string; description?: string | null; confirm: boolean }

export interface SshSessionRow {
  id: number;
  user: { id: number; name: string; email: string } | null;
  connection_name: string;
  host: string;
  username: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  ip: string | null;
  bytes_out: number;
  has_recording: boolean;
  recording_truncated: boolean;
}

const base = (projectId: number) => `/ssh/projects/${projectId}`;

export const getAccess = async (projectId: number) => (await api.get(`${base(projectId)}/access`)).data.allowed as boolean;

export const listConnections = async (projectId: number) => (await api.get(`${base(projectId)}/connections`)).data as SshConnection[];
export const createConnection = async (projectId: number, p: SshConnectionInput) => (await api.post(`${base(projectId)}/connections`, p)).data as SshConnection;
export const updateConnection = async (projectId: number, id: number, p: Partial<SshConnectionInput>) => (await api.put(`${base(projectId)}/connections/${id}`, p)).data as SshConnection;
export const deleteConnection = async (projectId: number, id: number) => (await api.delete(`${base(projectId)}/connections/${id}`)).data;
export const testConnection = async (projectId: number, id: number) => (await api.post(`${base(projectId)}/connections/${id}/test`)).data as SshTestResult;
export const trustFingerprint = async (projectId: number, id: number, fingerprint: string) => (await api.post(`${base(projectId)}/connections/${id}/trust`, { fingerprint })).data as SshConnection;

export const listCommands = async (projectId: number) => (await api.get(`${base(projectId)}/commands`)).data as SshCommand[];
export const createCommand = async (projectId: number, p: SshCommandInput) => (await api.post(`${base(projectId)}/commands`, p)).data as SshCommand;
export const updateCommand = async (projectId: number, id: number, p: Partial<SshCommandInput>) => (await api.put(`${base(projectId)}/commands/${id}`, p)).data as SshCommand;
export const deleteCommand = async (projectId: number, id: number) => (await api.delete(`${base(projectId)}/commands/${id}`)).data;

export const listSessions = async (projectId: number, page = 1) => (await api.get(`${base(projectId)}/sessions`, { params: { page } })).data as { sessions: SshSessionRow[]; has_next: boolean };
export const getRecording = async (projectId: number, sessionId: number) => (await api.get(`${base(projectId)}/sessions/${sessionId}/recording`, { responseType: "text", transformResponse: (d) => d })).data as string;

export function errMsg(err: any, fallback = "Algo deu errado. Tente novamente."): string {
  return err?.response?.data?.error || err?.message || fallback;
}

// ─── terminal ───────────────────────────────────────────────────────────────────

export type TermStatus =
  | { state: "connecting" }
  | { state: "connected"; sessionId: number; recording: boolean }
  | { state: "closed"; reason: string; message: string }
  | { state: "error"; code: string; message: string };

/** Um socket por aba de terminal, no namespace /ssh (o servidor valida o JWT na conexão). */
export function openTerminalSocket(): Socket {
  return io(`${window.location.origin}/ssh`, {
    auth: { token: localStorage.getItem("collab_token") ?? "" },
    transports: ["websocket"],
    reconnection: false, // reconectar abriria um shell novo sem a pessoa saber
  });
}

/** Rótulo amigável do motivo de encerramento de uma sessão (auditoria). */
export function endReasonLabel(reason: string | null): string {
  return (
    ({
      closed: "Encerrada",
      disconnected: "Aba fechada",
      idle: "Inatividade",
      max_duration: "Duração máxima",
      error: "Erro",
      auth_failed: "Falha de autenticação",
      host_key_mismatch: "Impressão digital divergente",
      server_closed: "Servidor reiniciou",
    } as Record<string, string>)[reason ?? ""] ?? (reason ? reason : "Em andamento")
  );
}
