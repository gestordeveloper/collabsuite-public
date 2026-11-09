import api from "./api";
import type { Funnel, FunnelUser, FunnelVisibility } from "../types";

export async function fetchFunnels() {
  const { data } = await api.get("/funnels");
  return data as Funnel[];
}

export async function fetchFunnelsByProject(projectId: number) {
  const { data } = await api.get(`/projects/${projectId}/funnels`);
  return data as Funnel[];
}

export async function createFunnel(projectId: number, payload: { name: string; prefix?: string | null; visibility?: FunnelVisibility }) {
  const { data } = await api.post(`/projects/${projectId}/funnels`, payload);
  return data as Funnel;
}

export async function updateFunnel(funnelId: number, payload: { name?: string; prefix?: string | null; visibility?: FunnelVisibility }) {
  const { data } = await api.put(`/funnels/${funnelId}`, payload);
  return data as Funnel;
}

export async function fetchFunnelUsers(funnelId: number) {
  const { data } = await api.get(`/funnels/${funnelId}/users`);
  return data as FunnelUser[];
}

export async function addUserToFunnel(funnelId: number, userId: number) {
  const { data } = await api.post(`/funnels/${funnelId}/users`, { user_id: userId });
  return data as FunnelUser;
}

export async function removeUserFromFunnel(funnelId: number, userId: number) {
  await api.delete(`/funnels/${funnelId}/users/${userId}`);
}

export async function deleteFunnel(funnelId: number) {
  await api.delete(`/funnels/${funnelId}`);
}

export async function createStage(funnelId: number, name: string, status?: string) {
  const { data } = await api.post(`/funnels/${funnelId}/stages`, { name, status });
  return data;
}

export async function deleteStage(stageId: number) {
  await api.delete(`/funnels/stages/${stageId}`);
}

export async function updateStage(stageId: number, payload: { name?: string; status?: string; stage_order?: number }) {
  const { data } = await api.put(`/funnels/stages/${stageId}`, payload);
  return data;
}
