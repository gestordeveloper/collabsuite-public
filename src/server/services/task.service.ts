import { prisma } from "../lib/prisma";
import crypto from "crypto";
import { funnelVisibilityFilter } from "./access.service";
import { googleCalendarService } from "./googleCalendar.service";

interface ListTasksOptions {
  funnel_id?: number;
  user_id?: number;
  status?: string;
  is_sprint?: boolean;
  page?: number;
  limit?: number;
}

// Tarefas que o usuário pode ver: as de funis a que tem acesso (membro do projeto + visibilidade
// do funil) e as avulsas (sem funil, ex.: agenda pessoal) criadas por ele ou em que é participante.
function taskVisibilityFilter(viewerId: number) {
  const projectMember = {
    OR: [{ user_id: viewerId }, { projectUsers: { some: { user_id: viewerId } } }],
  };
  return {
    OR: [
      { funnel: { is: { project: projectMember, ...funnelVisibilityFilter(viewerId) } } },
      {
        funnel_id: { in: [0] },
        OR: [{ user_id: viewerId }, { taskUsers: { some: { user_id: viewerId } } }],
      },
      {
        funnel_id: null,
        OR: [{ user_id: viewerId }, { taskUsers: { some: { user_id: viewerId } } }],
      },
    ],
  };
}

export async function canViewTask(taskId: number, viewerId: number): Promise<boolean> {
  const count = await prisma.task.count({
    where: { id: taskId, AND: [taskVisibilityFilter(viewerId)] },
  });
  return count > 0;
}

export async function listTasks(opts: ListTasksOptions = {}, viewerId?: number) {
  const { funnel_id, user_id, status, is_sprint, page = 1, limit = 50 } = opts;
  const where: any = { deleted_at: null, AND: [] };
  if (viewerId) where.AND.push(taskVisibilityFilter(viewerId));
  if (funnel_id) where.funnel_id = funnel_id;
  if (user_id) {
    where.AND.push({
      OR: [
        { user_id },
        { taskUsers: { some: { user_id } } },
      ],
    });
  }
  if (status) where.status = status;
  if (is_sprint !== undefined) where.is_sprint = is_sprint;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        user: true,
        checklists: true,
        attachments: { orderBy: { created_at: "asc" } },
        activities: { include: { user: true }, orderBy: { created_at: "desc" } },
        taskUsers: { include: { user: true } },
        folder: true,
      },
      orderBy: { sort_order: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.task.count({ where }),
  ]);

  return { data: tasks, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// América/São_Paulo usa UTC-3 fixo (sem horário de verão desde 2019). Não usamos o fuso
// horário do processo Node (que varia por servidor/host) para não desalinhar due_at/hour_at
// entre onde a API roda e onde o usuário está.
export const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;

// Interpreta uma data (YYYY-MM-DD, opcionalmente com hora embutida) e/ou uma hora separada
// (HH:MM) como horário local de Brasília, retornando o instante UTC correto.
function parseBrazilDateTime(dateStr: string, hourStr?: string | null): Date {
  const [datePart, timePart] = dateStr.split(/[T ]/);
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, mnt] = (hourStr || timePart || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mnt || 0, 0, 0) + BRAZIL_OFFSET_MS);
}

// Reconstrói um instante armazenado mantendo a data de calendário de Brasília, mas
// aplicando um novo horário (também em horário de Brasília).
// Horário atual (HH:MM) em Brasília.
function brazilClock(instant: Date): string {
  const local = new Date(instant.getTime() - BRAZIL_OFFSET_MS);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

function withBrazilTime(instant: Date, hourStr?: string | null): Date {
  const local = new Date(instant.getTime() - BRAZIL_OFFSET_MS);
  const [h, mnt] = (hourStr || "00:00").split(":").map(Number);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, mnt || 0, 0, 0) + BRAZIL_OFFSET_MS);
}

/** Aprova (ou remove a aprovação de) uma tarefa. `by` é o nome de quem aprovou. */
export async function setTaskApproval(taskId: number, approved: boolean, by: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: approved
      ? { approved_at: new Date(), approved_by: by.slice(0, 150) }
      : { approved_at: null, approved_by: null },
  });
  return getTaskById(taskId);
}

