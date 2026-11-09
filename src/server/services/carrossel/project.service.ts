import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../access.service";
import type { CarouselProjectData } from "./types";

const newId = () => `proj_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** Dono do carrossel, ou qualquer membro do projeto da CollabSuite ao qual ele está vinculado. */
function accessWhere(userId: number) {
  return {
    OR: [
      { user_id: userId },
      { project: { OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] } },
    ],
  };
}

async function assertProjectAccess(projectId: number, userId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] },
    select: { id: true },
  });
  if (!project) throw new NotFoundError("Projeto não encontrado ou sem permissão de acesso.");
}

type Row = { id: string; user_id: number; project_id: number | null; title: string; data: string; created_at: Date; updated_at: Date };

function toData(row: Row): CarouselProjectData {
  const data = JSON.parse(row.data) as CarouselProjectData;
  return {
    ...data, id: row.id, title: row.title, project_id: row.project_id,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
  };
}

export async function listProjects(userId: number, opts: { projectId?: number } = {}) {
  const rows = await prisma.carouselProject.findMany({
    where: { ...accessWhere(userId), ...(opts.projectId ? { project_id: opts.projectId } : {}) },
    orderBy: { updated_at: "desc" },
    include: { project: { select: { id: true, name: true, color: true } } },
  });
  return rows.map((r) => {
    const d = toData(r);
    return {
      id: r.id, title: r.title, brandbook_id: d.brandbook_id, archetype: d.archetype, carousel_model: d.carousel_model,
      is_single_slide: d.is_single_slide, slide_count: d.slides.length, theme: d.theme,
      first_slide: d.slides[0] ? { template_code: d.slides[0].template_code, title: d.slides[0].title } : null,
      project_id: r.project_id, project: r.project, user_id: r.user_id,
      created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(),
    };
  });
}

export async function getProject(id: string, userId: number): Promise<CarouselProjectData> {
  const row = await prisma.carouselProject.findFirst({ where: { id, ...accessWhere(userId) } });
  if (!row) throw new NotFoundError("Carrossel não encontrado ou sem permissão de acesso.");
  return toData(row);
}

export async function createProject(userId: number, data: CarouselProjectData): Promise<CarouselProjectData> {
  if (data.project_id) await assertProjectAccess(data.project_id, userId);
  const id = data.id && !(await prisma.carouselProject.count({ where: { id: data.id } })) ? data.id : newId();
  const { project_id, created_at, updated_at, ...rest } = data;
  const row = await prisma.carouselProject.create({
    data: { id, user_id: userId, project_id: project_id ?? null, title: data.title || "Sem título", data: JSON.stringify({ ...rest, id }) },
  });
  void created_at; void updated_at;
  return toData(row);
}

export async function saveProject(id: string, userId: number, data: CarouselProjectData): Promise<CarouselProjectData> {
  const existing = await prisma.carouselProject.findFirst({ where: { id, ...accessWhere(userId) } });
  if (!existing) throw new NotFoundError("Carrossel não encontrado ou sem permissão de acesso.");
  const projectId = data.project_id === undefined ? existing.project_id : data.project_id;
  if (projectId && projectId !== existing.project_id) await assertProjectAccess(projectId, userId);
  const { project_id, created_at, updated_at, ...rest } = data;
  void project_id; void created_at; void updated_at;
  const row = await prisma.carouselProject.update({
    where: { id },
    data: { title: data.title || "Sem título", project_id: projectId ?? null, data: JSON.stringify({ ...rest, id }) },
  });
  return toData(row);
}

export async function deleteProject(id: string, userId: number): Promise<void> {
  const row = await prisma.carouselProject.findFirst({ where: { id, ...accessWhere(userId) }, include: { project: { select: { user_id: true } } } });
  if (!row) throw new NotFoundError("Carrossel não encontrado ou sem permissão de acesso.");
  if (row.user_id !== userId && row.project?.user_id !== userId) {
    throw new NotFoundError("Apenas quem criou o carrossel ou o dono do projeto pode excluí-lo.");
  }
  await prisma.carouselProject.delete({ where: { id } });
}

export async function duplicateProject(id: string, userId: number): Promise<CarouselProjectData> {
  const src = await getProject(id, userId);
  return createProject(userId, { ...src, id: newId(), title: `${src.title} (cópia)` });
}

/** Quantos carrosséis (de qualquer usuário) usam a marca — impede excluir uma marca em uso. */
export async function countByBrandbook(brandbookId: string): Promise<number> {
  const rows = await prisma.carouselProject.findMany({ select: { data: true } });
  return rows.filter((r) => {
    try { return JSON.parse(r.data).brandbook_id === brandbookId; } catch { return false; }
  }).length;
}
