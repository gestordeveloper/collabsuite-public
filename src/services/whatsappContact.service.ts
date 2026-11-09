import api from "./api";

export interface WhatsAppContactList {
  id: number;
  user_id: number;
  connection_id: number | null;
  name: string;
  created_at: string;
  updated_at: string;
  _count?: { contacts: number; campaigns: number };
}

export interface WhatsAppContact {
  id: number;
  list_id: number;
  name: string | null;
  phone: string;
  tags: string | null;
  opted_out: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContactListPayload {
  name: string;
  connection_id?: number | null;
}

export async function fetchLists() {
  const { data } = await api.get("/whatsapp/lists");
  return data as WhatsAppContactList[];
}

export async function fetchList(listId: number) {
  const { data } = await api.get(`/whatsapp/lists/${listId}`);
  return data as WhatsAppContactList;
}

export async function createList(payload: ContactListPayload) {
  const { data } = await api.post("/whatsapp/lists", payload);
  return data as WhatsAppContactList;
}

export async function updateList(listId: number, payload: Partial<ContactListPayload>) {
  const { data } = await api.put(`/whatsapp/lists/${listId}`, payload);
  return data as WhatsAppContactList;
}

export async function deleteList(listId: number) {
  await api.delete(`/whatsapp/lists/${listId}`);
}

export async function fetchContacts(listId: number) {
  const { data } = await api.get(`/whatsapp/lists/${listId}/contacts`);
  return data as WhatsAppContact[];
}

export interface ContactPayload {
  name?: string | null;
  phone: string;
  tags?: string | null;
  opted_out?: boolean;
}

export async function createContact(listId: number, payload: ContactPayload) {
  const { data } = await api.post(`/whatsapp/lists/${listId}/contacts`, payload);
  return data as WhatsAppContact;
}

export async function updateContact(listId: number, contactId: number, payload: Partial<ContactPayload>) {
  const { data } = await api.put(`/whatsapp/lists/${listId}/contacts/${contactId}`, payload);
  return data as WhatsAppContact;
}

export async function deleteContact(listId: number, contactId: number) {
  await api.delete(`/whatsapp/lists/${listId}/contacts/${contactId}`);
}

export interface BulkImportRow {
  name?: string | null;
  phone: string;
  tags?: string | null;
}

export async function bulkImportContacts(listId: number, contacts: BulkImportRow[]) {
  const { data } = await api.post(`/whatsapp/lists/${listId}/contacts/bulk`, { contacts });
  return data as { imported: number; skipped: number };
}

/**
 * Minimal client-side CSV parser for the import flow — per product decision, the CSV never
 * leaves the browser as a file; it's parsed here into plain rows and POSTed as JSON.
 * Expects a header row containing at least "phone" (and optionally "name"/"tags"), comma
 * separated. Handles quoted fields with embedded commas.
 */
export function parseContactsCsv(text: string): BulkImportRow[] {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells.map((c) => c.trim());
  };

  const header = parseLine(lines[0]).map((h) => h.toLowerCase());
  const nameIdx = header.indexOf("name") !== -1 ? header.indexOf("name") : header.indexOf("nome");
  const phoneIdx = header.indexOf("phone") !== -1 ? header.indexOf("phone") : header.indexOf("telefone");
  const tagsIdx = header.indexOf("tags");

  // No recognizable header — treat the whole file as headerless "name,phone" rows.
  if (phoneIdx === -1) {
    return lines
      .map((line) => {
        const cells = parseLine(line);
        return { name: cells[0] || null, phone: cells[1] || cells[0] || "" };
      })
      .filter((r) => r.phone);
  }

  return lines
    .slice(1)
    .map((line) => {
      const cells = parseLine(line);
      return {
        name: nameIdx !== -1 ? cells[nameIdx] || null : null,
        phone: cells[phoneIdx] || "",
        tags: tagsIdx !== -1 ? cells[tagsIdx] || null : null,
      };
    })
    .filter((r) => r.phone);
}
