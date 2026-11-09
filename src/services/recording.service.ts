import api from "./api";
import type { AxiosProgressEvent } from "axios";

export type RecordingStatus = "uploaded" | "transcribing" | "analyzing" | "done" | "error";
export type ActionPriority = "P1" | "P2" | "P3";
export type ActionStatus = "pending" | "converted" | "dismissed";

export interface RecordingAction {
  id: number;
  recording_id: number;
  text: string;
  priority: ActionPriority;
  owner_name: string | null;
  due_text: string | null;
  status: ActionStatus;
  task_id: number | null;
}

export interface Recording {
  id: number;
  user_id: number;
  project_id: number | null;
  project: { id: number; name: string; color: string | null } | null;
  title: string;
  category: string | null;
  tipo: string;
  tags: string[];
  status: RecordingStatus;
  progress_label: string | null;
  error: string | null;
  storage: "s3" | "local";
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  recorded_at: string;
  created_at: string;
  summary: string | null;
  participants: string[];
  ai_provider: string | null;
  ai_model: string | null;
  share_token: string | null;
  actions: RecordingAction[];
}

export interface RecordingDetail extends Recording {
  transcript: string | null;
  topics: string[];
  decisions: { checked: boolean; text: string }[];
  risks: string[];
  next_steps: string[];
  analysis_md: string | null;
}

export interface RecordingUploadInput {
  file: Blob;
  filename: string;
  title?: string;
  projectId?: number | null;
  category?: string;
  tipo?: string;
  durationSeconds?: number;
  recordedAt?: Date;
}

export const isProcessing = (r: Pick<Recording, "status">) =>
  r.status === "uploaded" || r.status === "transcribing" || r.status === "analyzing";

export async function fetchRecordings(filters: { projectId?: number; q?: string } = {}): Promise<Recording[]> {
  const res = await api.get("/recordings", { params: { project_id: filters.projectId, q: filters.q || undefined } });
  return res.data;
}

export async function fetchRecording(id: number): Promise<RecordingDetail> {
  const res = await api.get(`/recordings/${id}`);
  return res.data;
}

export async function uploadRecording(input: RecordingUploadInput, onProgress?: (pct: number) => void): Promise<Recording> {
  const form = new FormData();
  form.append("file", input.file, input.filename);
  if (input.title) form.append("title", input.title);
  if (input.projectId) form.append("project_id", String(input.projectId));
  if (input.category) form.append("category", input.category);
  if (input.tipo) form.append("tipo", input.tipo);
  if (input.durationSeconds) form.append("duration_seconds", String(Math.round(input.durationSeconds)));
  form.append("recorded_at", (input.recordedAt ?? new Date()).toISOString());

  const res = await api.post("/recordings", form, {
    // Uploads longos: sem o timeout padrão do axios e com progresso para a barra.
    timeout: 0,
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return res.data;
}

export async function updateRecording(
  id: number,
  data: { title?: string; category?: string | null; tipo?: string; tags?: string[]; project_id?: number | null }
): Promise<Recording> {
  const res = await api.patch(`/recordings/${id}`, data);
  return res.data;
}

export async function deleteRecording(id: number): Promise<void> {
  await api.delete(`/recordings/${id}`);
}

export async function reprocessRecording(id: number): Promise<RecordingDetail> {
  const res = await api.post(`/recordings/${id}/reprocess`);
  return res.data;
}

export async function fetchAudioUrl(id: number, download = false): Promise<string> {
  const res = await api.get(`/recordings/${id}/audio-url`, { params: download ? { download: 1 } : undefined });
  return res.data.url;
}

export async function setRecordingSharing(id: number, enabled: boolean): Promise<string | null> {
  const res = await api.post(`/recordings/${id}/share`, { enabled });
  return res.data.share_token;
}

export const recordingShareUrl = (token: string) => `${window.location.origin}/public/recording/${token}`;

export async function updateAction(
  recordingId: number,
  actionId: number,
  data: Partial<Pick<RecordingAction, "text" | "priority" | "owner_name" | "due_text">> & { status?: "pending" | "dismissed" }
): Promise<RecordingAction> {
  const res = await api.patch(`/recordings/${recordingId}/actions/${actionId}`, data);
  return res.data;
}

export interface ConvertResult {
  tasks: { id: number; title: string }[];
  skipped: number;
  funnel_id: number;
  stage_id: number;
}

export async function sendActionsToBacklog(
  recordingId: number,
  opts: { actionIds?: number[]; funnelId?: number | null; stageId?: number | null } = {}
): Promise<ConvertResult> {
  const res = await api.post(`/recordings/${recordingId}/actions/to-tasks`, {
    action_ids: opts.actionIds,
    funnel_id: opts.funnelId ?? undefined,
    stage_id: opts.stageId ?? undefined,
  });
  return res.data;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}min`;
  if (m > 0) return `${m}min`;
  return `${s}s`;
}
