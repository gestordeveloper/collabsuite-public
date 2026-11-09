import axios from "axios";
import api from "./api";
import type { DriveFile } from "./drive.service";

export async function fetchTaskDriveFiles(taskId: number, folderId?: string) {
  const { data } = await api.get(`/tasks/${taskId}/drive/files`, { params: folderId ? { folderId } : undefined });
  return data as DriveFile[];
}

/**
 * Baixa o conteúdo do arquivo como Blob (o visualizador usa uma URL local, sem abrir link externo).
 * `isPublic` usa a rota do link público do cliente, que não exige login.
 */
export async function fetchTaskDriveFileBlob(taskId: number, fileId: string, isPublic: boolean) {
  const url = isPublic ? `/api/public/task/${taskId}/drive/${fileId}` : `/tasks/${taskId}/drive/files/${fileId}/content`;
  const client = isPublic ? axios : api;
  const res = await client.get(url, { responseType: "blob" });
  return res.data as Blob;
}

/**
 * URL para tocar vídeo/áudio direto (o servidor repassa o Drive em trechos, com seek),
 * em vez de baixar o arquivo inteiro antes de começar.
 */
export async function getTaskDriveStreamUrl(taskId: number, fileId: string, isPublic: boolean) {
  if (isPublic) return `/api/public/task/${taskId}/drive/${fileId}`;
  const { data } = await api.post(`/tasks/${taskId}/drive/files/${fileId}/stream-url`);
  return data.url as string;
}
