import type { ChatContact } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { digitsOnly } from "./shape";

interface UpsertInput {
  name?: string | null;
  number?: string | null;
  lid?: string | null;
  profilePicUrl?: string | null;
  isGroup: boolean;
}

const isPlaceholderName = (name: string | null | undefined, c: Pick<ChatContact, "number" | "lid">) =>
  !name || /^\+?\d[\d\s-]*$/.test(name) || name === c.number || name === c.lid;

/** Acha (por número ou LID) ou cria o contato de atendimento; completa o que faltar sem sobrescrever nome já definido. */
export async function upsertChatContact(input: UpsertInput): Promise<ChatContact> {
  const number = input.number ? (input.isGroup ? input.number : digitsOnly(input.number)) || null : null;
  const lid = input.lid || null;
  if (!number && !lid) throw new HttpError("Contato sem número nem identificador.");

  const find = () =>
    prisma.chatContact.findFirst({
      where: { OR: [...(number ? [{ number }] : []), ...(lid ? [{ lid }] : [])] },
    });

  const existing = await find();
  if (existing) {
    const data: Record<string, unknown> = {};
    if (number && !existing.number) data.number = number;
    if (lid && !existing.lid) data.lid = lid;
    if (input.name && input.name !== existing.name && isPlaceholderName(existing.name, existing)) data.name = input.name;
    if (input.profilePicUrl && input.profilePicUrl !== existing.profile_pic_url) data.profile_pic_url = input.profilePicUrl;
    if (!Object.keys(data).length) return existing;
    try {
      return await prisma.chatContact.update({ where: { id: existing.id }, data });
    } catch {
      return existing; // outro contato já usa esse número/LID: mantém o encontrado
    }
  }

  try {
    return await prisma.chatContact.create({
      data: {
        name: input.name || number || lid || "Contato",
        number,
        lid,
        profile_pic_url: input.profilePicUrl || null,
        is_group: input.isGroup,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const raced = await find();
      if (raced) return raced;
    }
    throw err;
  }
}

/** JID de envio do contato: grupo, número ou, na falta dele, o LID. */
export function jidOf(contact: Pick<ChatContact, "number" | "lid" | "is_group">): string {
  if (contact.is_group) return `${contact.number}@g.us`;
  if (contact.number) return `${contact.number}@s.whatsapp.net`;
  return `${contact.lid}@lid`;
}

export async function searchContacts(search: string) {
  const term = search.trim();
  if (!term) return [];
  const digits = digitsOnly(term);
  return prisma.chatContact.findMany({
    where: {
      is_group: false,
      OR: [{ name: { contains: term } }, ...(digits ? [{ number: { contains: digits } }] : [])],
    },
    orderBy: { updated_at: "desc" },
    take: 15,
  });
}
