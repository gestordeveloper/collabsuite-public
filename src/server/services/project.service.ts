import { prisma } from "../lib/prisma";
import { googleDriveService } from "./googleDrive.service";
import { funnelVisibilityFilter } from "./access.service";

function extractRefreshToken(scheduleSettingsJson?: string | null): string | undefined {
  if (!scheduleSettingsJson) return undefined;
  try {
    const settings = JSON.parse(scheduleSettingsJson);
    return settings.google_refresh_token || undefined;
  } catch {
    return undefined;
  }
}

const projectInclude = (userId: number) => ({
  funnels: {
    where: funnelVisibilityFilter(userId),
    include: { stages: { orderBy: { stage_order: "asc" as const } } },
  },
  projectUsers: {
    where: { user: { level: { gte: 8 } } },
    include: {
      user: {
        select: { id: true, first_name: true, last_name: true, username: true, photo: true, email: true },
      },
    },
  },
});

export async function listProjectsByUser(userId: number) {
  return prisma.project.findMany({
    where: {
      OR: [
        { user_id: userId },
        { projectUsers: { some: { user_id: userId } } },
      ],
    },
    include: projectInclude(userId),
  });
}

export async function createProject(userId: number, data: { name: string; content?: string; color?: string }) {
  const project = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: data.name,
        content: data.content || "",
        color: data.color || "#4f46e5",
        user_id: userId,
        is_default_project: false,
      },
    });

    await tx.projectUser.create({
      data: {
        project_id: project.id,
        user_id: userId,
      },
    });

    const funnel = await tx.funnel.create({
      data: {
        project_id: project.id,
        name: "Funil Principal",
        is_default: true,
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

    return project;
  });

  const creator = await prisma.user.findUnique({ where: { id: userId }, select: { schedule_settings: true } });
  const refreshToken = extractRefreshToken(creator?.schedule_settings);
  if (refreshToken) {
    try {
      const folder = await googleDriveService.createProjectFolder(refreshToken, { funnelId: project.id, funnelName: project.name || `Projeto ${project.id}` });
      await prisma.project.update({
        where: { id: project.id },
        data: { drive_folder_id: folder.id, drive_folder_link: folder.webViewLink, drive_owner_user_id: userId },
      });
    } catch (err) {
      console.error(`[Drive] Falha ao criar pasta para o projeto ${project.id}:`, (err as any)?.message || err);
    }
  }

  return prisma.project.findUnique({
    where: { id: project.id },
    include: projectInclude(userId),
  });
}

export async function updateProject(projectId: number, userId: number, data: { name?: string; content?: string; color?: string; favorite?: boolean | null; is_default_project?: boolean | null }) {
  if (data.is_default_project === true) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { user_id: true } });
    if (project && project.user_id) {
      await prisma.project.updateMany({
        where: { user_id: project.user_id, id: { not: projectId } },
        data: { is_default_project: false },
      });
    }
  }

  return prisma.project.update({
    where: { id: projectId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.content !== undefined && { content: data.content }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.favorite !== undefined && { favorite: data.favorite }),
      ...(data.is_default_project !== undefined && { is_default_project: data.is_default_project }),
    },
    include: projectInclude(userId),
  });
}

export async function deleteProject(projectId: number) {
  return prisma.$transaction(async (tx) => {
    const funnels = await tx.funnel.findMany({ where: { project_id: projectId }, select: { id: true } });
    const funnelIds = funnels.map((f) => f.id);

    if (funnelIds.length > 0) {
      const tasks = await tx.task.findMany({ where: { funnel_id: { in: funnelIds } }, select: { id: true } });
      const taskIds = tasks.map((t) => t.id);

      if (taskIds.length > 0) {
        await tx.taskActivity.deleteMany({ where: { task_id: { in: taskIds } } });
        await tx.taskChecklist.deleteMany({ where: { task_id: { in: taskIds } } });
        await tx.taskRecurrence.deleteMany({ where: { task_id: { in: taskIds } } });
        await tx.taskStageHistory.deleteMany({ where: { task_id: { in: taskIds } } });
        await tx.taskUser.deleteMany({ where: { task_id: { in: taskIds } } });
        await tx.task.deleteMany({ where: { id: { in: taskIds } } });
      }

      await tx.funnelStage.deleteMany({ where: { funnel_id: { in: funnelIds } } });
      await tx.funnel.deleteMany({ where: { id: { in: funnelIds } } });
    }

    await tx.credential.deleteMany({ where: { project_id: projectId } });
    await tx.projectUser.deleteMany({ where: { project_id: projectId } });
    await tx.project.delete({ where: { id: projectId } });

    return { success: true };
  });
}

