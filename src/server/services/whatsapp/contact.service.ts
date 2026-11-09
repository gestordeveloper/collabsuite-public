import { prisma } from "../../lib/prisma";
import { isLikelyValidPhone } from "./connectionManager";

async function findOwnedList(userId: number, listId: number) {
  const list = await prisma.whatsAppContactList.findFirst({
    where: { id: listId, user_id: userId },
  });
  if (!list) {
    throw new Error("Lista de contatos não encontrada.");
  }
  return list;
}

async function findOwnedContact(userId: number, listId: number, contactId: number) {
  await findOwnedList(userId, listId);
  const contact = await prisma.whatsAppContact.findFirst({
    where: { id: contactId, list_id: listId },
  });
  if (!contact) {
    throw new Error("Contato não encontrado.");
  }
  return contact;
}

export async function listLists(userId: number) {
  const lists = await prisma.whatsAppContactList.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    include: { _count: { select: { contacts: true, campaigns: true } } },
  });
  return lists;
}

export async function getList(userId: number, listId: number) {
  const list = await findOwnedList(userId, listId);
  const counts = await prisma.whatsAppContactList.findUnique({
    where: { id: list.id },
    include: { _count: { select: { contacts: true, campaigns: true } } },
  });
  return counts;
}

export interface ContactListInput {
  name: string;
  connection_id?: number | null;
}

export async function createList(userId: number, data: ContactListInput) {
  if (data.connection_id) {
    await assertOwnedConnection(userId, data.connection_id);
  }
  return prisma.whatsAppContactList.create({
    data: {
      user_id: userId,
      name: data.name,
      connection_id: data.connection_id || null,
    },
  });
}

export async function updateList(userId: number, listId: number, data: Partial<ContactListInput>) {
  await findOwnedList(userId, listId);
  if (data.connection_id) {
    await assertOwnedConnection(userId, data.connection_id);
  }
  return prisma.whatsAppContactList.update({
    where: { id: listId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.connection_id !== undefined ? { connection_id: data.connection_id || null } : {}),
    },
  });
}

export async function deleteList(userId: number, listId: number) {
  await findOwnedList(userId, listId);
  await prisma.whatsAppContactList.delete({ where: { id: listId } });
  return { success: true };
}

async function assertOwnedConnection(userId: number, connectionId: number) {
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { id: connectionId, user_id: userId },
    select: { id: true },
  });
  if (!connection) {
    throw new Error("Conexão do WhatsApp não encontrada.");
  }
}

export async function listContacts(userId: number, listId: number) {
  await findOwnedList(userId, listId);
  return prisma.whatsAppContact.findMany({
    where: { list_id: listId },
    orderBy: { created_at: "desc" },
  });
}

export interface ContactInput {
  name?: string | null;
  phone: string;
  tags?: string | null;
  opted_out?: boolean;
}

export async function createContact(userId: number, listId: number, data: ContactInput) {
  await findOwnedList(userId, listId);
  if (!isLikelyValidPhone(data.phone)) {
    throw new Error("Número de telefone inválido.");
  }
  return prisma.whatsAppContact.create({
    data: {
      list_id: listId,
      name: data.name || null,
      phone: data.phone,
      tags: data.tags || null,
      opted_out: !!data.opted_out,
    },
  });
}

export async function updateContact(userId: number, listId: number, contactId: number, data: Partial<ContactInput>) {
  await findOwnedContact(userId, listId, contactId);
  if (data.phone !== undefined && !isLikelyValidPhone(data.phone)) {
    throw new Error("Número de telefone inválido.");
  }
  return prisma.whatsAppContact.update({
    where: { id: contactId },
    data: {
      ...(data.name !== undefined ? { name: data.name || null } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.tags !== undefined ? { tags: data.tags || null } : {}),
      ...(data.opted_out !== undefined ? { opted_out: data.opted_out } : {}),
    },
  });
}

export async function deleteContact(userId: number, listId: number, contactId: number) {
  await findOwnedContact(userId, listId, contactId);
  await prisma.whatsAppContact.delete({ where: { id: contactId } });
  return { success: true };
}

export interface BulkContactRow {
  name?: string | null;
  phone: string;
  tags?: string | null;
}

/**
 * Bulk insert for CSV import — the CSV itself is parsed client-side into plain {name, phone}
 * rows and POSTed as JSON here, per product decision to avoid a server-side CSV dependency.
 */
export async function bulkCreateContacts(userId: number, listId: number, rows: BulkContactRow[]) {
  await findOwnedList(userId, listId);

  const valid = rows.filter((r) => r && typeof r.phone === "string" && isLikelyValidPhone(r.phone));
  const skipped = rows.length - valid.length;

  if (valid.length === 0) {
    return { imported: 0, skipped };
  }

  const result = await prisma.whatsAppContact.createMany({
    data: valid.map((r) => ({
      list_id: listId,
      name: (r.name || "").trim() || null,
      phone: r.phone.trim(),
      tags: (r.tags || "").trim() || null,
      opted_out: false,
    })),
  });

  return { imported: result.count, skipped };
}
