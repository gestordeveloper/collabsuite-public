import api from "./api";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
  webContentLink?: string | null;
  iconLink?: string | null;
}

export interface DriveStatus {
  folderId?: string | null;
  folderLink?: string | null;
  ownerUserId?: number | null;
  ownerConnected: boolean;
  currentUserConnected: boolean;
  canConnect: boolean;
}

export async function fetchDriveStatus(projectId: number) {
  const { data } = await api.get(`/projects/${projectId}/drive/status`);
  return data as DriveStatus;
}

export async function connectDrive(projectId: number) {
  const { data } = await api.post(`/projects/${projectId}/drive/connect`);
  return data as DriveStatus;
}

export async function fetchDriveFiles(projectId: number, folderId?: string) {
  const { data } = await api.get(`/projects/${projectId}/drive/files`, { params: folderId ? { folderId } : undefined });
  return data as DriveFile[];
}

export async function uploadDriveFile(projectId: number, payload: { filename: string; mimeType: string; dataUrl: string; folderId?: string }) {
  const { data } = await api.post(`/projects/${projectId}/drive/files`, payload);
  return data as DriveFile;
}

export async function createDriveFolder(projectId: number, payload: { name: string; parentFolderId?: string }) {
  const { data } = await api.post(`/projects/${projectId}/drive/folders`, payload);
  return data as { id: string; webViewLink: string };
}

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** Conteúdo do arquivo como Blob, para visualizar dentro do app (Docs/Sheets/Slides vêm como PDF). */
export async function fetchDriveFileBlob(projectId: number, fileId: string) {
  const { data } = await api.get(`/projects/${projectId}/drive/files/${fileId}/content`, { responseType: "blob" });
  return data as Blob;
}

export async function deleteDriveFile(projectId: number, fileId: string) {
  await api.delete(`/projects/${projectId}/drive/files/${fileId}`);
}