export async function getTaskById(taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      user: true,
      checklists: true,
      attachments: { orderBy: { created_at: "asc" } },
      activities: { include: { user: true }, orderBy: { created_at: "desc" } },
      taskUsers: { include: { user: true } },
      folder: true,
    },
  });
  if (!task) return null;

  const subtasks = await prisma.task.findMany({
    where: { task_id: taskId, deleted_at: null },
    include: {
      user: true,
      checklists: true,
      attachments: { orderBy: { created_at: "asc" } },
      activities: { include: { user: true }, orderBy: { created_at: "desc" } },
      taskUsers: { include: { user: true } },
    },
  });

  const sprintTasks = await prisma.task.findMany({
    where: { sprint_id: taskId, deleted_at: null },
    include: {
      user: true,
      checklists: true,
      attachments: { orderBy: { created_at: "asc" } },
      activities: { include: { user: true }, orderBy: { created_at: "desc" } },
      taskUsers: { include: { user: true } },
    },
  });

  return {
    ...task,
    subtasks,
    sprintTasks,
  };
}

export async function createTask(data: {
  funnel_id?: number;
  stage_id?: number;
  task_id?: number;
  title: string;
  description?: string;
  priority?: string;
  user_id?: number;
  due_at?: string;
  estimated_time?: string;
  story_points?: number;
  type?: string;
  hour_at?: string;
  is_sprint?: boolean | null;
  is_called?: boolean | null;
  is_whatsapp?: boolean | null;
  sprint_id?: number | null;
  call_reason?: string | null;
  platform_company_id?: number | null;
  platform_company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  folder_id?: number | null;
}, creatorUserId?: number) {
  const lastTask = await prisma.task.findFirst({
    where: { stage_id: data.stage_id },
    orderBy: { sort_order: "desc" },
  });
  const order = lastTask ? (lastTask.sort_order || 0) + 1 : 1;

  const isMeeting = data.type === "meeting";

  return prisma.$transaction(async (tx) => {
    let meetUri = isMeeting ? "https://meet.google.com/" + crypto.randomBytes(6).toString("hex") : null;
    let meetId = isMeeting ? `meet-${crypto.randomBytes(4).toString("hex")}` : null;

    if (isMeeting) {
      const organizerUserId = creatorUserId || data.user_id;
      let organizerUser: any = null;
      if (organizerUserId) {
        organizerUser = await tx.user.findUnique({ where: { id: organizerUserId } });
      }

      let refreshToken: string | undefined;
      if (organizerUser?.schedule_settings) {
        try {
          const settings = JSON.parse(organizerUser.schedule_settings);
          if (settings.google_refresh_token) {
            refreshToken = settings.google_refresh_token;
          }
        } catch(e) {}
      }

      if (refreshToken || process.env.GOOGLE_REFRESH_TOKEN) {
        try {
          const startDateTime = data.due_at ? parseBrazilDateTime(data.due_at, data.hour_at) : new Date();
          const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

          const guestEmails: string[] = [];
          if (data.user_id && data.user_id !== organizerUserId) {
            const assignee = await tx.user.findUnique({ where: { id: data.user_id } });
            if (assignee?.email) {
              guestEmails.push(assignee.email);
            }
          }

          const gEvent = await googleCalendarService.createMeetEvent({
            summary: data.title,
            description: data.description || '',
            startDateTime,
            endDateTime,
            guestEmails,
            refreshToken
          });

          if (gEvent) {
            meetUri = gEvent.meetLink || meetUri;
            meetId = gEvent.eventId || meetId;
          }
        } catch(err) {
          console.error("Could not generate Google Meet event on createTask", err);
        }
      }
    }

    const task = await tx.task.create({
      data: {
        funnel_id: data.funnel_id || null,
        stage_id: data.stage_id || null,
        task_id: data.task_id || null,
        title: data.title,
        description: data.description || "",
        priority: (data.priority as any) && data.priority !== "none" ? (data.priority as any) : null,
        // Quem cria é o responsável por padrão (em funil ou avulsa); sem dono, o item some da
        // agenda pessoal, que só mostra o que é do usuário.
        user_id: data.user_id || creatorUserId || null,
        due_at: data.due_at ? parseBrazilDateTime(data.due_at, data.hour_at) : null,
        hour_at: data.hour_at || null,
        estimated_time: data.estimated_time || null,
        story_points: data.story_points || null,
        type: (data.type as any) || "task",
        status: "notdone",
        sort_order: order,
        meet_id: meetId,
        meet_uri: meetUri,
        is_sprint: data.is_sprint ?? null,
        is_called: data.is_called ?? null,
        is_whatsapp: data.is_whatsapp ?? null,
        sprint_id: data.sprint_id ?? null,
        call_reason: data.call_reason ?? null,
        platform_company_id: data.platform_company_id ?? null,
        platform_company_name: data.platform_company_name ?? null,
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        folder_id: data.folder_id ?? null,
      },
      include: {
        user: true,
        checklists: true,
        activities: true,
        taskUsers: { include: { user: true } },
        folder: true,
      },
    });

    if (data.funnel_id && data.stage_id) {
      await tx.taskStageHistory.create({
        data: {
          task_id: task.id,
          funnel_id: data.funnel_id,
          stage_id: data.stage_id,
        },
      });
    }

    return task;
  });
}

