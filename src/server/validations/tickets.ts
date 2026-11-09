import { z } from "zod";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida");

export const ticketConnectionSettingsSchema = z.object({
  receive_tickets: z.boolean().optional(),
  greeting_message: z.string().max(2000).nullable().optional(),
  farewell_message: z.string().max(2000).nullable().optional(),
});

export const startConversationSchema = z
  .object({
    contact_id: z.number().int().positive().optional(),
    number: z.string().min(8).max(25).optional(),
    name: z.string().max(200).optional(),
    connection_id: z.number().int().positive(),
    queue_id: z.number().int().positive().nullable().optional(),
  })
  .refine((v) => v.contact_id || v.number, { message: "Informe um contato ou um número." });

export const updateTicketSchema = z.object({
  status: z.enum(["pending", "open", "closed"]).optional(),
  user_id: z.number().int().positive().nullable().optional(),
  queue_id: z.number().int().positive().nullable().optional(),
  connection_id: z.number().int().positive().optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
  is_parallel: z.boolean().optional(),
  mark_unread: z.boolean().optional(),
  close_reason: z.string().max(50).nullable().optional(),
  customer_sentiment: z.string().max(30).nullable().optional(),
  closing_observations: z.string().max(5000).nullable().optional(),
});

export const bulkTransferSchema = z.object({
  ticket_ids: z.array(z.number().int().positive()).min(1, "Selecione ao menos um ticket."),
  user_id: z.number().int().positive().nullable().optional(),
  queue_id: z.number().int().positive().nullable().optional(),
  status: z.enum(["pending", "open", "closed"]).optional(),
});

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(8000),
  quoted_message_id: z.number().int().positive().optional(),
  is_internal: z.boolean().optional(),
});

export const ticketTaskSchema = z.object({
  title: z.string().min(1, "Título da tarefa é obrigatório").max(255),
  description: z.string().max(10000).optional(),
  priority: z.enum(["low", "medium", "high", "none"]).nullable().optional(),
  user_id: z.number().int().positive().nullable().optional(),
  due_at: z.string().nullable().optional(),
  funnel_id: z.number().int().nullable().optional(),
  stage_id: z.number().int().nullable().optional(),
});

export const queueSchema = z.object({
  name: z.string().min(1, "Nome da fila é obrigatório").max(100),
  color: colorSchema,
  greeting_message: z.string().max(2000).nullable().optional(),
  auto_distribution: z.boolean().optional(),
  user_ids: z.array(z.number().int().positive()).optional(),
});
export const updateQueueSchema = queueSchema.partial();

export const tagSchema = z.object({
  name: z.string().min(1, "Nome da etiqueta é obrigatório").max(60),
  color: colorSchema,
});
export const updateTagSchema = tagSchema.partial();

const graphSchema = z.union([z.string(), z.object({ nodes: z.array(z.any()), edges: z.array(z.any()), startNodeId: z.string() })]);

export const botFlowSchema = z.object({
  name: z.string().min(1, "Nome do fluxo é obrigatório").max(150),
  type: z.enum(["entry", "queue", "automation"]),
  queue_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
  restart_on_reopen: z.boolean().optional(),
  status_filter: z.array(z.enum(["pending", "open", "closed"])).nullable().optional(),
  connection_ids: z.array(z.number().int().positive()).optional(),
  draft_graph: graphSchema.optional(),
});
export const updateBotFlowSchema = botFlowSchema.partial();
