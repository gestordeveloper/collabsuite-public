import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";

const include = {
  users: { include: { user: { select: { id: true, first_name: true, last_name: true, photo: true } } } },
  _count: { select: { tickets: true } },
} as const;

function shape(q: any) {
  const { users, ...rest } = q;
  return { ...rest, users: users.map((u: any) => u.user), user_ids: users.map((u: any) => u.user_id) };
}

export async function listQueues() {
  const rows = await prisma.ticketQueue.findMany({ include, orderBy: { name: "asc" } });
  return rows.map(shape);
}

interface QueueInput {
  name: string;
  color: string;
  greeting_message?: string | null;
  auto_distribution?: boolean;
  user_ids?: number[];
}

async function assertUnique(name: string, ignoreId?: number) {
  const dup = await prisma.ticketQueue.findFirst({ where: { name, ...(ignoreId ? { id: { not: ignoreId } } : {}) } });
  if (dup) throw new HttpError("Já existe uma fila com esse nome.");
}

export async function createQueue(data: QueueInput) {
  await assertUnique(data.name);
  const row = await prisma.ticketQueue.create({
    data: {
      name: data.name,
      color: data.color,
      greeting_message: data.greeting_message || null,
      auto_distribution: !!data.auto_distribution,
      users: { create: [...new Set(data.user_ids ?? [])].map((user_id) => ({ user_id })) },
    },
    include,
  });
  return shape(row);
}

export async function updateQueue(id: number, data: Partial<QueueInput>) {
  const existing = await prisma.ticketQueue.findUnique({ where: { id } });
  if (!existing) throw new HttpError("Fila não encontrada.", 404);
  if (data.name && data.name !== existing.name) await assertUnique(data.name, id);

  const row = await prisma.$transaction(async (tx) => {
    if (data.user_ids) {
      await tx.ticketQueueUser.deleteMany({ where: { queue_id: id } });
      await tx.ticketQueueUser.createMany({ data: [...new Set(data.user_ids)].map((user_id) => ({ queue_id: id, user_id })) });
    }
    return tx.ticketQueue.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.greeting_message !== undefined ? { greeting_message: data.greeting_message || null } : {}),
        ...(data.auto_distribution !== undefined ? { auto_distribution: data.auto_distribution } : {}),
      },
      include,
    });
  });
  return shape(row);
}

export async function deleteQueue(id: number) {
  const existing = await prisma.ticketQueue.findUnique({ where: { id } });
  if (!existing) throw new HttpError("Fila não encontrada.", 404);
  await prisma.ticketQueue.delete({ where: { id } });
  return { success: true };
}

export async function listTags() {
  return prisma.ticketTag.findMany({ orderBy: { name: "asc" } });
}

export async function createTag(data: { name: string; color: string }) {
  const dup = await prisma.ticketTag.findUnique({ where: { name: data.name } });
  if (dup) throw new HttpError("Já existe uma etiqueta com esse nome.");
  return prisma.ticketTag.create({ data });
}

export async function updateTag(id: number, data: { name?: string; color?: string }) {
  const existing = await prisma.ticketTag.findUnique({ where: { id } });
  if (!existing) throw new HttpError("Etiqueta não encontrada.", 404);
  return prisma.ticketTag.update({ where: { id }, data });
}

export async function deleteTag(id: number) {
  const existing = await prisma.ticketTag.findUnique({ where: { id } });
  if (!existing) throw new HttpError("Etiqueta não encontrada.", 404);
  await prisma.ticketTag.delete({ where: { id } });
  return { success: true };
}
