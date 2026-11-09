import { prisma } from "../lib/prisma";

export class NotFoundError extends Error {
  statusCode = 404;
}

const FUNNEL_VISIBILITY_OR = (userId: number) => [
  { visibility: "everyone" as const },
  { project: { user_id: userId } },
  { sharedUsers: { some: { user_id: userId } } },
];

export async function assertProjectMember(projectId: number, userId: number): Promise<void> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }],
    },
    select: { id: true },
  });
  if (!project) throw new NotFoundError("Projeto não encontrado ou sem permissão de acesso.");
}

export async function assertFunnelAccess(funnelId: number, userId: number): Promise<{ project_id: number }> {
  const funnel = await prisma.funnel.findFirst({
    where: {
      id: funnelId,
      project: {
        OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }],
      },
      OR: FUNNEL_VISIBILITY_OR(userId),
    },
    select: { project_id: true },
  });
  if (!funnel) throw new NotFoundError("Funil não encontrado ou sem permissão de acesso.");
  return funnel;
}

export async function assertStageAccess(stageId: number, userId: number): Promise<{ funnel_id: number; project_id: number }> {
  const stage = await prisma.funnelStage.findUnique({ where: { id: stageId }, select: { funnel_id: true } });
  if (!stage || !stage.funnel_id) throw new NotFoundError("Etapa não encontrada.");
  const { project_id } = await assertFunnelAccess(stage.funnel_id, userId);
  return { funnel_id: stage.funnel_id, project_id };
}

export function funnelVisibilityFilter(userId: number) {
  return { OR: FUNNEL_VISIBILITY_OR(userId) };
}

export async function getFunnelViewerIds(funnelId: number): Promise<number[]> {
  const funnel = await prisma.funnel.findUnique({
    where: { id: funnelId },
    select: {
      visibility: true,
      project: {
        select: {
          user_id: true,
          projectUsers: { select: { user_id: true } },
        },
      },
      sharedUsers: { select: { user_id: true } },
    },
  });
  if (!funnel) return [];

  const memberIds = new Set<number>();
  if (funnel.project.user_id) memberIds.add(funnel.project.user_id);
  for (const pu of funnel.project.projectUsers) {
    if (pu.user_id) memberIds.add(pu.user_id);
  }

  if (funnel.visibility === "everyone") {
    return Array.from(memberIds);
  }

  const allowed = new Set<number>();
  if (funnel.project.user_id) allowed.add(funnel.project.user_id);
  for (const su of funnel.sharedUsers) {
    if (su.user_id && memberIds.has(su.user_id)) allowed.add(su.user_id);
  }
  return Array.from(allowed);
}
