import api from "./api";
import type { Task } from "../types";

export async function fetchTasks(params?: { funnel_id?: number; is_sprint?: boolean; page?: number; limit?: number }) {
  const { data } = await api.get("/tasks", { params });
  return data as { data: Task[]; total: number; page: number; limit: number; totalPages: number };
}

export async function fetchSprintTasks() {
  return fetchTasks({ is_sprint: true, limit: 10000 });
}

export async function createTask(payload: any) {
  const { data } = await api.post("/tasks", payload);
  return data as Task;
}

export async function updateTask(taskId: number, payload: any) {
  const { data } = await api.put(`/tasks/${taskId}`, payload);
  return data as Task;
}

export async function setTaskApproval(taskId: number, approved: boolean) {
  const { data } = await api.post(`/tasks/${taskId}/approval`, { approved });
  return data as Task;
}

export async function fetchTask(taskId: number) {
  const { data } = await api.get(`/tasks/${taskId}`);
  return data as Task;
}

export async function deleteTask(taskId: number) {
  await api.delete(`/tasks/${taskId}`);
}

export async function addChecklistItem(taskId: number, title: string) {
  const { data } = await api.post(`/tasks/${taskId}/checklist`, { title });
  return data;
}

export async function toggleChecklistItem(itemId: number, is_done: boolean) {
  const { data } = await api.put(`/tasks/checklist/${itemId}`, { is_done });
  return data;
}

export async function deleteChecklistItem(itemId: number) {
  await api.delete(`/tasks/checklist/${itemId}`);
}

export async function addActivity(
  taskId: number,
  content: string,
  attachment?: { url: string; name?: string; type?: string; size?: number }
) {
  const { data } = await api.post(`/tasks/${taskId}/activities`, {
    content,
    attachment_url: attachment?.url,
    attachment_name: attachment?.name,
    attachment_type: attachment?.type,
    attachment_size: attachment?.size,
  });
  return data;
}

export async function addTaskMember(taskId: number, userId: number) {
  const { data } = await api.post(`/tasks/${taskId}/members`, { user_id: userId });
  return data;
}

export async function removeTaskMember(taskId: number, userId: number) {
  await api.delete(`/tasks/${taskId}/members/${userId}`);
}

export async function generateMeetLink(taskId: number) {
  const { data } = await api.post(`/tasks/${taskId}/meet`);
  return data;
}

export async function fetchFormResponses(taskId: number) {
  const { data } = await api.get(`/tasks/${taskId}/responses`);
  return data as any[];
}