import { z } from "zod";

const booleanCoercible = z.preprocess((val) => {
  if (val === "true" || val === "1" || val === 1) return true;
  if (val === "false" || val === "0" || val === 0) return false;
  return val;
}, z.boolean().optional().nullable());

export const registerSchema = z.object({
  first_name: z.string().min(1, "Nome é obrigatório"),
  last_name: z.string().optional().default(""),
  email: z.string().email("E-mail inválido"),
  username: z.string().min(3, "Username deve ter no mínimo 3 caracteres"),
  password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
  biography: z.string().optional(),
  photo: z.string().url().optional(),
});

export const loginSchema = z.object({
  login: z.string().min(1, "Login é obrigatório"),
  password: z.string().min(1, "Senha é obrigatória"),
});

export const updateUserSchema = z.object({
  biography: z.string().optional(),
  photo: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  telephone: z.string().optional(),
  username: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional().or(z.literal("")),
  schedule_settings: z.string().optional(),
});

export const createProjectSchema = z.object({
  name: z.string().min(1, "Nome do projeto é obrigatório"),
  content: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1, "Nome do projeto é obrigatório").optional(),
  content: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  favorite: z.boolean().optional(),
  is_default_project: z.boolean().optional(),
});

export const createFunnelSchema = z.object({
  name: z.string().min(1, "Nome do funil é obrigatório"),
  prefix: z.string().max(10).optional(),
  visibility: z.enum(["everyone", "restricted"]).optional(),
});

export const updateFunnelSchema = z.object({
  name: z.string().min(1, "Nome do funil é obrigatório").optional(),
  prefix: z.string().max(10).optional(),
  visibility: z.enum(["everyone", "restricted"]).optional(),
});

export const addFunnelUserSchema = z.object({
  user_id: z.number(),
});

export const createStageSchema = z.object({
  name: z.string().min(1, "Nome da etapa é obrigatório"),
  status: z.enum(["notdone", "inprogress", "done", "review"]).optional(),
});

export const updateStageSchema = z.object({
  name: z.string().optional(),
  status: z.enum(["notdone", "inprogress", "done", "review"]).optional(),
  stage_order: z.number().optional(),
});

export const createTaskSchema = z.object({
  funnel_id: z.number().nullable().optional(),
  stage_id: z.number().nullable().optional(),
  title: z.string().min(1, "Título da tarefa é obrigatório"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "none"]).nullable().optional(),
  user_id: z.number().nullable().optional(),
  task_id: z.number().nullable().optional(),
  due_at: z.string().nullable().optional(),
  hour_at: z.string().nullable().optional(),
  estimated_time: z.string().nullable().optional(),
  story_points: z.number().nullable().optional(),
  type: z.enum(["task", "meeting", "note"]).nullable().optional(),
  is_sprint: booleanCoercible,
  is_called: booleanCoercible,
  is_whatsapp: booleanCoercible,
  sprint_id: z.number().nullable().optional(),
  call_reason: z.string().optional().nullable(),
  platform_company_id: z.number().nullable().optional(),
  platform_company_name: z.string().optional().nullable(),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  folder_id: z.number().nullable().optional(),
});

export const updateTaskSchema = z.object({
  funnel_id: z.number().nullable().optional(),
  stage_id: z.number().nullable().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "none"]).nullable().optional(),
  user_id: z.number().nullable().optional(),
  task_id: z.number().nullable().optional(),
  due_at: z.string().nullable().optional(),
  hour_at: z.string().nullable().optional(),
  estimated_time: z.string().nullable().optional(),
  story_points: z.number().nullable().optional(),
  end_at: z.string().nullable().optional(),
  type: z.enum(["task", "meeting", "note"]).nullable().optional(),
  status: z.enum(["notdone", "inprogress", "done", "review"]).nullable().optional(),
  meet_uri: z.string().optional(),
  sort_order: z.number().optional(),
  cover: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  is_sprint: booleanCoercible,
  is_called: booleanCoercible,
  is_whatsapp: booleanCoercible,
  sprint_id: z.number().nullable().optional(),
  call_reason: z.string().optional().nullable(),
  platform_company_id: z.number().nullable().optional(),
  platform_company_name: z.string().optional().nullable(),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  content: z.string().optional(),
  template: z.enum(['default', 'spreadsheet', 'form', 'proposal', 'flowchart', 'whatsapp', 'whiteboard']).nullable().optional(),
  form_schema: z.string().nullable().optional(),
  folder_id: z.number().nullable().optional(),
  proposal_template_id: z.number().nullable().optional(),
  proposal_data: z.string().nullable().optional(),
});

