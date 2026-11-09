import { z } from "zod";
import { prisma } from "../../prisma";
import { createTask } from "../../../services/task.service";
import type { ToolHandler } from "./registry";

const argsSchema = z.object({
  project_id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export const createTaskTool: ToolHandler = {
  definition: {
    name: "create_task",
    description:
      "Cria uma nova tarefa em um projeto do CollabSuite. Use quando o usuário pedir para criar, registrar ou anotar uma tarefa/ação.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "number", description: "ID do projeto onde a tarefa será criada" },
        title: { type: "string", description: "Título da tarefa" },
        description: { type: "string", description: "Descrição opcional da tarefa" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Prioridade da tarefa" },
      },
      required: ["project_id", "title"],
    },
  },
  argsSchema,
  async execute(rawArgs, ctx) {
    const args = argsSchema.parse(rawArgs);

    const project = await prisma.project.findFirst({
      where: {
        id: args.project_id,
        OR: [{ user_id: ctx.userId }, { projectUsers: { some: { user_id: ctx.userId } } }],
      },
      select: { id: true },
    });
    if (!project) {
      throw new Error("Projeto não encontrado ou você não tem acesso a ele.");
    }

    const funnel = await prisma.funnel.findFirst({
      where: { project_id: args.project_id, is_default: true },
      orderBy: { id: "asc" },
    });
    if (!funnel) {
      throw new Error("Nenhum funil encontrado para este projeto.");
    }

    const stage = await prisma.funnelStage.findFirst({
      where: { funnel_id: funnel.id },
      orderBy: { stage_order: "asc" },
    });

    const task = await createTask(
      {
        funnel_id: funnel.id,
        stage_id: stage?.id,
        title: args.title,
        description: args.description,
        priority: args.priority,
        user_id: ctx.userId,
        type: "task",
      },
      ctx.userId
    );

    return JSON.stringify({ success: true, task_id: task.id, title: args.title });
  },
};
