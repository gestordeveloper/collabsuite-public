import { prisma } from "../lib/prisma";
import crypto from "crypto";
import { hashPassword } from "../lib/bcrypt";
import { signToken } from "../lib/jwt";
import { notifyUsers } from "./notification.service";

interface InitializeWidgetOptions {
  funnel_id: number;
  user_id: string; // External user ID from host platform
  first_name: string;
  last_name?: string;
  email: string;
  telephone?: string;
}

export async function initializeWidgetUser(opts: InitializeWidgetOptions) {
  const { funnel_id, user_id, first_name, last_name = "", email, telephone = "" } = opts;

  // 1. Fetch the Funnel (pipeline) to verify it exists and resolve its parent Project
  const funnel = await prisma.funnel.findUnique({
    where: { id: funnel_id },
    include: { project: true },
  });

  if (!funnel) {
    throw { status: 404, message: "Funil não encontrado." };
  }

  const companyId = funnel.project.company_id || -1;
  const projectId = funnel.project_id;
  const externalUserId = user_id && user_id !== "undefined" && user_id !== "null" ? user_id : null;

  // 2. Find the user in our system.
  // The host platform's `user_id` is only unique *within that platform*: a different
  // project/platform could reuse the same numeric id for a different person, so it is
  // matched scoped to this project (via ProjectUser.external_user_id) before ever
  // falling back to the globally-unique email.
  let user = null as Awaited<ReturnType<typeof prisma.user.findUnique>>;

  if (externalUserId) {
    const existingLink = await prisma.projectUser.findUnique({
      where: {
        project_id_external_user_id: {
          project_id: projectId,
          external_user_id: externalUserId,
        },
      },
      include: { user: true },
    });
    user = existingLink?.user ?? null;
  }

  if (!user) {
    user = await prisma.user.findUnique({
      where: { email },
    });
  }

  if (!user) {
    // Generate a unique username
    const emailPrefix = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
    const randomSuffix = crypto.randomBytes(3).toString("hex");
    const username = `${emailPrefix}_${randomSuffix}`.substring(0, 50);

    // Hash a random dummy password
    const dummyPassword = crypto.randomBytes(16).toString("hex");
    const hashedPassword = await hashPassword(dummyPassword);

    user = await prisma.user.create({
      data: {
        email,
        first_name,
        last_name,
        telephone,
        username,
        password: hashedPassword,
        status: "active",
        company_id: companyId,
        level: 1,
      },
    });
  } else {
    // Update existing user details if they have changed
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        first_name: first_name || user.first_name,
        last_name: last_name !== undefined ? last_name : user.last_name,
        telephone: telephone !== undefined ? telephone : user.telephone,
        company_id: user.company_id === -1 || !user.company_id ? companyId : user.company_id,
      },
    });
  }

  // 3. Associate the user with the parent project (ProjectUser relation), recording the
  // host platform's external id so future /initialize calls for this project can match
  // on it directly instead of relying on email alone.
  await prisma.projectUser.upsert({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: user.id,
      },
    },
    create: {
      project_id: projectId,
      user_id: user.id,
      company_id: companyId,
      external_user_id: externalUserId,
    },
    update: externalUserId ? { external_user_id: externalUserId } : {},
  });

  // 4. Generate widget JWT token
  const token = signToken({
    userId: user.id,
    email: user.email,
    // Inject custom fields for widget auth validation
    ...({
      funnelId: funnel.id,
      isWidgetUser: true,
    } as any),
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      telephone: user.telephone,
    },
    funnel: {
      id: funnel.id,
      name: funnel.name,
      color: funnel.project.color,
    },
  };
}

