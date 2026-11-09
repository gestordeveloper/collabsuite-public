import { prisma } from "../lib/prisma";

export interface ActivityAttachment {
  url: string;
  name?: string;
  type?: string;
  size?: number;
}

export async function addActivity(
  taskId: number,
  userId: number,
  content: string | null | undefined,
  attachment?: ActivityAttachment
) {
  const newActivity = await prisma.taskActivity.create({
    data: {
      task_id: taskId,
      user_id: userId,
      content: content || null,
      attachment_url: attachment?.url || null,
      attachment_name: attachment?.name || null,
      attachment_type: attachment?.type || null,
      attachment_size: attachment?.size ?? null,
    },
    include: { user: true },
  });

  const taskWithUpdates = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      user: true,
      checklists: true,
      activities: { include: { user: true }, orderBy: { created_at: "desc" } },
    },
  });

  return { activity: newActivity, task: taskWithUpdates };
}

/** Comentário deixado pelo cliente no link público: sem user_id, marcado is_client. */
export async function addClientComment(taskId: number, content: string, attachment?: ActivityAttachment) {
  return prisma.taskActivity.create({
    data: {
      task_id: taskId,
      user_id: null,
      content: content || null,
      is_client: true,
      attachment_url: attachment?.url || null,
      attachment_name: attachment?.name || null,
      attachment_type: attachment?.type || null,
      attachment_size: attachment?.size ?? null,
    },
    include: { user: true },
  });
}