export const createChecklistSchema = z.object({
  title: z.string().min(1, "Título do item é obrigatório"),
});

export const updateChecklistSchema = z.object({
  is_done: z.boolean().optional(),
  title: z.string().optional(),
});

export const createActivitySchema = z
  .object({
    content: z.string().optional(),
    attachment_url: z.string().optional(),
    attachment_name: z.string().optional(),
    attachment_type: z.string().optional(),
    attachment_size: z.number().optional(),
  })
  .refine((data) => (data.content && data.content.trim().length > 0) || !!data.attachment_url, {
    message: "Informe uma mensagem ou anexe um arquivo",
    path: ["content"],
  });

export const addTaskMemberSchema = z.object({
  user_id: z.number(),
});

export const addProjectUserSchema = z.object({
  user_id: z.number(),
});

export const uploadDriveFileSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1),
  folderId: z.string().optional(),
});

export const createDriveFolderSchema = z.object({
  name: z.string().min(1),
  parentFolderId: z.string().optional(),
});

const credentialCategorySchema = z.enum(["website", "server", "database", "email", "api", "other"]);

export const createCredentialSchema = z.object({
  title: z.string().min(1, "Título é obrigatório").max(200),
  category: credentialCategorySchema.optional(),
  username: z.string().max(255).optional().nullable(),
  password: z.string().max(500).optional().nullable(),
  url: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const updateCredentialSchema = z.object({
  title: z.string().min(1, "Título é obrigatório").max(200).optional(),
  category: credentialCategorySchema.optional(),
  username: z.string().max(255).optional().nullable(),
  password: z.string().max(500).optional().nullable(),
  url: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const createProposalTemplateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  cover: z.string().optional().nullable(),
  about_company: z.string().optional().nullable(),
  about_work: z.string().optional().nullable(),
  values: z.string().optional().nullable(),
  thank_you: z.string().optional().nullable(),
  styles: z.string().optional().nullable(),
  is_default: z.boolean().optional(),
  design: z.enum(["classic", "model1", "model2"]).optional(),
  theme: z.string().optional().nullable(),
  slides: z.string().optional().nullable(),
});

export const updateProposalTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  cover: z.string().optional().nullable(),
  about_company: z.string().optional().nullable(),
  about_work: z.string().optional().nullable(),
  values: z.string().optional().nullable(),
  thank_you: z.string().optional().nullable(),
  styles: z.string().optional().nullable(),
  is_default: z.boolean().optional(),
  design: z.enum(["classic", "model1", "model2"]).optional(),
  theme: z.string().optional().nullable(),
  slides: z.string().optional().nullable(),
});

export const createDesignSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  project_id: z.number().int().positive().optional().nullable(),
  thumbnail_url: z.string().max(500).optional().nullable(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  pages: z.string().optional(),
});

export const updateDesignSchema = z.object({
  name: z.string().min(1).optional(),
  project_id: z.number().int().positive().optional().nullable(),
  thumbnail_url: z.string().max(500).optional().nullable(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  pages: z.string().optional(),
});

export const createPhotoDocumentSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(200),
  project_id: z.number().int().positive().optional().nullable(),
  width: z.number().int().min(1).max(16000).optional(),
  height: z.number().int().min(1).max(16000).optional(),
  doc: z.string().optional(),
});

export const sharePhotoDocumentSchema = z.object({
  enabled: z.boolean(),
  image_url: z.string().min(1).max(500).optional(),
});

export const updatePhotoDocumentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  visibility: z.enum(["private", "project"]).optional(),
  project_id: z.number().int().positive().optional().nullable(),
  thumbnail_url: z.string().max(500).optional().nullable(),
  width: z.number().int().min(1).max(16000).optional(),
  height: z.number().int().min(1).max(16000).optional(),
  doc: z.string().optional(),
});

export const createCustomFontSchema = z.object({
  family: z.string().min(1, "Nome da fonte é obrigatório").max(200),
  url: z.string().min(1, "Arquivo é obrigatório").max(500),
  weight: z.number().int().min(100).max(900).optional(),
  style: z.enum(["normal", "italic"]).optional(),
});

