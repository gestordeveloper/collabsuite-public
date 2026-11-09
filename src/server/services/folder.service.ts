import { prisma } from "../lib/prisma";

export async function listFolders(userId: number) {
  return prisma.folder.findMany({
    where: { user_id: userId },
    orderBy: { name: "asc" },
  });
}

export async function createFolder(name: string, userId: number) {
  if (!name.trim()) {
    throw new Error("O nome da pasta é obrigatório");
  }
  return prisma.folder.create({
    data: {
      name: name.trim(),
      user_id: userId,
    },
  });
}

export async function deleteFolder(folderId: number, userId: number) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, user_id: userId },
  });
  if (!folder) {
    throw new Error("Pasta não encontrada ou acesso não autorizado");
  }
  return prisma.folder.delete({
    where: { id: folderId },
  });
}
