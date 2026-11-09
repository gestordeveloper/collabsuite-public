import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY_MESSAGES = 40;

const parseHistory = (raw: string): HistoryMessage[] => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Histórico vivo do contato (vazio se expirou). `handed_off` sobrevive à expiração: só um humano reativa. */
export async function getSession(agentId: number, jid: string) {
  const row = await prisma.agentChannelSession.findUnique({ where: { agent_id_contact_jid: { agent_id: agentId, contact_jid: jid } } });
  if (!row) return { history: [] as HistoryMessage[], handedOff: false };
  const expired = !!row.expires_at && row.expires_at.getTime() < Date.now();
  return { history: expired ? [] : parseHistory(row.history), handedOff: row.handed_off };
}

export async function saveSession(agentId: number, jid: string, name: string | null, history: HistoryMessage[], ttlSeconds: number) {
  const data = {
    contact_name: name,
    history: JSON.stringify(history.slice(-MAX_HISTORY_MESSAGES)),
    expires_at: ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null,
  };
  await prisma.agentChannelSession.upsert({
    where: { agent_id_contact_jid: { agent_id: agentId, contact_jid: jid } },
    create: { agent_id: agentId, contact_jid: jid, ...data },
    update: data,
  });
}

export async function markHandedOff(agentId: number, jid: string, name: string | null) {
  await prisma.agentChannelSession.upsert({
    where: { agent_id_contact_jid: { agent_id: agentId, contact_jid: jid } },
    create: { agent_id: agentId, contact_jid: jid, contact_name: name, history: "[]", handed_off: true },
    update: { handed_off: true },
  });
}

export async function listSessions(agentId: number) {
  const rows = await prisma.agentChannelSession.findMany({ where: { agent_id: agentId }, orderBy: { updated_at: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    contact_jid: r.contact_jid,
    contact_name: r.contact_name,
    phone: r.contact_jid.split("@")[0].split(":")[0],
    messages: parseHistory(r.history).length,
    handed_off: r.handed_off,
    expires_at: r.expires_at,
    expired: !!r.expires_at && r.expires_at.getTime() < Date.now(),
    updated_at: r.updated_at,
  }));
}

export async function getSessionMessages(agentId: number, id: number) {
  const row = await prisma.agentChannelSession.findFirst({ where: { id, agent_id: agentId } });
  if (!row) throw new HttpError("Sessão não encontrada.", 404);
  return parseHistory(row.history);
}

export async function deleteSession(agentId: number, id: number) {
  const row = await prisma.agentChannelSession.findFirst({ where: { id, agent_id: agentId } });
  if (!row) throw new HttpError("Sessão não encontrada.", 404);
  await prisma.agentChannelSession.delete({ where: { id } });
}

/** Devolve a conversa ao agente depois de um atendimento humano. */
export async function resumeSession(agentId: number, id: number) {
  const row = await prisma.agentChannelSession.findFirst({ where: { id, agent_id: agentId } });
  if (!row) throw new HttpError("Sessão não encontrada.", 404);
  await prisma.agentChannelSession.update({ where: { id }, data: { handed_off: false } });
}
