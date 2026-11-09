import { prisma } from "../../lib/prisma";
import { BRAZIL_OFFSET_MS } from "../task.service";

export interface TurnLogInput {
  agentId: number;
  channel?: string;
  contactJid?: string | null;
  status: "ok" | "error";
  error?: string | null;
  agentMs: number;
  waitMs?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  toolNames?: string[];
  usedRag?: boolean;
  media?: string[];
  messagesIn?: number;
  handoff?: { reason: string; ticketId: number | null } | null;
}

/** Registra um turno do agente. Nunca lança: métrica não pode derrubar o atendimento. */
export async function logTurn(t: TurnLogInput) {
  try {
    await prisma.agentTurnLog.create({
      data: {
        agent_id: t.agentId,
        channel: t.channel ?? "whatsapp",
        contact_jid: t.contactJid ?? null,
        status: t.status,
        error: t.error ? t.error.slice(0, 500) : null,
        agent_ms: Math.max(0, Math.round(t.agentMs)),
        wait_ms: t.waitMs == null ? null : Math.max(0, Math.round(t.waitMs)),
        input_tokens: t.inputTokens ?? 0,
        output_tokens: t.outputTokens ?? 0,
        tool_calls: t.toolNames?.length ?? 0,
        tools: t.toolNames?.length ? JSON.stringify(t.toolNames) : null,
        used_rag: !!t.usedRag,
        media: t.media?.length ? [...new Set(t.media)].join(",") : null,
        messages_in: t.messagesIn ?? 1,
        handoff: !!t.handoff,
        handoff_reason: t.handoff?.reason?.slice(0, 500) ?? null,
        ticket_id: t.handoff?.ticketId ?? null,
      },
    });
  } catch (err: any) {
    console.warn("[agent-metrics] Falha ao registrar turno:", err?.message || err);
  }
}

const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const local = (d: Date) => new Date(d.getTime() - BRAZIL_OFFSET_MS);
const dayKey = (d: Date) => local(d).toISOString().slice(0, 10);

type Turn = Awaited<ReturnType<typeof loadTurns>>[number];
const loadTurns = (agentId: number, from: Date, to: Date) =>
  prisma.agentTurnLog.findMany({ where: { agent_id: agentId, created_at: { gte: from, lt: to } }, orderBy: { created_at: "asc" }, take: 100_000 });

function summarize(turns: Turn[], appointmentsCreated: number) {
  const ok = turns.filter((t) => t.status === "ok");
  const contacts = new Set(turns.map((t) => t.contact_jid).filter(Boolean) as string[]);
  const handed = new Set(turns.filter((t) => t.handoff).map((t) => t.contact_jid).filter(Boolean) as string[]);
  const agentMs = ok.map((t) => t.agent_ms).sort((a, b) => a - b);
  const waitMs = ok.map((t) => t.wait_ms).filter((x): x is number => x != null).sort((a, b) => a - b);
  return {
    turns: turns.length,
    messages_in: turns.reduce((a, t) => a + t.messages_in, 0),
    contacts: contacts.size,
    errors: turns.length - ok.length,
    error_rate: turns.length ? (turns.length - ok.length) / turns.length : 0,
    handoffs: handed.size,
    handoff_rate: contacts.size ? handed.size / contacts.size : 0,
    autonomous_rate: contacts.size ? 1 - handed.size / contacts.size : 0,
    agent_ms: { avg: avg(agentMs), p50: percentile(agentMs, 50), p95: percentile(agentMs, 95) },
    wait_ms: { avg: avg(waitMs), p50: percentile(waitMs, 50), p95: percentile(waitMs, 95) },
    input_tokens: turns.reduce((a, t) => a + t.input_tokens, 0),
    output_tokens: turns.reduce((a, t) => a + t.output_tokens, 0),
    tokens_per_turn: turns.length ? Math.round(turns.reduce((a, t) => a + t.input_tokens + t.output_tokens, 0) / turns.length) : 0,
    rag_rate: turns.length ? turns.filter((t) => t.used_rag).length / turns.length : 0,
    tool_calls: turns.reduce((a, t) => a + t.tool_calls, 0),
    appointments: appointmentsCreated,
    conversion_rate: contacts.size ? appointmentsCreated / contacts.size : 0,
  };
}

