import api from "./api";
import { uploadFile as uploadFileChunked } from "./upload.service";
import type { TaskAttachment } from "../types";

export async function fetchAttachments(taskId: number) {
  const { data } = await api.get(`/tasks/${taskId}/attachments`);
  return data as TaskAttachment[];
}

export async function createAttachment(taskId: number, payload: { file_name: string; file_url: string; file_size?: number; file_type?: string }) {
  const { data } = await api.post(`/tasks/${taskId}/attachments`, payload);
  return data as TaskAttachment;
}

export async function deleteAttachment(taskId: number, attachmentId: number) {
  await api.delete(`/tasks/${taskId}/attachments/${attachmentId}`);
}

export async function uploadFile(file: File): Promise<{ url: string; size: number; type: string }> {
  // Multipart (e em partes para arquivos pesados) — ver upload.service.ts#uploadFile.
  return uploadFileChunked(file);
}