export interface User {
  id: number;
  company_id?: number | null;
  branch_id?: number | null;
  telegram_id?: string | null;
  photo?: string | null;
  first_name: string;
  last_name?: string | null;
  username?: string | null;
  biography?: string | null;
  document?: string | null;
  datebirth?: string | null;
  genre?: string | null;
  telephone?: string | null;
  email: string;
  status: string;
  url?: string | null;
  level: number;
  role?: string;
  schedule_settings?: string | null;
}

export type NotificationType =
  | "ticket_created"
  | "meeting_reminder"
  | "campaign_started"
  | "agent_run_finished"
  | "habit_reminder"
  | "weekly_summary"
  | "instagram_post";

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface NotificationChannelSettings {
  push: Record<NotificationType, boolean>;
  email: Record<NotificationType, boolean>;
}

export interface FunnelStage {
  id: number;
  company_id?: number | null;
  funnel_id?: number | null;
  name: string;
  status?: string | null;
  stage_order?: number | null;
  stage_done?: boolean | null;
}

export interface ProjectUser {
  id: number;
  project_id?: number | null;
  user_id?: number | null;
  user?: Pick<User, "id" | "first_name" | "last_name" | "username" | "photo" | "email"> | null;
}

export type FunnelVisibility = "everyone" | "restricted";

export interface FunnelUser {
  id: number;
  funnel_id?: number | null;
  user_id?: number | null;
  user?: Pick<User, "id" | "first_name" | "last_name" | "username" | "photo" | "email"> | null;
}

export interface Funnel {
  id: number;
  project_id: number;
  company_id?: number | null;
  name: string;
  prefix?: string | null;
  is_default?: boolean | null;
  visibility: FunnelVisibility;
  stages: FunnelStage[];
}

export interface Project {
  id: number;
  company_id?: number | null;
  user_id?: number | null;
  is_default_project?: boolean | null;
  name: string;
  content?: string | null;
  color?: string | null;
  favorite?: boolean | null;
  drive_folder_id?: string | null;
  drive_folder_link?: string | null;
  drive_owner_user_id?: number | null;
  funnels: Funnel[];
  projectUsers?: ProjectUser[];
}

export interface Credential {
  id: number;
  company_id?: number | null;
  project_id?: number | null;
  user_id?: number | null;
  title: string;
  category?: string | null;
  username?: string | null;
  url?: string | null;
  notes?: string | null;
  has_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskUser {
  id: number;
  task_id?: number | null;
  user_id?: number | null;
  user?: Pick<User, "id" | "first_name" | "last_name" | "username" | "photo" | "email"> | null;
}

export interface TaskChecklist {
  id: number;
  task_id: number;
  title: string;
  is_done: boolean | number;
}

export interface TaskAttachment {
  id: number;
  task_id: number;
  file_name: string;
  file_url: string;
  file_size: number;
  file_type: string;
  created_at: string;
  updated_at: string;
}

export type TranscriptStatus = "pending" | "processing" | "done" | "error";

export interface TranscriptMessage {
  id: number;
  transcript_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface TaskTranscript {
  id: number;
  task_id: number;
  attachment_id: number | null;
  status: TranscriptStatus;
  text: string | null;
  language: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  messages?: TranscriptMessage[];
}

export interface TaskActivity {
  id: number;
  company_id?: number | null;
  task_id?: number | null;
  user_id?: number | null;
  content: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
  is_client?: boolean;
  created_at: string;
  user?: User | null;
}

export interface Task {
  approved_at?: string | null;
  approved_by?: string | null;
  id: number;
  company_id?: number | null;
  funnel_id?: number | null;
  stage_id?: number | null;
  sort_order?: number | null;
  user_id?: number | null;
  task_id?: number | null;
  sprint_id?: number | null;
  meet_id?: string | null;
  platform_company_id?: number | null;
  platform_company_name?: string | null;
  priority?: string | null;
  due_at?: string | null;
  end_at?: string | null;
  hour_at?: string | null;
  estimated_time?: string | null;
  story_points?: number | null;
  title: string;
  slug?: string | null;
  description?: string | null;
  content?: string | null;
  type?: string | null;
  meet_uri?: string | null;
  template?: 'default' | 'spreadsheet' | 'form' | 'proposal' | 'flowchart' | 'whatsapp' | 'whiteboard' | 'instagram_post' | 'social_post' | null;
  form_schema?: string | null;
  folder_id?: number | null;
  proposal_template_id?: number | null;
  proposal_data?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  group_id?: string | null;
  icon?: string | null;
  cover?: string | null;
  status: string;
  is_sprint?: boolean | null;
  is_called?: boolean | null;
  is_whatsapp?: boolean | null;
  call_reason?: string | null;
  started_at?: string | null;
  closed_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;

  user?: User | null;
  taskUsers?: TaskUser[];
  checklists: TaskChecklist[];
  attachments: TaskAttachment[];
  activities: TaskActivity[];
  formResponses?: any[];
  folder?: Folder | null;
}

export interface ProposalTemplate {
  id: number;
  company_id?: number | null;
  user_id?: number | null;
  name: string;
  is_default: boolean;
  cover?: string | null;
  about_company?: string | null;
  about_work?: string | null;
  values?: string | null;
  thank_you?: string | null;
  styles?: string | null;
  design: string;
  theme?: string | null;
  slides?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomFont {
  id: number;
  company_id?: number | null;
  user_id: number;
  family: string;
  url: string;
  weight: number;
  style: string;
  created_at: string;
}

export interface Design {
  id: number;
  company_id?: number | null;
  user_id: number;
  project_id?: number | null;
  name: string;
  thumbnail_url?: string | null;
  width: number;
  height: number;
  pages: string; // JSON-encoded DesignPage[] — see src/lib/design-studio/types.ts
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: number;
  name: string;
  user_id: number;
  created_at: string;
  updated_at: string;
}