export async function getDashboard(agentId: number, days: number) {
  days = Math.min(365, Math.max(1, Math.floor(days) || 30));
  const now = new Date();
  // Janela alinhada ao dia de Brasília: "últimos N dias" inclui hoje.
  const todayStart = new Date(Date.UTC(local(now).getUTCFullYear(), local(now).getUTCMonth(), local(now).getUTCDate()) + BRAZIL_OFFSET_MS);
  const from = new Date(todayStart.getTime() - (days - 1) * 86_400_000);
  const to = new Date(todayStart.getTime() + 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);

  const [turns, prevTurns, appts, prevApptCount, sessions] = await Promise.all([
    loadTurns(agentId, from, to),
    loadTurns(agentId, prevFrom, from),
    prisma.agentAppointment.findMany({ where: { agent_id: agentId, created_at: { gte: from, lt: to } }, orderBy: { created_at: "desc" }, take: 5000 }),
    prisma.agentAppointment.count({ where: { agent_id: agentId, action: "created", created_at: { gte: prevFrom, lt: from } } }),
    prisma.agentChannelSession.findMany({ where: { agent_id: agentId }, select: { created_at: true, handed_off: true, expires_at: true } }),
  ]);

  const created = appts.filter((a) => a.action === "created");
  const summary = summarize(turns, created.length);
  const previous = summarize(prevTurns, prevApptCount);

  // Série diária (todos os dias do período, inclusive os vazios).
  const byDay = new Map<string, { turns: number; handoffs: number; errors: number; contacts: Set<string>; appointments: number }>();
  for (let i = 0; i < days; i++) byDay.set(dayKey(new Date(from.getTime() + i * 86_400_000 + 3600_000)), { turns: 0, handoffs: 0, errors: 0, contacts: new Set(), appointments: 0 });
  for (const t of turns) {
    const d = byDay.get(dayKey(t.created_at));
    if (!d) continue;
    d.turns++;
    if (t.handoff) d.handoffs++;
    if (t.status !== "ok") d.errors++;
    if (t.contact_jid) d.contacts.add(t.contact_jid);
  }
  for (const a of created) byDay.get(dayKey(a.created_at))!.appointments++;
  const daily = [...byDay.entries()].map(([date, d]) => ({ date, turns: d.turns, contacts: d.contacts.size, handoffs: d.handoffs, errors: d.errors, appointments: d.appointments }));

  // Mapa de calor: dia da semana × hora (Brasília).
  const heat: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const t of turns) {
    const l = local(t.created_at);
    heat[l.getUTCDay()][l.getUTCHours()]++;
  }

  const toolCounts = new Map<string, number>();
  for (const t of turns) {
    if (!t.tools) continue;
    try {
      for (const name of JSON.parse(t.tools) as string[]) toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
    } catch {
      /* ignora */
    }
  }
  const mediaCounts = { text: 0, audio: 0, image: 0, sticker: 0 };
  for (const t of turns) {
    if (!t.media) mediaCounts.text++;
    else for (const m of t.media.split(",")) if (m in mediaCounts) mediaCounts[m as keyof typeof mediaCounts]++;
  }

  // O que aconteceu com as conversas transferidas.
  const ticketIds = [...new Set(turns.filter((t) => t.ticket_id).map((t) => t.ticket_id as number))];
  const tickets = ticketIds.length ? await prisma.ticket.findMany({ where: { id: { in: ticketIds } }, select: { status: true, created_at: true, closed_at: true } }) : [];
  const closed = tickets.filter((t) => t.closed_at);
  const handoffTickets = {
    total: tickets.length,
    pending: tickets.filter((t) => t.status === "pending").length,
    open: tickets.filter((t) => t.status === "open").length,
    closed: closed.length,
    avg_close_minutes: closed.length ? Math.round(closed.reduce((a, t) => a + (t.closed_at!.getTime() - t.created_at.getTime()), 0) / closed.length / 60_000) : null,
  };
  const reasons = turns
    .filter((t) => t.handoff && t.handoff_reason)
    .slice(-8)
    .reverse()
    .map((t) => ({ at: t.created_at, reason: t.handoff_reason as string, ticket_id: t.ticket_id }));

  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(appts.map((a) => a.user_id))] } }, select: { id: true, first_name: true, last_name: true } });
  const userName = new Map(users.map((u) => [u.id, `${u.first_name} ${u.last_name ?? ""}`.trim()]));
  const apptByUser = new Map<string, number>();
  for (const a of created) apptByUser.set(userName.get(a.user_id) ?? `#${a.user_id}`, (apptByUser.get(userName.get(a.user_id) ?? `#${a.user_id}`) ?? 0) + 1);

  const nowMs = Date.now();
  return {
    days,
    from,
    to,
    summary,
    previous,
    daily,
    heatmap: heat,
    tools: [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    media: mediaCounts,
    appointments: {
      created: created.length,
      rescheduled: appts.filter((a) => a.action === "rescheduled").length,
      canceled: appts.filter((a) => a.action === "canceled").length,
      by_user: [...apptByUser.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      recent: appts.slice(0, 8).map((a) => ({ id: a.id, action: a.action, user: userName.get(a.user_id) ?? `#${a.user_id}`, contact: a.contact_name, starts_at: a.starts_at, created_at: a.created_at, task_id: a.task_id })),
    },
    handoff_tickets: handoffTickets,
    handoff_reasons: reasons,
    contacts_now: {
      total: sessions.length,
      new_in_period: sessions.filter((s) => s.created_at >= from).length,
      active: sessions.filter((s) => !s.handed_off && (!s.expires_at || s.expires_at.getTime() > nowMs)).length,
      with_human: sessions.filter((s) => s.handed_off).length,
    },
    recent_errors: turns
      .filter((t) => t.status !== "ok")
      .slice(-5)
      .reverse()
      .map((t) => ({ at: t.created_at, error: t.error })),
  };
}