export async function getProjectUsers(projectId: number) {
  return prisma.projectUser.findMany({
    where: {
      project_id: projectId,
      user: {
        level: {
          gte: 8,
        },
      },
    },
    include: {
      user: {
        select: { id: true, first_name: true, last_name: true, username: true, photo: true, email: true },
      },
    },
  });
}

export async function addUserToProject(projectId: number, userId: number) {
  const existing = await prisma.projectUser.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: userId } },
  });
  if (existing) {
    throw new Error("Usuário já é membro deste projeto");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { level: true },
  });
  if (!user || user.level < 8) {
    throw new Error("Apenas usuários com nível 8 ou superior podem ser adicionados como membros");
  }

  const projectUser = await prisma.projectUser.create({
    data: { project_id: projectId, user_id: userId },
    include: {
      user: {
        select: { id: true, first_name: true, last_name: true, username: true, photo: true, email: true },
      },
    },
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { drive_folder_id: true, drive_owner_user_id: true },
  });
  if (project?.drive_folder_id && project.drive_owner_user_id && projectUser.user.email) {
    try {
      const owner = await prisma.user.findUnique({ where: { id: project.drive_owner_user_id }, select: { schedule_settings: true } });
      const ownerToken = extractRefreshToken(owner?.schedule_settings);
      if (ownerToken) {
        await googleDriveService.shareFolder(ownerToken, project.drive_folder_id, [projectUser.user.email]);
      }
    } catch (err) {
      console.error(`[Drive] Falha ao compartilhar pasta do projeto ${projectId} com novo membro:`, (err as any)?.message || err);
    }
  }

  return projectUser;
}

export async function removeUserFromProject(projectId: number, userId: number) {
  const existing = await prisma.projectUser.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    include: { user: { select: { email: true } } },
  });
  if (!existing) {
    throw new Error("Usuário não é membro deste projeto");
  }

  const result = await prisma.projectUser.delete({
    where: { project_id_user_id: { project_id: projectId, user_id: userId } },
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { drive_folder_id: true, drive_owner_user_id: true },
  });

  if (project?.drive_folder_id) {
    if (project.drive_owner_user_id === userId) {
      // O dono da pasta saiu do projeto: a pasta física continua existindo e compartilhada,
      // mas deixamos de rastreá-la aqui em vez de seguir usando o token de quem não é mais membro.
      await prisma.project.update({
        where: { id: projectId },
        data: { drive_folder_id: null, drive_folder_link: null, drive_owner_user_id: null },
      });
    } else if (project.drive_owner_user_id && existing.user.email) {
      try {
        const owner = await prisma.user.findUnique({ where: { id: project.drive_owner_user_id }, select: { schedule_settings: true } });
        const ownerToken = extractRefreshToken(owner?.schedule_settings);
        if (ownerToken) {
          await googleDriveService.revokeAccess(ownerToken, project.drive_folder_id, existing.user.email);
        }
      } catch (err) {
        console.error(`[Drive] Falha ao revogar acesso à pasta do projeto ${projectId}:`, (err as any)?.message || err);
      }
    }
  }

  return result;
}

async function resolveProjectOwnerToken(projectId: number) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { drive_folder_id: true, drive_owner_user_id: true },
  });
  if (!project?.drive_folder_id || !project.drive_owner_user_id) {
    throw new Error("Este projeto ainda não tem uma pasta no Google Drive.");
  }
  const owner = await prisma.user.findUnique({ where: { id: project.drive_owner_user_id }, select: { schedule_settings: true } });
  const refreshToken = extractRefreshToken(owner?.schedule_settings);
  if (!refreshToken) {
    throw new Error("O responsável por esta pasta perdeu a conexão com o Google. Peça para reconectar em Configurações.");
  }
  return { folderId: project.drive_folder_id, refreshToken };
}

export async function getProjectDriveStatus(projectId: number, currentUserId: number) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { drive_folder_id: true, drive_folder_link: true, drive_owner_user_id: true },
  });
  if (!project) throw new Error("Projeto não encontrado");

  const [owner, currentUser] = await Promise.all([
    project.drive_owner_user_id
      ? prisma.user.findUnique({ where: { id: project.drive_owner_user_id }, select: { schedule_settings: true } })
      : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: currentUserId }, select: { schedule_settings: true } }),
  ]);

  const ownerConnected = !!extractRefreshToken(owner?.schedule_settings);
  const currentUserConnected = !!extractRefreshToken(currentUser?.schedule_settings);

  return {
    folderId: project.drive_folder_id,
    folderLink: project.drive_folder_link,
    ownerUserId: project.drive_owner_user_id,
    ownerConnected,
    currentUserConnected,
    canConnect: !project.drive_folder_id && currentUserConnected,
  };
}