export const publicBookingSchema = z.object({
  title: z.string().min(1, "Título é obrigatório"),
  description: z.string().optional(),
  email: z.string().email("E-mail inválido"),
  phone: z.string().optional(),
  first_name: z.string().min(1, "Nome é obrigatório"),
  last_name: z.string().optional(),
  due_at: z.string().min(1, "Data é obrigatória"),
  hour_at: z.string().min(1, "Horário é obrigatório"),
});

// ─── WhatsApp ───

export const createWhatsAppConnectionSchema = z.object({
  label: z.string().min(1, "Nome da conexão é obrigatório").max(100),
});

export const renameWhatsAppConnectionSchema = z.object({
  label: z.string().min(1, "Nome da conexão é obrigatório").max(100),
});

export const createWhatsAppListSchema = z.object({
  name: z.string().min(1, "Nome da lista é obrigatório").max(150),
  connection_id: z.number().int().positive().optional().nullable(),
});

export const updateWhatsAppListSchema = z.object({
  name: z.string().min(1, "Nome da lista é obrigatório").max(150).optional(),
  connection_id: z.number().int().positive().optional().nullable(),
});

export const createWhatsAppContactSchema = z.object({
  name: z.string().max(150).optional().nullable(),
  phone: z.string().min(1, "Telefone é obrigatório").max(30),
  tags: z.string().max(255).optional().nullable(),
  opted_out: z.boolean().optional(),
});

export const updateWhatsAppContactSchema = z.object({
  name: z.string().max(150).optional().nullable(),
  phone: z.string().min(1).max(30).optional(),
  tags: z.string().max(255).optional().nullable(),
  opted_out: z.boolean().optional(),
});

export const bulkWhatsAppContactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().optional().nullable(),
        phone: z.string().min(1),
        tags: z.string().optional().nullable(),
      })
    )
    .min(1, "Envie ao menos um contato."),
});

const whatsAppRecipientSchema = z.object({
  name: z.string().optional().nullable(),
  phone: z.string().min(1),
});

function refineDelayRange<T extends { min_delay_seconds?: number; max_delay_seconds?: number }>(
  schema: z.ZodType<T>
) {
  return schema.refine(
    (data) => data.min_delay_seconds === undefined || data.max_delay_seconds === undefined || data.max_delay_seconds >= data.min_delay_seconds,
    { message: "O intervalo máximo deve ser maior ou igual ao mínimo.", path: ["max_delay_seconds"] }
  );
}

const whatsAppMediaTypeSchema = z.enum(["image", "video", "audio", "document"]).optional().nullable();

// Message text is required UNLESS a media attachment is present (there it doubles as the
// optional caption — or is simply absent, e.g. for an audio send).
function refineMessageOrMedia<T extends { message?: string; media_type?: string | null }>(schema: z.ZodType<T>) {
  return schema.refine((data) => !!data.media_type || !!(data.message && data.message.trim()), {
    message: "Escreva uma mensagem de texto ou anexe uma mídia.",
    path: ["message"],
  });
}

export const createWhatsAppCampaignSchema = refineMessageOrMedia(
  refineDelayRange(
    z.object({
      connection_id: z.number().int().positive("Selecione uma conexão"),
      list_id: z.number().int().positive().optional().nullable(),
      group_jid: z.string().min(1).max(100).optional().nullable(),
      media_url: z.string().max(500).optional().nullable(),
      media_type: whatsAppMediaTypeSchema,
      media_filename: z.string().max(255).optional().nullable(),
      name: z.string().min(1, "Nome da campanha é obrigatório").max(150),
      message: z.string().max(4096).optional().default(""),
      scheduled_at: z.string().optional().nullable(),
      min_delay_seconds: z.number().int().min(1).max(600).optional(),
      max_delay_seconds: z.number().int().min(1).max(1200).optional(),
      daily_limit: z.number().int().min(1).max(5000).optional().nullable(),
      recipients: z.array(whatsAppRecipientSchema).optional(),
    })
  )
);

