/** Comandos salvos do projeto (rodam no terminal com um clique). */
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { assertSshAccess, type Actor } from "./access";

export interface CommandInput {
  name?: string;
  command?: string;
  description?: string | null;
  confirm?: boolean;
}

const view = (c: { id: number; name: string; command: string; description: string | null; confirm: boolean }) => ({
  id: c.id, name: c.name, command: c.command, description: c.description, confirm: c.confirm,
});

function clean(input: CommandInput, partial: boolean) {
  const out: { name?: string; command?: string; description?: string | null; confirm?: boolean } = {};
  if (!partial || input.name !== undefined) {
    const name = (input.name ?? "").toString().trim();
    if (!name) throw new HttpError("Dê um nome ao comando.");
    out.name = name.slice(0, 120);
  }
  if (!partial || input.command !== undefined) {
    const command = (input.command ?? "").toString().replace(/\r\n/g, "\n").trim();
    if (!command) throw new HttpError("Escreva o comando.");
    if (command.length > 4000 || command.includes("\0")) throw new HttpError("Comando inválido ou grande demais.");
    out.command = command;
  }
  if (input.description !== undefined) out.description = input.description ? input.description.toString().trim().slice(0, 255) : null;
  if (input.confirm !== undefined) out.confirm = !!input.confirm;
  return out;
}

export async function listCommands(actor: Actor, projectId: number) {
  await assertSshAccess(actor, projectId);
  return (await prisma.sshCommand.findMany({ where: { project_id: projectId }, orderBy: { name: "asc" } })).map(view);
}

export async function createCommand(actor: Actor, projectId: number, input: CommandInput) {
  await assertSshAccess(actor, projectId);
  const data = clean(input, false);
  return view(await prisma.sshCommand.create({ data: { project_id: projectId, name: data.name!, command: data.command!, description: data.description ?? null, confirm: data.confirm ?? true, created_by: actor.id } }));
}

export async function updateCommand(actor: Actor, projectId: number, id: number, input: CommandInput) {
  await assertSshAccess(actor, projectId);
  if (!(await prisma.sshCommand.findFirst({ where: { id, project_id: projectId }, select: { id: true } }))) throw new HttpError("Comando não encontrado.", 404);
  return view(await prisma.sshCommand.update({ where: { id }, data: clean(input, true) }));
}

export async function deleteCommand(actor: Actor, projectId: number, id: number) {
  await assertSshAccess(actor, projectId);
  const r = await prisma.sshCommand.deleteMany({ where: { id, project_id: projectId } });
  if (r.count === 0) throw new HttpError("Comando não encontrado.", 404);
  return { ok: true };
}
