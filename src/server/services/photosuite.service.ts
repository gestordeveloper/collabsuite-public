import crypto from "crypto";
import { prisma } from "../lib/prisma";

export class ForbiddenError extends Error {
  statusCode = 403;
}
export class NotFoundError extends Error {
  statusCode = 404;
}
export class BadRequestError extends Error {
  statusCode = 400;
}

/** Documento vazio: uma camada de fundo branca (sem pixels, a imagem é gerada no cliente). */
function emptyDocJson(width: number, height: number): string {
  return JSON.stringify({
    version: 1,
    width,
    height,
    layers: [
      {
        id: "bg",
        type: "raster",
        name: "Fundo",
        visible: true,
        locked: false,
        opacity: 1,
        blend: "normal",
        x: 0,
        y: 0,
        width,
        height,
        fill: "#ffffff",
        src: null,
        mask: null,
      },
    ],
  });
}

/** Membro = dono do projeto ou usuário adicionado a ele. */
async function isProjectMember(projectId: number, userId: number): Promise<boolean> {
  const p = await prisma.project.findFirst({
    where: { id: projectId, OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] },
    select: { id: true },
  });
  return !!p;
}

export async function assertProjectAccess(projectId: number, userId: number) {
  if (!(await isProjectMember(projectId, userId))) throw new ForbiddenError("Você não é membro desse projeto.");
}

type Access = { user_id: number; visibility: string; project_id: number | null };

/** Abre/edita: o dono, ou (visibilidade "project") qualquer membro do projeto vinculado. */
export async function canAccess(doc: Access, userId: number): Promise<boolean> {
  if (doc.user_id === userId) return true;
  return doc.visibility === "project" && doc.project_id != null && (await isProjectMember(doc.project_id, userId));
}

const ownerSelect = { select: { first_name: true, last_name: true } } as const;
const fullName = (u: { first_name: string; last_name: string | null } | null | undefined) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || null;

/** Meus documentos + os que membros dos meus projetos compartilharam comigo. */
export async function listPhotoDocuments(userId: number, companyId?: number | null) {
  const visible = {
    OR: [
      { user_id: userId },
      { visibility: "project", project: { OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] } },
    ],
  };
  const where: any = companyId ? { AND: [visible, { OR: [{ company_id: companyId }, { user_id: userId }] }] } : visible;
  // `doc` pode ter centenas de KB — a listagem só precisa dos metadados.
  const rows = await prisma.photoDocument.findMany({
    where,
    orderBy: { updated_at: "desc" },
    select: {
      id: true, company_id: true, user_id: true, project_id: true, name: true, thumbnail_url: true, width: true, height: true,
      visibility: true, share_token: true, created_at: true, updated_at: true, user: ownerSelect,
    },
  });
  return rows.map(({ user, ...r }) => ({ ...r, is_owner: r.user_id === userId, owner_name: fullName(user) }));
}

export async function getPhotoDocumentById(id: number) {
  return prisma.photoDocument.findUnique({ where: { id } });
}

export async function createPhotoDocument(data: {
  name: string;
  user_id: number;
  company_id?: number | null;
  project_id?: number | null;
  width?: number;
  height?: number;
  doc?: string | null;
}) {
  if (data.project_id) await assertProjectAccess(data.project_id, data.user_id);
  const width = data.width ?? 1920;
  const height = data.height ?? 1080;
  return prisma.photoDocument.create({
    data: {
      name: data.name,
      user_id: data.user_id,
      company_id: data.company_id ?? null,
      project_id: data.project_id ?? null,
      width,
      height,
      doc: data.doc ?? emptyDocJson(width, height),
    },
  });
}

export async function updatePhotoDocument(
  id: number,
  userId: number,
  data: {
    name?: string;
    project_id?: number | null;
    visibility?: "private" | "project";
    thumbnail_url?: string | null;
    width?: number;
    height?: number;
    doc?: string;
  },
) {
  const existing = await prisma.photoDocument.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Documento não encontrado");
  const isOwner = existing.user_id === userId;
  // só o dono mexe em quem vê o documento
  if (!isOwner && (data.project_id !== undefined || data.visibility !== undefined)) {
    throw new ForbiddenError("Só o dono pode mudar o projeto e a visibilidade.");
  }
  if (data.project_id) await assertProjectAccess(data.project_id, userId);
  const projectId = data.project_id !== undefined ? data.project_id : existing.project_id;
  if (data.visibility === "project" && !projectId) throw new BadRequestError("Vincule o documento a um projeto para compartilhar com os membros.");
  return prisma.photoDocument.update({
    where: { id },
    data: {
      name: data.name,
      project_id: data.project_id !== undefined ? data.project_id : undefined,
      // tirar o documento do projeto encerra o compartilhamento com os membros
      visibility: projectId ? data.visibility : "private",
      thumbnail_url: data.thumbnail_url !== undefined ? data.thumbnail_url : undefined,
      width: data.width,
      height: data.height,
      doc: data.doc !== undefined ? data.doc : undefined,
    },
  });
}

export async function deletePhotoDocument(id: number) {
  return prisma.photoDocument.delete({ where: { id } });
}

/** A cópia é de quem copiou (privada); as camadas apontam para PNGs imutáveis, então compartilham as URLs. */
export async function duplicatePhotoDocument(id: number, newOwnerId: number) {
  const original = await prisma.photoDocument.findUnique({ where: { id } });
  if (!original) return null;
  const keepProject = original.project_id != null && (original.user_id === newOwnerId || (await isProjectMember(original.project_id, newOwnerId)));
  return prisma.photoDocument.create({
    data: {
      name: `${original.name} (cópia)`,
      user_id: newOwnerId,
      company_id: original.company_id,
      project_id: keepProject ? original.project_id : null,
      thumbnail_url: original.thumbnail_url,
      width: original.width,
      height: original.height,
      doc: original.doc,
    },
  });
}

/**
 * Liga/desliga o link público (somente leitura). O cliente envia a imagem final já enviada ao
 * storage (`image_url`); ligar de novo com outra imagem atualiza o que o link mostra.
 */
export async function setPublicShare(id: number, enabled: boolean, imageUrl?: string) {
  const doc = await prisma.photoDocument.findUnique({ where: { id }, select: { share_token: true, share_image_url: true } });
  if (!doc) throw new NotFoundError("Documento não encontrado");
  if (!enabled) {
    return prisma.photoDocument.update({ where: { id }, data: { share_token: null, share_image_url: null, shared_at: null }, select: { share_token: true, share_image_url: true, shared_at: true } });
  }
  const image = imageUrl ?? doc.share_image_url;
  if (!image) throw new BadRequestError("Envie a imagem do documento para publicar o link.");
  return prisma.photoDocument.update({
    where: { id },
    data: { share_token: doc.share_token ?? crypto.randomBytes(24).toString("hex"), share_image_url: image, shared_at: new Date() },
    select: { share_token: true, share_image_url: true, shared_at: true },
  });
}

export async function getPublicPhotoDocument(token: string) {
  if (!/^[a-f0-9]{16,64}$/.test(token)) throw new NotFoundError("Link inválido ou desativado.");
  const doc = await prisma.photoDocument.findUnique({
    where: { share_token: token },
    select: { name: true, width: true, height: true, share_image_url: true, shared_at: true, user: ownerSelect },
  });
  if (!doc || !doc.share_image_url) throw new NotFoundError("Link inválido ou desativado.");
  return { name: doc.name, width: doc.width, height: doc.height, image_url: doc.share_image_url, shared_at: doc.shared_at, owner_name: fullName(doc.user) };
}
