import api from "./api";
import type { PhotoDocumentFull, PhotoDocumentRecord } from "@/src/lib/photosuite/types";

export async function listDocuments(): Promise<PhotoDocumentRecord[]> {
  const res = await api.get("/photosuite");
  return res.data;
}

export async function getDocument(id: number): Promise<PhotoDocumentFull> {
  const res = await api.get(`/photosuite/${id}`);
  return res.data;
}

export async function createDocument(data: {
  name: string;
  project_id?: number | null;
  width?: number;
  height?: number;
  doc?: string;
}): Promise<PhotoDocumentFull> {
  const res = await api.post("/photosuite", data);
  return res.data;
}

export async function updateDocument(id: number, data: Partial<{
  name: string;
  project_id: number | null;
  visibility: "private" | "project";
  thumbnail_url: string | null;
  width: number;
  height: number;
  doc: string;
}>): Promise<PhotoDocumentFull> {
  const res = await api.put(`/photosuite/${id}`, data);
  return res.data;
}

export async function deleteDocument(id: number): Promise<void> {
  await api.delete(`/photosuite/${id}`);
}

export async function duplicateDocument(id: number): Promise<PhotoDocumentFull> {
  const res = await api.post(`/photosuite/${id}/duplicate`);
  return res.data;
}

/** Liga/desliga o link público. `image_url` é a imagem final já enviada ao storage. */
export async function shareDocument(id: number, enabled: boolean, image_url?: string): Promise<{ share_token: string | null; share_image_url: string | null; shared_at: string | null }> {
  const res = await api.post(`/photosuite/${id}/share`, { enabled, image_url });
  return res.data;
}

export interface PublicPhotoDocument {
  name: string;
  width: number;
  height: number;
  image_url: string;
  shared_at: string | null;
  owner_name: string | null;
}

export async function getPublicDocument(token: string): Promise<PublicPhotoDocument> {
  const res = await api.get(`/photosuite/public/${token}`);
  return res.data;
}
