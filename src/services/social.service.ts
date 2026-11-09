import api from "./api";

export type Platform = "youtube" | "tiktok";
export type SocialKind = "youtube_short" | "youtube_video" | "tiktok";
export type SocialStatus = "scheduled" | "publishing" | "published" | "failed";

export const KIND_LABEL: Record<SocialKind, string> = { youtube_short: "YouTube Shorts", youtube_video: "YouTube", tiktok: "TikTok" };
export const PLATFORM_LABEL: Record<Platform, string> = { youtube: "YouTube", tiktok: "TikTok" };

export interface SocialConfig {
  platform: Platform;
  configured: boolean;
  source: "db" | "env" | "none";
  can_edit: boolean;
  client_id: string;
  has_secret: boolean;
  public_url: string;
  redirect_uri: string | null;
}

export interface SocialConnection {
  id: number;
  username: string | null;
  avatar: string | null;
  token_error: string | null;
}

export interface SocialProject {
  project_id: number;
  project_name: string;
  project_color: string | null;
  youtube: SocialConnection | null;
  tiktok: SocialConnection | null;
}

export interface SocialAccounts {
  configured: Record<Platform, boolean>;
  projects: SocialProject[];
}

export interface YoutubeOptions {
  privacy: "public" | "unlisted" | "private";
  tags: string[];
  category_id: string;
  made_for_kids: boolean;
}

export interface TiktokOptions {
  mode: "direct" | "draft";
  privacy_level: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
}

export interface SocialPost {
  id: number;
  kind: SocialKind;
  platform: Platform;
  group_id: string | null;
  project: { id: number; name: string; color: string | null; username: string | null };
  task_id: number | null;
  title: string | null;
  caption: string;
  media: string[];
  options: Partial<YoutubeOptions & TiktokOptions>;
  status: SocialStatus;
  scheduled_at: string | null;
  published_at: string | null;
  external_id: string | null;
  permalink: string | null;
  note: string | null;
  attempts: number;
  error: string | null;
}

export interface TiktokCreatorInfo {
  nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

export const getConfig = async () => (await api.get<Record<Platform, SocialConfig>>("/social/config")).data;
export const saveConfig = async (platform: Platform, input: { client_id: string; client_secret?: string; public_url: string }) =>
  (await api.put<SocialConfig>(`/social/config/${platform}`, input)).data;
export const listAccounts = async () => (await api.get<SocialAccounts>("/social/accounts")).data;
export const getConnectUrl = async (projectId: number, platform: Platform) => (await api.post<{ url: string }>("/social/connect-url", { project_id: projectId, platform })).data.url;
export const disconnect = async (projectId: number, platform: Platform) => (await api.delete<SocialAccounts>("/social/account", { params: { project_id: projectId, platform } })).data;
export const tiktokCreatorInfo = async (projectId: number) => (await api.get<TiktokCreatorInfo>("/social/tiktok/creator-info", { params: { project_id: projectId } })).data;

export const listPosts = async (projectId?: number) => (await api.get<SocialPost[]>("/social/posts", { params: { project_id: projectId } })).data;
export const getPostByTask = async (taskId: number) => (await api.get<SocialPost>(`/social/posts/by-task/${taskId}`)).data;
export const createPosts = async (input: {
  project_id: number;
  title?: string;
  caption: string;
  media: string[];
  scheduled_at?: string | null;
  targets: { kind: SocialKind; options?: Partial<YoutubeOptions & TiktokOptions> }[];
}) => (await api.post<SocialPost[]>("/social/posts", input)).data;
export const updatePost = async (id: number, input: { title?: string; caption?: string; media?: string[]; scheduled_at?: string | null; options?: Partial<YoutubeOptions & TiktokOptions> }) =>
  (await api.put<SocialPost>(`/social/posts/${id}`, input)).data;
export const deletePost = async (id: number) => (await api.delete(`/social/posts/${id}`)).data;
export const publishPostNow = async (id: number) => (await api.post<SocialPost>(`/social/posts/${id}/publish`)).data;
