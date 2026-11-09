import { prisma } from "../lib/prisma";
import { encrypt, decrypt } from "../lib/encryption";

async function assertProjectAccess(projectId: number, userId: number) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }],
    },
    select: { id: true },
  });
  if (!project) {
    throw new Error("Projeto não encontrado ou você não tem acesso a ele.");
  }
}

function toSafeCredential<T extends { password: string | null }>(credential: T) {
  const { password, ...rest } = credential;
  return { ...rest, has_password: !!password };
}

async function findOwnedCredential(projectId: number, credentialId: number) {
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, project_id: projectId },
  });
  if (!credential) {
    throw new Error("Credencial não encontrada.");
  }
  return credential;
}

export interface CredentialInput {
  title: string;
  category?: string;
  username?: string | null;
  password?: string | null;
  url?: string | null;
  notes?: string | null;
}

export async function listCredentials(projectId: number, userId: number) {
  await assertProjectAccess(projectId, userId);
  const credentials = await prisma.credential.findMany({
    where: { project_id: projectId },
    orderBy: { created_at: "desc" },
  });
  return credentials.map(toSafeCredential);
}

export async function createCredential(projectId: number, userId: number, data: CredentialInput) {
  await assertProjectAccess(projectId, userId);
  const credential = await prisma.credential.create({
    data: {
      project_id: projectId,
      user_id: userId,
      title: data.title,
      category: data.category || "other",
      username: data.username || null,
      password: data.password ? encrypt(data.password) : null,
      url: data.url || null,
      notes: data.notes || null,
    },
  });
  return toSafeCredential(credential);
}

export async function updateCredential(projectId: number, credentialId: number, userId: number, data: Partial<CredentialInput>) {
  await assertProjectAccess(projectId, userId);
  await findOwnedCredential(projectId, credentialId);

  const credential = await prisma.credential.update({
    where: { id: credentialId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.category !== undefined ? { category: data.category || "other" } : {}),
      ...(data.username !== undefined ? { username: data.username || null } : {}),
      ...(data.password !== undefined ? { password: data.password ? encrypt(data.password) : null } : {}),
      ...(data.url !== undefined ? { url: data.url || null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
    },
  });
  return toSafeCredential(credential);
}

export async function deleteCredential(projectId: number, credentialId: number, userId: number) {
  await assertProjectAccess(projectId, userId);
  await findOwnedCredential(projectId, credentialId);
  await prisma.credential.delete({ where: { id: credentialId } });
  return { success: true };
}

export async function revealCredentialPassword(projectId: number, credentialId: number, userId: number) {
  await assertProjectAccess(projectId, userId);
  const credential = await findOwnedCredential(projectId, credentialId);
  return { password: credential.password ? decrypt(credential.password) : null };
}
