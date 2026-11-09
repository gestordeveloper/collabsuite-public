import type { Request, Response } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma";
import { HttpError, sendError } from "../lib/httpError";
import { getOwnedAgentRaw } from "../services/agent.service";
import { invalidateChannelAgent } from "../services/agent-channel/channel.service";
import * as sessions from "../services/agent-channel/session.service";
import * as rag from "../services/agent-rag/rag.service";
import { isQdrantConnected, qdrantCollection } from "../services/agent-rag/qdrant";
import * as mcp from "../services/agent-mcp/mcp.service";
import { startConnection } from "../services/whatsapp/connectionManager";
import * as calendar from "../services/agent-calendar/calendar.service";
import { getDashboard } from "../services/agent-metrics/metrics.service";
import * as telegram from "../services/agent-telegram/telegram.service";

const SCOPE = "agent-channel";

export const knowledgeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single("file");

/** Carrega o agente garantindo que pertence ao usuário autenticado. */
async function agentOf(req: Request) {
  return getOwnedAgentRaw(parseInt(req.params.agentId), req.user!.id).catch(() => {
    throw new HttpError("Agente não encontrado ou você não tem acesso a ele.", 404);
  });
}

const run = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendError(res, err, SCOPE);
  }
};

const isAdmin = (req: Request) => req.user!.role === "admin" || req.user!.role === "super_admin";

// ─── Configuração do canal ──────────────────────────────────────────────────────

export const getSettings = run(async (req, res) => {
  const agent = await agentOf(req);
  const connection = agent.channel_connection_id
    ? await prisma.whatsAppConnection.findUnique({
        where: { id: agent.channel_connection_id },
        select: { id: true, label: true, phone_number: true, status: true, receive_tickets: true },
      })
    : null;
  res.json({
    channel_connection_id: agent.channel_connection_id,
    channel_enabled: agent.channel_enabled,
    rag_enabled: agent.rag_enabled,
    session_ttl_seconds: agent.session_ttl_seconds,
    buffer_delay_seconds: agent.buffer_delay_seconds,
    humanize_replies: agent.humanize_replies,
    handoff_enabled: agent.handoff_enabled,
    recordings_enabled: agent.recordings_enabled,
    connection,
    qdrant_configured: !!process.env.QDRANT_URL,
  });
});

export const updateSettings = run(async (req, res) => {
  const agent = await agentOf(req);
  const b = req.body ?? {};
  const data: Record<string, unknown> = {};

  if (b.channel_connection_id !== undefined) {
    if (b.channel_connection_id === null) data.channel_connection_id = null;
    else {
      const conn = await prisma.whatsAppConnection.findFirst({ where: { id: Number(b.channel_connection_id), user_id: req.user!.id } });
      if (!conn) throw new HttpError("Conexão de WhatsApp não encontrada.");
      data.channel_connection_id = conn.id;
    }
  }
  for (const key of ["channel_enabled", "rag_enabled", "humanize_replies", "handoff_enabled", "recordings_enabled"] as const) {
    if (b[key] !== undefined) data[key] = !!b[key];
  }
  if (b.session_ttl_seconds !== undefined) data.session_ttl_seconds = Math.max(0, Math.floor(Number(b.session_ttl_seconds) || 0));
  if (b.buffer_delay_seconds !== undefined) data.buffer_delay_seconds = Math.min(60, Math.max(0, Math.floor(Number(b.buffer_delay_seconds) || 0)));

  const connectionId = (data.channel_connection_id ?? agent.channel_connection_id) as number | null;
  const enabled = (data.channel_enabled ?? agent.channel_enabled) as boolean;
  if (enabled && !connectionId) throw new HttpError("Escolha uma conexão de WhatsApp para ativar o atendimento.");
  if (enabled && connectionId) {
    const other = await prisma.agent.findFirst({
      where: { channel_connection_id: connectionId, channel_enabled: true, is_active: true, id: { not: agent.id } },
      select: { name: true },
    });
    if (other) throw new HttpError(`Esta conexão já é atendida pelo agente "${other.name}". Uma conexão só pode ter um agente ativo.`);
  }

  await prisma.agent.update({ where: { id: agent.id }, data });
  invalidateChannelAgent();

  // Garante o socket de pé para o agente receber mensagens mesmo sem ninguém com a página aberta.
  if (enabled && connectionId) startConnection(connectionId).catch((err) => console.warn("[agent-channel] Não foi possível iniciar a conexão:", err?.message || err));

  await getSettings(req, res);
});

// ─── Sessões ────────────────────────────────────────────────────────────────────

export const listSessions = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await sessions.listSessions(agent.id));
});
export const sessionMessages = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await sessions.getSessionMessages(agent.id, parseInt(req.params.id)));
});
export const deleteSession = run(async (req, res) => {
  const agent = await agentOf(req);
  await sessions.deleteSession(agent.id, parseInt(req.params.id));
  res.json({ success: true });
});
export const resumeSession = run(async (req, res) => {
  const agent = await agentOf(req);
  await sessions.resumeSession(agent.id, parseInt(req.params.id));
  invalidateChannelAgent();
  res.json({ success: true });
});

// ─── Base de conhecimento ───────────────────────────────────────────────────────

