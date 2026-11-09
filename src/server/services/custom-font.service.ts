import { prisma } from "../lib/prisma";

export async function listCustomFonts(userId: number, companyId?: number | null) {
  const where: any = { user_id: userId };
  if (companyId) where.company_id = companyId;

  return prisma.customFont.findMany({
    where,
    orderBy: { created_at: "asc" },
  });
}

export async function createCustomFont(data: {
  user_id: number;
  company_id?: number | null;
  family: string;
  url: string;
  weight?: number;
  style?: string;
}) {
  return prisma.customFont.create({
    data: {
      user_id: data.user_id,
      company_id: data.company_id ?? null,
      family: data.family,
      url: data.url,
      weight: data.weight ?? 400,
      style: data.style ?? "normal",
    },
  });
}

export async function getCustomFontById(id: number) {
  return prisma.customFont.findUnique({ where: { id } });
}

export async function deleteCustomFont(id: number) {
  return prisma.customFont.delete({ where: { id } });
}
