import { z } from "zod";
import { prisma } from "../../prisma";
import type { ToolHandler } from "./registry";

const argsSchema = z.object({
  project_id: z.number().int().positive(),
});

export const getProjectSummaryTool: ToolHandler = {
  definition: {
    name: "get_project_summary",
    description:
      "Retorna um resumo somente leitura de um projeto: nome, total de tarefas por status e próximos vencimentos. Use para entender o estado atual do projeto antes de agir.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "number", description: "ID do projeto" },
      },
      required: ["project_id"],
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
      select: { id: true, name: true },
    });
    if (!project) {
      throw new Error("Projeto não encontrado ou você não tem acesso a ele.");
    }

    const tasks = await prisma.task.findMany({
      where: { funnel: { project_id: args.project_id }, deleted_at: null },
      select: { status: true, due_at: true },
    });

    const byStatus: Record<string, number> = {};
    for (const t of tasks) {
      const key = t.status || "notdone";
      byStatus[key] = (byStatus[key] || 0) + 1;
    }

    const upcomingDueDates = tasks
      .filter((t): t is typeof t & { due_at: Date } => !!t.due_at)
      .sort((a, b) => a.due_at.getTime() - b.due_at.getTime())
      .slice(0, 5)
      .map((t) => t.due_at.toISOString());

    return JSON.stringify({
      project: project.name,
      total_tasks: tasks.length,
      by_status: byStatus,
      upcoming_due_dates: upcomingDueDates,
    });
  },
};
