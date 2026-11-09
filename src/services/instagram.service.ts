import api from "./api";

export interface ProjectRef {
  id: number;
  name: string;
  color: string | null;
  username: string | null;
}

export interface ProjectAccount {
  project_id: number;
  project_name: string;
  project_color: string | null;
  connected: boolean;
  account: { id: number; username: string | null; avatar: string | null; page_name: string | null; webhook_ok: boolean; token_error: string | null; connected: boolean } | null;
}

/** Um projeto = um cliente = uma conta do Instagram. */
export interface MetaConfig {
  configured: boolean;
  source: "db" | "env" | "none";
  can_edit: boolean;
  app_id: string;
  has_secret: boolean;
  public_url: string;
  verify_token: string;
  callback_url: string | null;
  webhook_url: string | null;
}

export interface InstagramAccounts {
  configured: boolean;
  projects: ProjectAccount[];
}

export type PostStatus = "scheduled" | "publishing" | "published" | "failed";

export interface InstagramPost {
  id: number;
  project: ProjectRef;
  task_id: number | null;
  title: string | null;
  caption: string;
  media: string[];
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  ig_media_id: string | null;
  permalink: string | null;
  attempts: number;
  error: string | null;
  automation: { id: number; title: string; status: string } | null;
}

export interface AutomationInput {
  project_id?: number;
  title?: string;
  ig_media_id?: string | null;
  post_image?: string | null;
  post_caption?: string | null;
  keywords: string[];
  reply_text?: string;
  ai_reply?: boolean;
  dm_text?: string;
  cta_text?: string;
  cta_link?: string;
  status?: "active" | "paused";
}

export interface InstagramAutomation {
  id: number;
  project: ProjectRef;
  title: string;
  status: "active" | "paused";
  ig_media_id: string | null;
  post_image: string | null;
  post_caption: string | null;
  keywords: string[];
  reply_text: string;
  ai_reply: boolean;
  dm_text: string;
  cta_text: string;
  cta_link: string;
  /** Preenchido quando a automação espera um post agendado ser publicado. */
  waiting_post: true | { id: number; scheduled_at: string | null } | null;
  stats: { comments: number; replies: number; dms: number };
}

export interface Engagement {
  id: number;
  type: "COMMENT" | "REPLY" | "DM";
  username: string | null;
  text: string | null;
  error: string | null;
  created_at: string;
}

export interface IgMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
}

export interface PendingAccount {
  instagramId: string;
  username: string;
  avatar: string;
  pageName: string;
}

const errMsg = (e: any) => e?.response?.data?.error || e?.message || "Erro inesperado.";
export { errMsg };

export const getConfig = async () => (await api.get<MetaConfig>("/instagram/config")).data;
export const saveConfig = async (input: { app_id: string; app_secret?: string; public_url: string }) => (await api.put<MetaConfig>("/instagram/config", input)).data;
export const listAccounts = async () => (await api.get<InstagramAccounts>("/instagram/accounts")).data;
export const getConnectUrl = async (projectId: number) => (await api.post<{ url: string }>("/instagram/connect-url", { project_id: projectId })).data.url;
export const disconnect = async (projectId: number) => (await api.delete<InstagramAccounts>("/instagram/account", { params: { project_id: projectId } })).data;
export const getPending = async (id: string) => (await api.get<{ accounts: PendingAccount[] }>(`/instagram/pending/${id}`)).data.accounts;
export const selectPending = async (id: string, instagramId: string) => (await api.post<InstagramAccounts>(`/instagram/pending/${id}`, { instagramId })).data;
export const listMedia = async (projectId: number) => (await api.get<{ data: IgMedia[] }>("/instagram/media", { params: { project_id: projectId } })).data.data;

export const listPosts = async (projectId?: number) => (await api.get<InstagramPost[]>("/instagram/posts", { params: { project_id: projectId } })).data;
export const getPostByTask = async (taskId: number) => (await api.get<InstagramPost>(`/instagram/posts/by-task/${taskId}`)).data;
export const createPost = async (input: { project_id: number; title?: string; caption: string; media: string[]; scheduled_at?: string | null; automation?: AutomationInput | null }) =>
  (await api.post<InstagramPost>("/instagram/posts", input)).data;
export const updatePost = async (id: number, input: { title?: string; caption?: string; media?: string[]; scheduled_at?: string | null }) =>
  (await api.put<InstagramPost>(`/instagram/posts/${id}`, input)).data;
export const deletePost = async (id: number) => (await api.delete(`/instagram/posts/${id}`)).data;
export const publishPostNow = async (id: number) => (await api.post<InstagramPost>(`/instagram/posts/${id}/publish`)).data;

export const listAutomations = async (projectId?: number) => (await api.get<InstagramAutomation[]>("/instagram/automations", { params: { project_id: projectId } })).data;
export const automationSummary = async (projectId?: number) => (await api.get<{ active: number; comments: number; replies: number; dms: number }>("/instagram/automations/summary", { params: { project_id: projectId } })).data;
export const createAutomation = async (input: AutomationInput) => (await api.post<InstagramAutomation>("/instagram/automations", input)).data;
export const updateAutomation = async (id: number, input: Partial<AutomationInput>) => (await api.put<InstagramAutomation>(`/instagram/automations/${id}`, input)).data;
export const deleteAutomation = async (id: number) => (await api.delete(`/instagram/automations/${id}`)).data;
export const listEngagements = async (id: number) => (await api.get<Engagement[]>(`/instagram/automations/${id}/engagements`)).data;