/** Mover/editar uma tarefa de postagem do Instagram no calendário reagenda a publicação. */
export async function updateTask(taskId: number, data: Parameters<typeof updateTaskCore>[1], creatorUserId: number) {
  const result = await updateTaskCore(taskId, data, creatorUserId);
  if (result?.template === "instagram_post") {
    const { onTaskChanged } = await import("./instagram/post.service");
    await onTaskChanged(result).catch((err) => console.error("[instagram] sync da agenda:", err));
  } else if (result?.template === "social_post") {
    const { onTaskChanged } = await import("./social/post.service");
    await onTaskChanged(result).catch((err) => console.error("[social] sync da agenda:", err));
  }
  return result;
}

async function updateTaskCore(taskId: number, data: {
  funnel_id?: number | null;
  stage_id?: number | null;
  task_id?: number | null;
  title?: string;
  description?: string;
  content?: string;
  priority?: string;
  user_id?: number | null;
  due_at?: string | null;
  status?: string;
  sort_order?: number;
  estimated_time?: string;
  story_points?: number | null;
  type?: string;
  hour_at?: string;
  end_at?: string | null;
  meet_uri?: string;
  cover?: string | null;
  icon?: string | null;
  is_sprint?: boolean | null;
  is_called?: boolean | null;
  is_whatsapp?: boolean | null;
  sprint_id?: number | null;
  call_reason?: string | null;
  platform_company_id?: number | null;
  platform_company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  template?: string | null;
  form_schema?: string | null;
  folder_id?: number | null;
  proposal_template_id?: number | null;
  proposal_data?: string | null;
}, creatorUserId: number) {
  return prisma.$transaction(async (tx) => {
    const oldTask = await tx.task.findUnique({ where: { id: taskId } });
    if (!oldTask) {
      throw new Error("Tarefa não encontrada");
    }

    let newStatus = data.status;
    let stageObj = null;
    if (data.stage_id !== undefined && data.stage_id !== null) {
      stageObj = await tx.funnelStage.findUnique({ where: { id: data.stage_id } });
      if (stageObj?.status && !newStatus) {
        newStatus = stageObj.status;
      }
    }

    // Ao iniciar a tarefa, quem iniciou vira o responsável (se ainda não há um) e o horário
    // real de início é gravado, para a agenda e os indicadores refletirem quem fez e quando.
    const isStarting = newStatus === "inprogress" && oldTask.status !== "inprogress";
    const autoAssignee = isStarting && !oldTask.user_id && data.user_id === undefined ? creatorUserId : undefined;
    const startHour = isStarting && data.hour_at === undefined ? brazilClock(new Date()) : undefined;

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        funnel_id: data.funnel_id,
        stage_id: data.stage_id,
        task_id: data.task_id,
        title: data.title,
        description: data.description,
        content: data.content,
        priority: data.priority !== undefined ? (data.priority === "none" ? null : (data.priority as any)) : undefined,
        user_id: data.user_id ?? autoAssignee,
        due_at: newStatus === "inprogress" && oldTask.status !== "inprogress" ? new Date() : (data.due_at !== undefined ? (data.due_at ? parseBrazilDateTime(data.due_at, data.hour_at) : null) : undefined),
        end_at: newStatus === "done" && oldTask.status !== "done" ? new Date() : (data.end_at !== undefined ? (data.end_at ? parseBrazilDateTime(data.end_at) : null) : undefined),
        hour_at: data.hour_at ?? startHour,
        estimated_time: data.estimated_time,
        story_points: data.story_points,
        type: data.type as any,
        status: newStatus as any,
        meet_uri: data.meet_uri,
        sort_order: data.sort_order,
        cover: data.cover,
        icon: data.icon,
        is_sprint: data.is_sprint,
        is_called: data.is_called,
        is_whatsapp: data.is_whatsapp,
        sprint_id: data.sprint_id,
        call_reason: data.call_reason,
        platform_company_id: data.platform_company_id,
        platform_company_name: data.platform_company_name,
        first_name: data.first_name,
        last_name: data.last_name,
        template: data.template,
        form_schema: data.form_schema,
  folder_id: data.folder_id,
  proposal_template_id: data.proposal_template_id,
  proposal_data: data.proposal_data,
  started_at: newStatus === "inprogress" && oldTask.status !== "inprogress" ? new Date() : undefined,
  closed_at: newStatus === "done" && oldTask.status !== "done" ? new Date() : undefined,
      },
      include: { user: true, checklists: true, attachments: { orderBy: { created_at: "asc" } }, activities: { include: { user: true } }, taskUsers: { include: { user: true } }, folder: true },
    });

    if (autoAssignee) {
      await tx.taskUser.upsert({
        where: { task_id_user_id: { task_id: taskId, user_id: autoAssignee } },
        create: { task_id: taskId, user_id: autoAssignee },
        update: {},
      });
    }

    if (data.stage_id !== undefined && data.stage_id !== null && oldTask.stage_id !== data.stage_id) {
      if (!stageObj) {
        stageObj = await tx.funnelStage.findUnique({ where: { id: data.stage_id } });
      }
      await tx.taskStageHistory.create({
        data: {
          task_id: taskId,
          funnel_id: stageObj?.funnel_id || updated.funnel_id || 0,
          stage_id: data.stage_id,
          user_id: creatorUserId,
        },
      });

      await tx.taskActivity.create({
        data: {
          task_id: taskId,
          user_id: creatorUserId,
          content: `Moveu esta tarefa para a etapa: "${stageObj?.name || "Nova Etapa"}"`,
        },
      });

      return tx.task.findUnique({
        where: { id: taskId },
        include: { user: true, checklists: true, activities: { include: { user: true }, orderBy: { created_at: "desc" } }, taskUsers: { include: { user: true } } },
      });
    }

    return updated;
  });
}

