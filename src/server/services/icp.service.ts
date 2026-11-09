import { prisma } from "../lib/prisma";

export interface IcpInput {
  name: string;
  niche?: string | null;
  description: string;
}

async function findOwnedIcp(icpId: number, userId: number) {
  const icp = await prisma.icp.findFirst({ where: { id: icpId, user_id: userId } });
  if (!icp) {
    throw new Error("ICP não encontrado ou você não tem acesso a ele.");
  }
  return icp;
}

export async function listIcps(userId: number) {
  return prisma.icp.findMany({ where: { user_id: userId }, orderBy: { name: "asc" } });
}

export async function getIcp(icpId: number, userId: number) {
  return findOwnedIcp(icpId, userId);
}

export async function createIcp(userId: number, companyId: number | null, data: IcpInput) {
  return prisma.icp.create({
    data: {
      user_id: userId,
      company_id: companyId,
      name: data.name,
      niche: data.niche ?? null,
      description: data.description,
    },
  });
}

export async function updateIcp(icpId: number, userId: number, data: Partial<IcpInput>) {
  await findOwnedIcp(icpId, userId);
  return prisma.icp.update({
    where: { id: icpId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.niche !== undefined ? { niche: data.niche } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
  });
}

export async function deleteIcp(icpId: number, userId: number) {
  await findOwnedIcp(icpId, userId);
  await prisma.icp.delete({ where: { id: icpId } });
  return { success: true };
}
