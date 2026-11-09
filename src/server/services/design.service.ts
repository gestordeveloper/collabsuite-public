import { prisma } from "../lib/prisma";

function emptyPageJson(width: number, height: number): string {
  return JSON.stringify([
    { id: "page-1", width, height, background: { type: "solid", color: "#ffffff" }, elements: [] },
  ]);
}

export async function listDesigns(userId: number, companyId?: number | null) {
  const where: any = { user_id: userId };
  if (companyId) where.company_id = companyId;

  return prisma.design.findMany({
    where,
    orderBy: { updated_at: "desc" },
  });
}

export async function getDesignById(designId: number) {
  return prisma.design.findUnique({
    where: { id: designId },
  });
}

export async function createDesign(data: {
  name: string;
  user_id: number;
  company_id?: number | null;
  project_id?: number | null;
  thumbnail_url?: string | null;
  width?: number;
  height?: number;
  pages?: string | null;
}) {
  const width = data.width ?? 1920;
  const height = data.height ?? 1080;
  return prisma.design.create({
    data: {
      name: data.name,
      user_id: data.user_id,
      company_id: data.company_id ?? null,
      project_id: data.project_id ?? null,
      thumbnail_url: data.thumbnail_url ?? null,
      width,
      height,
      pages: data.pages ?? emptyPageJson(width, height),
    },
  });
}

export async function updateDesign(
  designId: number,
  data: {
    name?: string;
    project_id?: number | null;
    thumbnail_url?: string | null;
    width?: number;
    height?: number;
    pages?: string;
  }
) {
  return prisma.design.update({
    where: { id: designId },
    data: {
      name: data.name,
      project_id: data.project_id !== undefined ? data.project_id : undefined,
      thumbnail_url: data.thumbnail_url !== undefined ? data.thumbnail_url : undefined,
      width: data.width,
      height: data.height,
      pages: data.pages !== undefined ? data.pages : undefined,
    },
  });
}

export async function deleteDesign(designId: number) {
  return prisma.design.delete({ where: { id: designId } });
}

export async function duplicateDesign(designId: number) {
  const original = await prisma.design.findUnique({ where: { id: designId } });
  if (!original) return null;

  return prisma.design.create({
    data: {
      name: `${original.name} (cópia)`,
      user_id: original.user_id,
      company_id: original.company_id,
      project_id: original.project_id,
      width: original.width,
      height: original.height,
      pages: original.pages,
    },
  });
}
