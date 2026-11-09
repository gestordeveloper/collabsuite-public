import { prisma } from "../lib/prisma";

export async function listChecklist(taskId: number) {
  return prisma.taskChecklist.findMany({ where: { task_id: taskId } });
}

export async function addChecklistItem(taskId: number, title: string) {
  const newItem = await prisma.taskChecklist.create({
    data: { task_id: taskId, title, is_done: false },
  });

  const taskWithUpdates = await getTaskWithRelations(taskId);
  return { item: newItem, task: taskWithUpdates };
}

export async function updateChecklistItem(id: number, data: { is_done?: boolean; title?: string }) {
  const updatedItem = await prisma.taskChecklist.update({
    where: { id },
    data: {
      is_done: data.is_done,
      title: data.title,
    },
  });

  const taskWithUpdates = await getTaskWithRelations(updatedItem.task_id);
  return { item: updatedItem, task: taskWithUpdates };
}

export async function deleteChecklistItem(id: number) {
  const item = await prisma.taskChecklist.findUnique({ where: { id } });
  if (!item) return null;

  await prisma.taskChecklist.delete({ where: { id } });
  const taskWithUpdates = await getTaskWithRelations(item.task_id);
  return { task: taskWithUpdates };
}

async function getTaskWithRelations(taskId: number) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: { user: true, checklists: true, activities: { include: { user: true } } },
  });
}