export async function softDeleteTask(taskId: number) {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: { deleted_at: new Date() },
  });
  if (task.template === "instagram_post") {
    const { onTaskDeleted } = await import("./instagram/post.service");
    await onTaskDeleted(taskId).catch((err) => console.error("[instagram] sync da agenda:", err));
  } else if (task.template === "social_post") {
    const { onTaskDeleted } = await import("./social/post.service");
    await onTaskDeleted(taskId).catch((err) => console.error("[social] sync da agenda:", err));
  }
  return task;
}

export async function createPublicMeeting(username: string, data: {
  title: string;
  description?: string;
  email: string;
  phone?: string;
  first_name: string;
  last_name?: string;
  due_at: string;
  hour_at: string;
}) {
  const targetUser = await prisma.user.findUnique({ where: { username } });
  if (!targetUser) {
    throw { status: 404, message: "Usuário de destino não encontrado." };
  }

  let meetUri = `https://meet.google.com/${crypto.randomBytes(3).toString("hex")}-${crypto.randomBytes(4).toString("hex")}-${crypto.randomBytes(3).toString("hex")}`;
  let meetId = `public-meet-${crypto.randomBytes(4).toString("hex")}`;

  try {
    const startDateTime = parseBrazilDateTime(data.due_at, data.hour_at);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // +1h default

    let refreshToken: string | undefined;
    if (targetUser.schedule_settings) {
      try {
        const settings = JSON.parse(targetUser.schedule_settings);
        if (settings.google_refresh_token) {
          refreshToken = settings.google_refresh_token;
        }
      } catch(e) {}
    }

    const gEvent = await googleCalendarService.createMeetEvent({
      summary: data.title,
      description: data.description || '',
      startDateTime,
      endDateTime,
      guestEmails: [data.email],
      refreshToken
    });

    if (gEvent) {
      meetUri = gEvent.meetLink || meetUri;
      meetId = gEvent.eventId || meetId;
    }
  } catch(e) {
    console.error("Could not generate google meet event", e);
  }

  return prisma.task.create({
    data: {
      title: data.title,
      description: data.description || "Reunião agendada via link público de agendamento.",
      type: "meeting",
      status: "notdone",
      priority: "medium",
      user_id: targetUser.id,
      funnel_id: null,
      stage_id: null,
      due_at: parseBrazilDateTime(data.due_at, data.hour_at),
      hour_at: data.hour_at,
      first_name: data.first_name,
      last_name: data.last_name || "",
      email: data.email,
      phone: data.phone || "",
      meet_id: meetId,
      meet_uri: meetUri,
    },
    include: { user: true, checklists: true, attachments: true, activities: true },
  });
}

