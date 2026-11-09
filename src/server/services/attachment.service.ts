import { prisma } from "../lib/prisma";

export async function listAttachments(taskId: number) {
  return prisma.taskAttachment.findMany({
    where: { task_id: taskId },
    orderBy: { created_at: "asc" },
  });
}

export async function createAttachment(taskId: number, data: {
  file_name: string;
  file_url: string;
  file_size?: number;
  file_type?: string;
}) {
  return prisma.taskAttachment.create({
    data: {
      task_id: taskId,
      file_name: data.file_name,
      file_url: data.file_url,
      file_size: data.file_size || 0,
      file_type: data.file_type || "application/octet-stream",
    },
  });
}

export async function deleteAttachment(attachmentId: number) {
  return prisma.taskAttachment.delete({ where: { id: attachmentId } });
}