export async function listWidgetTickets(userId: number, email: string, funnelId: number) {
  return prisma.task.findMany({
    where: {
      funnel_id: funnelId,
      email: email,
      is_called: true,
      deleted_at: null,
    },
    include: {
      stage: {
        select: {
          id: true,
          name: true,
          stage_done: true,
        },
      },
      activities: {
        orderBy: {
          created_at: "desc",
        },
        take: 1, // Only get the latest comment for preview
        include: {
          user: {
            select: {
              first_name: true,
              last_name: true,
              photo: true,
            },
          },
        },
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });
}

export async function createWidgetTicket(
  userId: number,
  email: string,
  funnelId: number,
  data: { title: string; description: string; call_reason: string }
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw { status: 404, message: "Usuário não encontrado." };
  }

  // Tickets always land in the "Backlog" stage, regardless of column order.
  // Falls back to the first stage by order if the funnel has no stage named "Backlog".
  const stages = await prisma.funnelStage.findMany({
    where: { funnel_id: funnelId },
    orderBy: { stage_order: "asc" },
  });
  const backlogStage = stages.find((s) => (s.name || "").trim().toLowerCase() === "backlog");
  const targetStage = backlogStage || stages[0];

  const stageId = targetStage ? targetStage.id : 0;

  // Find the last task order in this stage
  const lastTask = await prisma.task.findFirst({
    where: { stage_id: stageId },
    orderBy: { sort_order: "desc" },
  });
  const order = lastTask ? (lastTask.sort_order || 0) + 1 : 1;

  const ticket = await prisma.task.create({
    data: {
      funnel_id: funnelId,
      stage_id: stageId || null,
      title: data.title,
      description: data.description,
      first_name: user.first_name,
      last_name: user.last_name || "",
      email: user.email,
      phone: user.telephone || "",
      is_called: true,
      call_reason: data.call_reason,
      status: "notdone",
      priority: "medium",
      type: "task",
      sort_order: order,
      company_id: user.company_id,
    },
    include: {
      stage: {
        select: {
          id: true,
          name: true,
          stage_done: true,
        },
      },
      user: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          photo: true,
        },
      },
      activities: true,
    },
  });

  // Track stage history
  if (funnelId && stageId) {
    await prisma.taskStageHistory.create({
      data: {
        task_id: ticket.id,
        funnel_id: funnelId,
        stage_id: stageId,
      },
    });
  }

  // Best-effort: a notification failure must never fail the ticket creation itself — the
  // ticket row is already committed at this point.
  try {
    await notifyInternalMembersOfNewTicket(funnelId, ticket);
  } catch (err) {
    console.error("[widget] Falha ao notificar membros do projeto sobre novo chamado:", err);
  }

  return ticket;
}

// Notifies every internal team member of the project (never the widget client themselves,
// who is always linked via ProjectUser.external_user_id — see initializeWidgetUser above).
async function notifyInternalMembersOfNewTicket(funnelId: number, ticket: { id: number; title: string | null }) {
  const funnel = await prisma.funnel.findUnique({ where: { id: funnelId }, select: { project_id: true } });
  if (!funnel) return;

  const members = await prisma.projectUser.findMany({
    where: { project_id: funnel.project_id, external_user_id: null },
    select: { user_id: true },
  });
  const recipientIds = members.map((m) => m.user_id).filter((id): id is number => typeof id === "number");
  if (recipientIds.length === 0) return;

  await notifyUsers(recipientIds, {
    type: "ticket_created",
    title: "Novo chamado recebido",
    body: ticket.title || "Um novo chamado foi aberto.",
    link: `/task/${ticket.id}`,
    metadata: { taskId: ticket.id },
  });
}

export async function listTicketActivities(ticketId: number, email: string, funnelId: number) {
  // First, verify the ticket belongs to this user and is part of the funnel
  const ticket = await prisma.task.findFirst({
    where: {
      id: ticketId,
      funnel_id: funnelId,
      email: email,
      is_called: true,
      deleted_at: null,
    },
  });

  if (!ticket) {
    throw { status: 404, message: "Chamado não encontrado." };
  }

  return prisma.taskActivity.findMany({
    where: {
      task_id: ticketId,
    },
    include: {
      user: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          photo: true,
        },
      },
    },
    orderBy: {
      created_at: "asc",
    },
  });
}

export async function createTicketActivity(
  ticketId: number,
  userId: number,
  email: string,
  funnelId: number,
  content: string | null | undefined,
  attachment?: { url: string; name?: string; type?: string; size?: number }
) {
  // First, verify the ticket belongs to this user and is part of the funnel
  const ticket = await prisma.task.findFirst({
    where: {
      id: ticketId,
      funnel_id: funnelId,
      email: email,
      is_called: true,
      deleted_at: null,
    },
  });

  if (!ticket) {
    throw { status: 404, message: "Chamado não encontrado ou acesso negado." };
  }

  const activity = await prisma.taskActivity.create({
    data: {
      task_id: ticketId,
      user_id: userId,
      content: content || null,
      attachment_url: attachment?.url || null,
      attachment_name: attachment?.name || null,
      attachment_type: attachment?.type || null,
      attachment_size: attachment?.size ?? null,
      company_id: ticket.company_id,
    },
    include: {
      user: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          photo: true,
        },
      },
    },
  });

  // Touch the task to update its updated_at timestamp
  await prisma.task.update({
    where: { id: ticketId },
    data: { updated_at: new Date() },
  });

  return activity;
}
