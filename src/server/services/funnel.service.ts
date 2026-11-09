import { prisma } from "../lib/prisma";
import { funnelVisibilityFilter } from "./access.service";

const FUNNEL_INCLUDE = {
  stages: { orderBy: { stage_order: "asc" as const } },
};

const SHARED_USER_SELECT = {
  user: {
    select: { id: true, first_name: true, last_name: true, username: true, photo: true, email: true },
  },
};

export async function listFunnelsByUser(userId: number) {
  return prisma.funnel.findMany({
    where: {
      project: {
        OR: [
          { user_id: userId },
          { projectUsers: { some: { user_id: userId } } },
        ],
      },
      ...funnelVisibilityFilter(userId),
    },
    include: FUNNEL_INCLUDE,
  });
}

export async function listFunnelsByProject(projectId: number, userId: number) {
  return prisma.funnel.findMany({
    where: { project_id: projectId, ...funnelVisibilityFilter(userId) },
    include: FUNNEL_INCLUDE,
    orderBy: { created_at: "asc" },
  });
}

export async function createFunnel(projectId: number, data: { name: string; prefix?: string; visibility?: "everyone" | "restricted" }) {
  return prisma.$transaction(async (tx) => {
    const funnel = await tx.funnel.create({
      data: {
        project_id: projectId,
        name: data.name,
        prefix: data.prefix || null,
        is_default: false,
        visibility: data.visibility || "everyone",
      },
    });

    const defaultStages = [
      { name: "BACKLOG", status: "notdone", done: false },
      { name: "SPRINT GOAL", status: "notdone", done: false },
      { name: "TODO", status: "notdone", done: false },
      { name: "IN PROGRESS", status: "inprogress", done: false },
      { name: "REVIEW / QA", status: "inprogress", done: false },
      { name: "DONE", status: "done", done: true },
    ];

    for (let i = 0; i < defaultStages.length; i++) {
      await tx.funnelStage.create({
        data: {
          funnel_id: funnel.id,
          name: defaultStages[i].name,
          stage_order: i + 1,
          status: defaultStages[i].status,
          stage_done: defaultStages[i].done,
        },
      });
    }

    return tx.funnel.findUnique({ where: { id: funnel.id }, include: FUNNEL_INCLUDE });
  });
}

export async function updateFunnel(funnelId: number, data: { name?: string; prefix?: string; visibility?: "everyone" | "restricted" }) {
  return prisma.funnel.update({
    where: { id: funnelId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.prefix !== undefined && { prefix: data.prefix }),
      ...(data.visibility !== undefined && { visibility: data.visibility }),
    },
    include: FUNNEL_INCLUDE,
  });
}

export async function getFunnelUsers(funnelId: number) {
  return prisma.funnelUser.findMany({
    where: { funnel_id: funnelId },
    include: SHARED_USER_SELECT,
  });
}

export async function addUserToFunnel(funnelId: number, userId: number) {
  const funnel = await prisma.funnel.findUnique({ where: { id: funnelId }, select: { project_id: true } });
  if (!funnel) throw new Error("Funil não encontrado.");

  const isProjectMember = await prisma.project.findFirst({
    where: {
      id: funnel.project_id,
      OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }],
    },
    select: { id: true },
  });
  if (!isProjectMember) {
    throw new Error("O usuário precisa ser membro do projeto para receber acesso a este funil.");
  }

  const existing = await prisma.funnelUser.findUnique({
    where: { funnel_id_user_id: { funnel_id: funnelId, user_id: userId } },
  });
  if (existing) {
    throw new Error("Usuário já tem acesso a este funil.");
  }

  return prisma.funnelUser.create({
    data: { funnel_id: funnelId, user_id: userId },
    include: SHARED_USER_SELECT,
  });
}

export async function removeUserFromFunnel(funnelId: number, userId: number) {
  const existing = await prisma.funnelUser.findUnique({
    where: { funnel_id_user_id: { funnel_id: funnelId, user_id: userId } },
  });
  if (!existing) {
    throw new Error("Usuário não tem acesso explícito a este funil.");
  }
  return prisma.funnelUser.delete({
    where: { funnel_id_user_id: { funnel_id: funnelId, user_id: userId } },
  });
}

export async function deleteFunnel(funnelId: number) {
  return prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({ where: { funnel_id: funnelId }, select: { id: true } });
    const taskIds = tasks.map((t) => t.id);

    if (taskIds.length > 0) {
      await tx.taskActivity.deleteMany({ where: { task_id: { in: taskIds } } });
      await tx.taskChecklist.deleteMany({ where: { task_id: { in: taskIds } } });
      await tx.taskRecurrence.deleteMany({ where: { task_id: { in: taskIds } } });
      await tx.taskStageHistory.deleteMany({ where: { task_id: { in: taskIds } } });
      await tx.taskUser.deleteMany({ where: { task_id: { in: taskIds } } });
      await tx.task.deleteMany({ where: { id: { in: taskIds } } });
    }

    await tx.funnelStage.deleteMany({ where: { funnel_id: funnelId } });
    await tx.funnel.delete({ where: { id: funnelId } });

    return { success: true };
  });
}

export async function createStage(funnelId: number, name: string, status?: string) {
  const lastStage = await prisma.funnelStage.findFirst({
    where: { funnel_id: funnelId },
    orderBy: { stage_order: "desc" },
  });
  const order = lastStage ? (lastStage.stage_order || 0) + 1 : 1;

  return prisma.funnelStage.create({
    data: {
      funnel_id: funnelId,
      name,
      stage_order: order,
      status: status || "notdone",
      stage_done: status === "done",
    },
  });
}

export async function updateStage(stageId: number, data: { name?: string; status?: string; stage_order?: number }) {
  return prisma.funnelStage.update({
    where: { id: stageId },
    data: {
      name: data.name,
      status: data.status,
      stage_order: data.stage_order,
      stage_done: data.status === "done",
    },
  });
}

export async function deleteStage(stageId: number) {
  return prisma.funnelStage.delete({ where: { id: stageId } });
}
