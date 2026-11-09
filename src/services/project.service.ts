import api from "./api";
import type { Project, ProjectUser } from "../types";

export async function fetchProjects() {
  const { data } = await api.get("/projects");
  return data as Project[];
}

export async function createProject(payload: { name: string; content?: string; color?: string }) {
  const { data } = await api.post("/projects", payload);
  return data as Project;
}

export async function updateProject(projectId: number, payload: { name?: string; content?: string; color?: string; favorite?: boolean | null; is_default_project?: boolean | null }) {
  const { data } = await api.put(`/projects/${projectId}`, payload);
  return data as Project;
}

export async function deleteProject(projectId: number) {
  await api.delete(`/projects/${projectId}`);
}

export async function fetchProjectUsers(projectId: number) {
  const { data } = await api.get(`/projects/${projectId}/users`);
  return data as ProjectUser[];
}

export async function addUserToProject(projectId: number, userId: number) {
  const { data } = await api.post(`/projects/${projectId}/users`, { user_id: userId });
  return data as ProjectUser;
}

export async function removeUserFromProject(projectId: number, userId: number) {
  await api.delete(`/projects/${projectId}/users/${userId}`);
}