export async function addTaskMember(taskId: number, userId: number) {
  const existing = await prisma.taskUser.findUnique({
    where: { task_id_user_id: { task_id: taskId, user_id: userId } },
  });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { level: true },
  });
  if (!user || user.level < 8) {
    throw new Error("Apenas usuários com nível 8 ou superior podem ser adicionados como membros");
  }

  return prisma.taskUser.create({
    data: { task_id: taskId, user_id: userId },
    include: { user: true },
  });
}

export async function removeTaskMember(taskId: number, userId: number) {
  return prisma.taskUser.delete({
    where: { task_id_user_id: { task_id: taskId, user_id: userId } },
  });
}

export async function getPublicCalendar(username: string) {
  const targetUser = await prisma.user.findUnique({ where: { username } });
  if (!targetUser) {
    throw { status: 404, message: "Usuário não encontrado." };
  }

  const meetings = await prisma.task.findMany({
    where: { user_id: targetUser.id, type: "meeting", deleted_at: null },
    select: { id: true, title: true, description: true, due_at: true, hour_at: true, estimated_time: true },
  });

  return {
    user: {
      id: targetUser.id,
      first_name: targetUser.first_name,
      last_name: targetUser.last_name,
      photo: targetUser.photo,
      biography: targetUser.biography,
      schedule_settings: targetUser.schedule_settings,
    },
    meetings,
  };
}

export async function generateMeetLink(taskId: number, currentUserId?: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      user: true,
      taskUsers: { include: { user: true } }
    }
  });
  if (!task) throw new Error("Task not found");
  
  // if (task.meet_uri && task.meet_uri.includes("meet.google.com")) {
  //   return task;
  // }
  
  let meetUri = `https://meet.google.com/${crypto.randomBytes(3).toString("hex")}-${crypto.randomBytes(4).toString("hex")}-${crypto.randomBytes(3).toString("hex")}`;
  let meetId = `meet-${crypto.randomBytes(4).toString("hex")}`;

  try {
    const startDateTime = task.due_at ? withBrazilTime(task.due_at, task.hour_at) : new Date();
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    const guestEmails: string[] = [];
    if (task.email) guestEmails.push(task.email);
    for (const tu of task.taskUsers) {
      if (tu.user?.email && !guestEmails.includes(tu.user.email)) {
        guestEmails.push(tu.user.email);
      }
    }

    const organizerUserId = currentUserId || task.user_id;
    let organizerUser: any = null;
    if (organizerUserId) {
      organizerUser = await prisma.user.findUnique({ where: { id: organizerUserId } });
    }

    let refreshToken: string | undefined;
    if (organizerUser?.schedule_settings) {
      try {
        const settings = JSON.parse(organizerUser.schedule_settings);
        if (settings.google_refresh_token) {
          refreshToken = settings.google_refresh_token;
        }
      } catch(e) {}
    }

    if (refreshToken || process.env.GOOGLE_REFRESH_TOKEN) {
      const gEvent = await googleCalendarService.createMeetEvent({
        summary: task.title || "Reunião",
        description: task.description || "",
        startDateTime,
        endDateTime,
        guestEmails,
        refreshToken
      });
      if (gEvent) {
        meetUri = gEvent.meetLink || meetUri;
        meetId = gEvent.eventId || meetId;
      }
    }
  } catch(e) {
    console.error("Could not generate meet link", e);
  }

  return prisma.task.update({
    where: { id: taskId },
    data: {
      meet_uri: meetUri,
      meet_id: meetId,
      type: "meeting"
    },
    include: { user: true, checklists: true, attachments: { orderBy: { created_at: "asc" } }, activities: { include: { user: true }, orderBy: { created_at: "desc" } }, taskUsers: { include: { user: true } } }
  });
}

export async function submitFormResponse(taskId: number, answers: any) {
  return prisma.formResponse.create({
    data: {
      task_id: taskId,
      answers: JSON.stringify(answers),
    },
  });
}

export async function getFormResponses(taskId: number) {
  return prisma.formResponse.findMany({
    where: { task_id: taskId },
    orderBy: { created_at: "desc" },
  });
}