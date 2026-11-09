/**
 * Regra de acesso ao terminal SSH: SÓ o dono do projeto e administradores da plataforma.
 * Um shell em servidor é um privilégio alto — ser membro do projeto não basta.
 * Quem nem é membro recebe 404 (não revela que o projeto existe); membro sem permissão recebe 403.
 */
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";

export interface Actor {
  id: number;
  role: string;
}

export const isAdmin = (actor: Actor) => actor.role === "admin" || actor.role === "super_admin";

export async function assertSshAccess(actor: Actor, projectId: number): Promise<{ id: number; name: string | null }> {
  if (!Number.isInteger(projectId)) throw new HttpError("Projeto inválido.");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, user_id: true, projectUsers: { where: { user_id: actor.id }, select: { id: true } } },
  });
  if (!project) throw new HttpError("Projeto não encontrado ou sem permissão de acesso.", 404);
  if (isAdmin(actor) || project.user_id === actor.id) return { id: project.id, name: project.name };
  if (project.projectUsers.length > 0) throw new HttpError("Somente o dono do projeto e administradores podem usar o terminal SSH.", 403);
  throw new HttpError("Projeto não encontrado ou sem permissão de acesso.", 404);
}