export const updateWhatsAppCampaignSchema = refineDelayRange(
  z.object({
    connection_id: z.number().int().positive().optional(),
    list_id: z.number().int().positive().optional().nullable(),
    group_jid: z.string().min(1).max(100).optional().nullable(),
    media_url: z.string().max(500).optional().nullable(),
    media_type: whatsAppMediaTypeSchema,
    media_filename: z.string().max(255).optional().nullable(),
    name: z.string().min(1).max(150).optional(),
    message: z.string().max(4096).optional(),
    scheduled_at: z.string().optional().nullable(),
    min_delay_seconds: z.number().int().min(1).max(600).optional(),
    max_delay_seconds: z.number().int().min(1).max(1200).optional(),
    daily_limit: z.number().int().min(1).max(5000).optional().nullable(),
    recipients: z.array(whatsAppRecipientSchema).optional(),
  })
);

// Same shape as create, but `name` is optional (auto-defaulted from the task) since this upserts
// the single campaign linked to a "whatsapp" task rather than creating a standalone one.
export const upsertTaskWhatsAppCampaignSchema = refineMessageOrMedia(
  refineDelayRange(
    z.object({
      connection_id: z.number().int().positive("Selecione uma conexão"),
      list_id: z.number().int().positive().optional().nullable(),
      group_jid: z.string().min(1).max(100).optional().nullable(),
      media_url: z.string().max(500).optional().nullable(),
      media_type: whatsAppMediaTypeSchema,
      media_filename: z.string().max(255).optional().nullable(),
      name: z.string().max(150).optional(),
      message: z.string().max(4096).optional().default(""),
      scheduled_at: z.string().optional().nullable(),
      min_delay_seconds: z.number().int().min(1).max(600).optional(),
      max_delay_seconds: z.number().int().min(1).max(1200).optional(),
      daily_limit: z.number().int().min(1).max(5000).optional().nullable(),
      recipients: z.array(whatsAppRecipientSchema).optional(),
    })
  )
);

export const scheduleWhatsAppCampaignSchema = z.object({
  scheduled_at: z.string().optional().nullable(),
});

// ─── AI AGENTS HUB ───

export const aiProviderSchema = z.enum(["groq", "openai", "anthropic", "openrouter"]);

export const aiProviderParamsSchema = z.object({
  provider: aiProviderSchema,
});

export const upsertAiCredentialSchema = z.object({
  api_key: z.string().min(1, "Chave de API é obrigatória").max(2000),
  label: z.string().max(100).optional().nullable(),
});

export const createAgentSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(150),
  description: z.string().max(2000).optional().nullable(),
  avatar_emoji: z.string().max(10).optional().nullable(),
  avatar_color: z.string().max(7).optional().nullable(),
  provider: aiProviderSchema,
  model: z.string().min(1, "Selecione um modelo").max(100),
  system_prompt: z.string().min(1, "Prompt de sistema é obrigatório"),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(32000).optional(),
  allowed_tools: z.array(z.string()).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(150).optional(),
  description: z.string().max(2000).optional().nullable(),
  avatar_emoji: z.string().max(10).optional().nullable(),
  avatar_color: z.string().max(7).optional().nullable(),
  provider: aiProviderSchema.optional(),
  model: z.string().min(1).max(100).optional(),
  system_prompt: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(32000).optional(),
  allowed_tools: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

export const runAgentSchema = z.object({
  message: z.string().min(1, "Mensagem é obrigatória"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .optional(),
  icp_ids: z.array(z.number().int().positive()).optional(),
});

const agentPipelineNodeSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.any()).optional(),
});

const agentPipelineEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string().optional(),
  label: z.string().optional(),
});

export const createAgentPipelineSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(200),
  description: z.string().max(2000).optional().nullable(),
  nodes: z.array(agentPipelineNodeSchema).default([]),
  edges: z.array(agentPipelineEdgeSchema).default([]),
});

export const updateAgentPipelineSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  nodes: z.array(agentPipelineNodeSchema).optional(),
  edges: z.array(agentPipelineEdgeSchema).optional(),
  is_active: z.boolean().optional(),
});

export const runAgentPipelineSchema = z.object({
  input: z.string().min(1, "Entrada inicial é obrigatória"),
});

const messageAttachmentSchema = z.object({
  url: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().nonnegative(),
});

