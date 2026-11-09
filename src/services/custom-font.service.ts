import api from "./api";
import type { CustomFont } from "@/src/types";

export async function listCustomFonts(): Promise<CustomFont[]> {
  const res = await api.get("/custom-fonts");
  return res.data;
}

export async function createCustomFont(data: {
  family: string;
  url: string;
  weight?: number;
  style?: "normal" | "italic";
}): Promise<CustomFont> {
  const res = await api.post("/custom-fonts", data);
  return res.data;
}

export async function deleteCustomFont(id: number): Promise<void> {
  await api.delete(`/custom-fonts/${id}`);
}
