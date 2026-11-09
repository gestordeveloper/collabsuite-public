import api from "./api";
import type { Design } from "@/src/types";

export async function listDesigns(): Promise<Design[]> {
  const res = await api.get("/designs");
  return res.data;
}

export async function getDesign(id: number): Promise<Design> {
  const res = await api.get(`/designs/${id}`);
  return res.data;
}

export async function createDesign(data: {
  name: string;
  project_id?: number | null;
  thumbnail_url?: string | null;
  width?: number;
  height?: number;
  pages?: string;
}): Promise<Design> {
  const res = await api.post("/designs", data);
  return res.data;
}

export async function updateDesign(id: number, data: Partial<{
  name: string;
  project_id: number | null;
  thumbnail_url: string | null;
  width: number;
  height: number;
  pages: string;
}>): Promise<Design> {
  const res = await api.put(`/designs/${id}`, data);
  return res.data;
}

export async function deleteDesign(id: number): Promise<void> {
  await api.delete(`/designs/${id}`);
}

export async function duplicateDesign(id: number): Promise<Design> {
  const res = await api.post(`/designs/${id}/duplicate`);
  return res.data;
}