export async function connectProjectDrive(projectId: number, currentUserId: number) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, drive_folder_id: true },
  });
  if (!project) throw new Error("Projeto não encontrado");
  if (project.drive_folder_id) throw new Error("Este projeto já está conectado ao Google Drive");

  const currentUser = await prisma.user.findUnique({ where: { id: currentUserId }, select: { schedule_settings: true } });
  const refreshToken = extractRefreshToken(currentUser?.schedule_settings);
  if (!refreshToken) throw new Error("Conecte sua conta do Google em Configurações antes de continuar.");

  const folder = await googleDriveService.createProjectFolder(refreshToken, { funnelId: project.id, funnelName: project.name || `Projeto ${project.id}` });
  await prisma.project.update({
    where: { id: projectId },
    data: { drive_folder_id: folder.id, drive_folder_link: folder.webViewLink, drive_owner_user_id: currentUserId },
  });

  const members = await prisma.projectUser.findMany({
    where: { project_id: projectId, user_id: { not: currentUserId } },
    include: { user: { select: { email: true } } },
  });
  const emails = members.map((m) => m.user.email).filter((e): e is string => !!e);
  if (emails.length > 0) {
    try {
      await googleDriveService.shareFolder(refreshToken, folder.id, emails);
    } catch (err) {
      console.error(`[Drive] Falha ao compartilhar pasta recém-criada do projeto ${projectId}:`, (err as any)?.message || err);
    }
  }

  return getProjectDriveStatus(projectId, currentUserId);
}

async function resolveTargetFolder(refreshToken: string, rootFolderId: string, requestedFolderId?: string): Promise<string> {
  if (!requestedFolderId || requestedFolderId === rootFolderId) return rootFolderId;
  const ok = await googleDriveService.isWithinRoot(refreshToken, requestedFolderId, rootFolderId);
  if (!ok) throw new Error("Pasta inválida para este projeto.");
  return requestedFolderId;
}

export async function listProjectDriveFiles(projectId: number, folderId?: string) {
  const { folderId: rootFolderId, refreshToken } = await resolveProjectOwnerToken(projectId);
  const target = await resolveTargetFolder(refreshToken, rootFolderId, folderId);
  return googleDriveService.listFiles(refreshToken, target);
}

export async function createProjectDriveFolder(projectId: number, payload: { name: string; parentFolderId?: string }) {
  const { folderId: rootFolderId, refreshToken } = await resolveProjectOwnerToken(projectId);
  const parent = await resolveTargetFolder(refreshToken, rootFolderId, payload.parentFolderId);
  return googleDriveService.createFolder(refreshToken, parent, payload.name);
}

export async function uploadProjectDriveFile(projectId: number, payload: { filename: string; mimeType: string; dataUrl: string; folderId?: string }) {
  const { folderId: rootFolderId, refreshToken } = await resolveProjectOwnerToken(projectId);
  const target = await resolveTargetFolder(refreshToken, rootFolderId, payload.folderId);
  const base64Idx = payload.dataUrl.indexOf(";base64,");
  if (base64Idx === -1) throw new Error("Formato de arquivo inválido");
  const buffer = Buffer.from(payload.dataUrl.slice(base64Idx + 8), "base64");
  return googleDriveService.uploadFile(refreshToken, target, { filename: payload.filename, mimeType: payload.mimeType, buffer });
}

export async function openProjectDriveFile(projectId: number, fileId: string, range?: string) {
  const { folderId: rootFolderId, refreshToken } = await resolveProjectOwnerToken(projectId);
  const ok = await googleDriveService.isWithinRoot(refreshToken, fileId, rootFolderId);
  if (!ok) throw new Error("Arquivo inválido para este projeto.");
  return googleDriveService.openFileStream(refreshToken, fileId, range);
}

export async function deleteProjectDriveFile(projectId: number, fileId: string) {
  const { folderId: rootFolderId, refreshToken } = await resolveProjectOwnerToken(projectId);
  const ok = await googleDriveService.isWithinRoot(refreshToken, fileId, rootFolderId);
  if (!ok) throw new Error("Arquivo inválido para este projeto.");
  await googleDriveService.deleteFile(refreshToken, fileId);
  return { success: true };
}
