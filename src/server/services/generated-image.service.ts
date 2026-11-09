import { prisma } from "../lib/prisma";

export async function listImages(userId: number, opts: { agentId?: number } = {}) {
  return prisma.generatedImage.findMany({
    where: { user_id: userId, ...(opts.agentId ? { agent_id: opts.agentId } : {}) },
    orderBy: { created_at: "desc" },
    include: { agent: { select: { id: true, name: true } } },
    take: 200,
  });
}

export async function deleteImage(imageId: number, userId: number) {
  const image = await prisma.generatedImage.findFirst({ where: { id: imageId, user_id: userId } });
  if (!image) {
    throw new Error("Imagem não encontrada.");
  }
  await prisma.generatedImage.delete({ where: { id: imageId } });
  return { success: true };
}
