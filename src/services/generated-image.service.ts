import api from "./api";

export interface GeneratedImage {
  id: number;
  user_id: number;
  agent_id: number | null;
  run_id: number | null;
  prompt: string;
  model: string;
  url: string;
  created_at: string;
  agent?: { id: number; name: string } | null;
}

export async function fetchGeneratedImages(agentId?: number) {
  const { data } = await api.get("/generated-images", { params: { agent_id: agentId } });
  return data as GeneratedImage[];
}

export async function deleteGeneratedImage(imageId: number) {
  await api.delete(`/generated-images/${imageId}`);
}