export const knowledgeStatus = run(async (req, res) => {
  const agent = await agentOf(req);
  const configured = !!process.env.QDRANT_URL;
  res.json({
    qdrant_configured: configured,
    qdrant_connected: configured ? await isQdrantConnected() : false,
    collection: qdrantCollection(),
    files: await rag.listKnowledgeFiles(agent.id),
  });
});

export const uploadKnowledge = run(async (req, res) => {
  const agent = await agentOf(req);
  if (!req.file) throw new HttpError("Nenhum arquivo enviado.");
  if (!process.env.QDRANT_URL) throw new HttpError("QDRANT_URL não configurada no servidor.");
  // multer decodifica o nome como latin1; recupera acentos.
  const originalname = Buffer.from(req.file.originalname, "latin1").toString("utf8");
  const row = await rag.addKnowledgeFile(agent, { buffer: req.file.buffer, originalname, mimetype: req.file.mimetype });
  res.status(202).json(row);
});

export const deleteKnowledge = run(async (req, res) => {
  const agent = await agentOf(req);
  await rag.removeKnowledgeFile(agent.id, parseInt(req.params.id));
  res.json({ success: true });
});

export const searchKnowledge = run(async (req, res) => {
  const agent = await agentOf(req);
  const query = String(req.body?.query ?? "").trim();
  if (!query) throw new HttpError("Informe a busca.");
  const hits = await rag.retrieveContext(agent, query, Math.min(10, Number(req.body?.k) || 5), req.body?.self_query !== false);
  res.json(hits);
});

// ─── MCP ────────────────────────────────────────────────────────────────────────

export const listMcp = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await mcp.listMcpServers(agent.id));
});
export const createMcp = run(async (req, res) => {
  const agent = await agentOf(req);
  res.status(201).json(await mcp.createMcpServer(agent.id, req.body ?? {}, isAdmin(req)));
});
export const updateMcp = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await mcp.updateMcpServer(agent.id, parseInt(req.params.id), req.body ?? {}, isAdmin(req)));
});
export const deleteMcp = run(async (req, res) => {
  const agent = await agentOf(req);
  await mcp.deleteMcpServer(agent.id, parseInt(req.params.id));
  res.json({ success: true });
});
export const testMcp = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await mcp.testMcpServer(agent.id, parseInt(req.params.id)));
});

// ─── Dashboard ──────────────────────────────────────────────────────────────────

export const dashboard = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await getDashboard(agent.id, Number(req.query.days) || 30));
});

// ─── Agenda ─────────────────────────────────────────────────────────────────────

export const listCalendar = run(async (req, res) => {
  const agent = await agentOf(req);
  const [access, users] = await Promise.all([
    calendar.listAccess(agent.id),
    prisma.user.findMany({
      where: { status: "active" },
      select: { id: true, first_name: true, last_name: true, email: true, photo: true },
      orderBy: { first_name: "asc" },
    }),
  ]);
  res.json({
    access,
    // Quem pode ser liberado por este usuário: administradores, qualquer pessoa; os demais, só a si mesmos.
    grantable: users
      .filter((u) => isAdmin(req) || u.id === req.user!.id)
      .map((u) => ({ id: u.id, name: `${u.first_name} ${u.last_name ?? ""}`.trim(), email: u.email, photo: u.photo })),
  });
});

export const setCalendarAccess = run(async (req, res) => {
  const agent = await agentOf(req);
  const userId = Number(req.params.userId);
  if (!userId) throw new HttpError("Usuário inválido.");
  res.json(
    await calendar.setAccess(agent.id, { id: req.user!.id, role: req.user!.role }, userId, {
      can_write: req.body?.can_write === undefined ? undefined : !!req.body.can_write,
      enforce_availability: req.body?.enforce_availability === undefined ? undefined : !!req.body.enforce_availability,
    })
  );
});

export const removeCalendarAccess = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await calendar.removeAccess(agent.id, { id: req.user!.id, role: req.user!.role }, Number(req.params.userId)));
});

// ─── Telegram (assistente pessoal) ──────────────────────────────────────────────

export const getTelegram = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await telegram.getTelegramSettings(agent.id));
});

export const updateTelegram = run(async (req, res) => {
  const agent = await agentOf(req);
  const b = req.body ?? {};
  res.json(
    await telegram.saveTelegramSettings(agent, {
      bot_token: typeof b.bot_token === "string" ? b.bot_token : undefined,
      enabled: b.enabled === undefined ? undefined : !!b.enabled,
      briefing_enabled: b.briefing_enabled === undefined ? undefined : !!b.briefing_enabled,
      briefing_time: typeof b.briefing_time === "string" ? b.briefing_time : undefined,
    })
  );
});

export const deleteTelegram = run(async (req, res) => {
  const agent = await agentOf(req);
  await telegram.removeTelegram(agent.id);
  res.json({ success: true });
});

export const createTelegramPairing = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await telegram.createPairing(agent.id, req.user!.id));
});

export const deleteTelegramLink = run(async (req, res) => {
  const agent = await agentOf(req);
  await telegram.removeLink(agent.id, parseInt(req.params.linkId));
  res.json({ success: true });
});

export const telegramBriefingNow = run(async (req, res) => {
  const agent = await agentOf(req);
  res.json(await telegram.sendBriefingNow(agent));
});