export const sendConversationMessageSchema = z
  .object({
    conversation_id: z.number().int().positive().optional().nullable(),
    message: z.string(),
    icp_ids: z.array(z.number().int().positive()).optional(),
    attachments: z.array(messageAttachmentSchema).max(5, "No máximo 5 arquivos por mensagem").optional(),
  })
  .refine((data) => data.message.trim().length > 0 || (data.attachments && data.attachments.length > 0), {
    message: "Mensagem ou ao menos um anexo é obrigatório",
    path: ["message"],
  });

export const updateConversationSchema = z.object({
  title: z.string().min(1, "Título é obrigatório").max(150),
});

export const createIcpSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(150),
  niche: z.string().max(150).optional().nullable(),
  description: z.string().min(1, "Descrição é obrigatória"),
});

export const updateIcpSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(150).optional(),
  niche: z.string().max(150).optional().nullable(),
  description: z.string().min(1).optional(),
});

// ─── Hábitos ───

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD)");

export const createHabitSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(150),
  description: z.string().max(255).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida").optional(),
  target_per_week: z.number().int().min(1).max(7).optional(),
  kind: z.enum(["habit", "routine"]).optional(),
  project_id: z.number().int().positive().nullable().optional(),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM)").nullable().optional(),
  reminder_days: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  checklist: z.array(z.string().max(200)).max(20).nullable().optional(),
  health_metric: z.enum(["steps", "water", "sleep", "workout"]).nullable().optional(),
});

export const createTeamHabitSchema = createHabitSchema.extend({
  assignee_ids: z.array(z.number().int().positive()).min(1, "Escolha ao menos uma pessoa").max(100),
});

export const updateTeamHabitSchema = createHabitSchema.partial().extend({
  assignee_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
});

export const saveFocusSchema = z.object({
  date: dayString,
  items: z
    .array(
      z.object({
        id: z.string().max(40),
        text: z.string().max(200),
        done: z.boolean(),
        task_id: z.number().int().positive().nullable().optional(),
      })
    )
    .max(3),
  review: z.string().max(2000).nullable().optional(),
});

export const updateHabitSchema = createHabitSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const habitLogSchema = z.object({
  date: dayString,
  done: z.boolean(),
  today: dayString.optional(),
});


// ─── Saúde ───

const scale15 = z.number().int().min(1).max(5);

export const healthDayFields = {
  steps: z.number().int().min(0).max(200000).nullable().optional(),
  water_ml: z.number().int().min(0).max(20000).nullable().optional(),
  sleep_min: z.number().int().min(0).max(1440).nullable().optional(),
  sleep_quality: scale15.nullable().optional(),
  weight_kg: z.number().min(20).max(500).nullable().optional(),
  body_fat: z.number().min(1).max(80).nullable().optional(),
  waist_cm: z.number().min(20).max(300).nullable().optional(),
  neck_cm: z.number().min(15).max(80).nullable().optional(),
  chest_cm: z.number().min(40).max(250).nullable().optional(),
  arm_cm: z.number().min(10).max(80).nullable().optional(),
  hip_cm: z.number().min(40).max(250).nullable().optional(),
  thigh_cm: z.number().min(20).max(130).nullable().optional(),
  calf_cm: z.number().min(15).max(80).nullable().optional(),
  mood: scale15.nullable().optional(),
  energy: scale15.nullable().optional(),
  stress: scale15.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
};

export const healthDaySchema = z.object({ ...healthDayFields });

export const healthWaterSchema = z.object({ delta_ml: z.number().int().min(-5000).max(5000) });

export const healthWorkoutSchema = z.object({
  date: dayString,
  type: z.string().trim().min(1, "Informe o tipo de treino").max(40),
  duration_min: z.number().int().min(1).max(1440),
  calories: z.number().int().min(0).max(20000).nullable().optional(),
  distance_km: z.number().min(0).max(1000).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
  external_id: z.string().max(100).nullable().optional(),
});

export const healthGoalsSchema = z.object({
  steps: z.number().int().min(1000).max(100000).optional(),
  water_ml: z.number().int().min(500).max(10000).optional(),
  sleep_min: z.number().int().min(180).max(900).optional(),
  workouts_per_week: z.number().int().min(0).max(14).optional(),
  weight_kg: z.number().min(20).max(500).nullable().optional(),
});

export const healthIngestSchema = z.object({
  days: z.array(z.object({ date: dayString, ...healthDayFields })).max(400).optional(),
  workouts: z.array(healthWorkoutSchema).max(400).optional(),
});
