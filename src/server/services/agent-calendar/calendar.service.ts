import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import type { ToolDefinition } from "../../lib/ai-providers/types";
import type { ExtraToolset } from "../agent-run.service";
import { createTask, updateTask, softDeleteTask, BRAZIL_OFFSET_MS } from "../task.service";
import { notifyUser } from "../notification.service";

// ─── Datas em horário de Brasília (UTC-3 fixo, como o resto do app) ─────────────

const pad = (n: number) => String(n).padStart(2, "0");
const brt = (d: Date) => new Date(d.getTime() - BRAZIL_OFFSET_MS); // use getUTC* no resultado
export const dateStrOf = (d: Date) => {
  const l = brt(d);
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`;
};
export const hhmmOf = (d: Date) => {
  const l = brt(d);
  return `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`;
};
export const dayStartUtc = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + BRAZIL_OFFSET_MS);
};
export const instantOf = (dateStr: string, hhmm: string) => {
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(dayStartUtc(dateStr).getTime() + (h * 60 + mi) * 60_000);
};
const utcOf = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const weekdayOf = (dateStr: string) => utcOf(dateStr).getUTCDay();
export const addDays = (dateStr: string, n: number) => {
  const d = utcOf(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(dayStartUtc(s).getTime());
export const isHhmm = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const minutesToHhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// ─── Configuração de disponibilidade do usuário (Perfil → Agendamento) ──────────

interface ScheduleSettings {
  availableDays: number[];
  startHour: string;
  endHour: string;
  meetingDuration: number;
  blockedPeriods: { day: number; start: string; end: string }[];
}

function parseSettings(raw: string | null | undefined): ScheduleSettings {
  const defaults: ScheduleSettings = { availableDays: [1, 2, 3, 4, 5], startHour: "09:00", endHour: "18:00", meetingDuration: 30, blockedPeriods: [] };
  try {
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

// ─── Acesso do agente às agendas ────────────────────────────────────────────────

const userSelect = { id: true, first_name: true, last_name: true, email: true, photo: true, role: true, schedule_settings: true } as const;
const fullName = (u: { first_name: string; last_name: string | null }) => `${u.first_name} ${u.last_name ?? ""}`.trim();

export async function listAccess(agentId: number) {
  const rows = await prisma.agentCalendarAccess.findMany({ where: { agent_id: agentId }, include: { user: { select: userSelect } }, orderBy: { id: "asc" } });
  return rows.map((r) => {
    const s = parseSettings(r.user.schedule_settings);
    return {
      id: r.id,
      user_id: r.user_id,
      name: fullName(r.user),
      email: r.user.email,
      photo: r.user.photo,
      can_write: r.can_write,
      enforce_availability: r.enforce_availability,
      availability: {
        days: s.availableDays.map((d) => WEEKDAYS[d]),
        start: s.startHour,
        end: s.endHour,
        slot_minutes: s.meetingDuration,
      },
    };
  });
}

/** Um usuário comum só concede a própria agenda; administradores concedem a de qualquer pessoa. */
export async function setAccess(
  agentId: number,
  actor: { id: number; role: string },
  userId: number,
  opts: { can_write?: boolean; enforce_availability?: boolean }
) {
  const isAdmin = actor.role === "admin" || actor.role === "super_admin";
  if (userId !== actor.id && !isAdmin) throw new HttpError("Você só pode liberar a sua própria agenda. Peça a um administrador para liberar a de outras pessoas.", 403);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError("Usuário não encontrado.", 404);
  await prisma.agentCalendarAccess.upsert({
    where: { agent_id_user_id: { agent_id: agentId, user_id: userId } },
    create: { agent_id: agentId, user_id: userId, can_write: opts.can_write ?? true, enforce_availability: opts.enforce_availability ?? true },
    update: {
      ...(opts.can_write !== undefined ? { can_write: opts.can_write } : {}),
      ...(opts.enforce_availability !== undefined ? { enforce_availability: opts.enforce_availability } : {}),
    },
  });
  return listAccess(agentId);
}

export async function removeAccess(agentId: number, actor: { id: number; role: string }, userId: number) {
  const isAdmin = actor.role === "admin" || actor.role === "super_admin";
  if (userId !== actor.id && !isAdmin) throw new HttpError("Somente administradores removem a agenda de outras pessoas.", 403);
  await prisma.agentCalendarAccess.deleteMany({ where: { agent_id: agentId, user_id: userId } });
  return listAccess(agentId);
}

// ─── Consultas ──────────────────────────────────────────────────────────────────

interface Busy {
  id: number;
  title: string | null;
  type: string | null;
  status: string;
  start: Date;
  hour: string | null;
  minutes: number; // 0 = não bloqueia horário
  contact: string | null;
}

async function busyOf(userId: number, fromDate: string, toDateExclusive: string, meetingMinutes: number): Promise<Busy[]> {
  const tasks = await prisma.task.findMany({
    where: {
      deleted_at: null,
      due_at: { gte: dayStartUtc(fromDate), lt: dayStartUtc(toDateExclusive) },
      OR: [{ user_id: userId }, { taskUsers: { some: { user_id: userId } } }],
    },
    select: { id: true, title: true, type: true, status: true, due_at: true, hour_at: true, estimated_time: true, first_name: true, last_name: true },
    orderBy: { due_at: "asc" },
  });
  return tasks.map((t) => {
    const est = t.estimated_time && /^\d{1,2}:\d{2}$/.test(t.estimated_time) ? toMinutes(t.estimated_time) : 0;
    const blocks = t.status !== "done" && !!t.hour_at && (t.type === "meeting" || est > 0);
    return {
      id: t.id,
      title: t.title,
      type: t.type,
      status: t.status,
      start: t.due_at as Date,
      hour: t.hour_at,
      minutes: blocks ? est || meetingMinutes : 0,
      contact: [t.first_name, t.last_name].filter(Boolean).join(" ") || null,
    };
  });
}

function freeSlots(settings: ScheduleSettings, day: string, busy: Busy[], duration: number, notBefore: Date): string[] {
  if (!settings.availableDays.includes(weekdayOf(day))) return [];
  const slots: string[] = [];
  const end = toMinutes(settings.endHour);
  for (let t = toMinutes(settings.startHour); t + duration <= end; t += Math.max(5, settings.meetingDuration)) {
    const start = instantOf(day, minutesToHhmm(t));
    if (start < notBefore) continue;
    const stop = new Date(start.getTime() + duration * 60_000);
    const hhmm = minutesToHhmm(t);
    const day0 = weekdayOf(day);
    const blocked = settings.blockedPeriods.some((b) => b.day === day0 && hhmm >= b.start && hhmm < b.end);
    const clash = busy.some((b) => b.minutes > 0 && b.start < stop && new Date(b.start.getTime() + b.minutes * 60_000) > start);
    if (!blocked && !clash) slots.push(hhmm);
  }
  return slots;
}

// ─── Ferramentas do agente ──────────────────────────────────────────────────────

export interface CalendarCtx {
  channel: string;
  contactJid?: string | null;
  contactName?: string | null;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

export async function openCalendarToolset(
  agent: { id: number; name: string },
  ctx: CalendarCtx
): Promise<(ExtraToolset & { promptNote: string }) | null> {
  const access = await prisma.agentCalendarAccess.findMany({ where: { agent_id: agent.id }, include: { user: { select: userSelect } } });
  if (!access.length) return null;
  const byUser = new Map(access.map((a) => [a.user_id, a]));
  const anyWrite = access.some((a) => a.can_write);

  const now = new Date();
  const lines = access.map((a) => {
    const s = parseSettings(a.user.schedule_settings);
    return `- usuario_id ${a.user_id}: ${fullName(a.user)} — atende ${s.availableDays.map((d) => WEEKDAYS[d]).join(", ")} das ${s.startHour} às ${s.endHour}, blocos de ${s.meetingDuration} min${a.can_write ? "" : " (somente consulta)"}`;
  });
  const promptNote = `Agendas disponíveis para você (use as ferramentas de agenda):\n${lines.join("\n")}\nData e hora atuais (Brasília): ${dateStrOf(now)} (${WEEKDAYS[weekdayOf(dateStrOf(now))]}) ${hhmmOf(now)}.\nRegras: antes de agendar, confirme com o cliente nome, assunto e o horário escolhido entre os realmente livres (use horarios_disponiveis); nunca invente horários; use sempre datas AAAA-MM-DD e horas HH:MM.`;

  const userIdProp = { type: "number", description: "usuario_id da agenda (veja a lista de agendas disponíveis)" };
  const definitions: ToolDefinition[] = [
    {
      name: "listar_agenda",
      description: "Lista os compromissos de um usuário em um intervalo de datas.",
      parameters: {
        type: "object",
        properties: { usuario_id: userIdProp, data_inicio: { type: "string", description: "AAAA-MM-DD" }, data_fim: { type: "string", description: "AAAA-MM-DD (opcional; padrão = data_inicio)" } },
        required: ["usuario_id", "data_inicio"],
      },
    },
    {
      name: "horarios_disponiveis",
      description: "Retorna os horários livres de um usuário (respeitando expediente e compromissos) a partir de uma data.",
      parameters: {
        type: "object",
        properties: {
          usuario_id: userIdProp,
          data_inicio: { type: "string", description: "AAAA-MM-DD" },
          dias: { type: "number", description: "Quantos dias olhar à frente (1 a 14; padrão 7)" },
          duracao_min: { type: "number", description: "Duração desejada em minutos (padrão = bloco do usuário)" },
        },
        required: ["usuario_id", "data_inicio"],
      },
    },
  ];
  if (anyWrite) {
    definitions.push(
      {
        name: "agendar_compromisso",
        description: "Cria um compromisso (reunião ou tarefa com hora) na agenda do usuário. Só use após o cliente confirmar data e hora.",
        parameters: {
          type: "object",
          properties: {
            usuario_id: userIdProp,
            titulo: { type: "string", description: "Título curto, ex.: 'Reunião com Maria — proposta'" },
            data: { type: "string", description: "AAAA-MM-DD" },
            hora: { type: "string", description: "HH:MM" },
            duracao_min: { type: "number", description: "Duração em minutos (padrão = bloco do usuário)" },
            tipo: { type: "string", enum: ["meeting", "task"], description: "meeting (padrão, gera link do Meet quando possível) ou task" },
            descricao: { type: "string" },
            nome_contato: { type: "string" },
            email_contato: { type: "string" },
            telefone_contato: { type: "string" },
          },
          required: ["usuario_id", "titulo", "data", "hora"],
        },
      },
      {
        name: "remarcar_compromisso",
        description: "Muda a data/hora de um compromisso existente.",
        parameters: {
          type: "object",
          properties: { compromisso_id: { type: "number" }, nova_data: { type: "string", description: "AAAA-MM-DD" }, nova_hora: { type: "string", description: "HH:MM" } },
          required: ["compromisso_id", "nova_data", "nova_hora"],
        },
      },
      {
        name: "cancelar_compromisso",
        description: "Cancela (remove da agenda) um compromisso existente.",
        parameters: { type: "object", properties: { compromisso_id: { type: "number" }, motivo: { type: "string" } }, required: ["compromisso_id"] },
      }
    );
  }

  const log = (action: string, userId: number, taskId: number | null, startsAt: Date | null, contact?: string | null) =>
    prisma.agentAppointment
      .create({ data: { agent_id: agent.id, user_id: userId, task_id: taskId, action, channel: ctx.channel, contact_name: contact ?? ctx.contactName ?? null, contact_jid: ctx.contactJid ?? null, starts_at: startsAt } })
      .catch((err) => console.warn("[agent-calendar] Falha ao registrar compromisso:", err?.message || err));

  const accessFor = (id: unknown, write: boolean) => {
    const a = byUser.get(num(id));
    if (!a) throw new Error("Este agente não tem acesso à agenda desse usuário. Use apenas os usuario_id listados.");
    if (write && !a.can_write) throw new Error("Esta agenda é somente para consulta: não é possível criar ou alterar compromissos nela.");
    return a;
  };

  /** Valida o horário e devolve a duração; lança erro com motivo claro (o modelo repassa ao cliente). */
  async function assertBookable(a: (typeof access)[number], date: string, hhmm: string, duration: number, ignoreTaskId?: number) {
    const settings = parseSettings(a.user.schedule_settings);
    const start = instantOf(date, hhmm);
    if (start.getTime() < Date.now()) throw new Error("Esse horário já passou.");
    if (a.enforce_availability) {
      const day0 = weekdayOf(date);
      const t = toMinutes(hhmm);
      if (!settings.availableDays.includes(day0)) throw new Error(`${fullName(a.user)} não atende em ${WEEKDAYS[day0]}. Use horarios_disponiveis para ver as opções.`);
      if (t < toMinutes(settings.startHour) || t + duration > toMinutes(settings.endHour))
        throw new Error(`Fora do expediente (${settings.startHour}–${settings.endHour}). Use horarios_disponiveis para ver as opções.`);
      if (settings.blockedPeriods.some((b) => b.day === day0 && hhmm >= b.start && hhmm < b.end)) throw new Error("Esse horário está bloqueado na agenda.");
    }
    const busy = (await busyOf(a.user_id, date, addDays(date, 1), settings.meetingDuration)).filter((b) => b.id !== ignoreTaskId);
    const stop = new Date(start.getTime() + duration * 60_000);
    const clash = busy.find((b) => b.minutes > 0 && b.start < stop && new Date(b.start.getTime() + b.minutes * 60_000) > start);
    if (clash) throw new Error(`Conflito: já existe "${clash.title}" às ${clash.hour}. Use horarios_disponiveis para ver as opções.`);
    return { settings, start };
  }

  async function execute(name: string, args: Record<string, unknown>): Promise<string | null> {
    try {
      switch (name) {
        case "listar_agenda": {
          const a = accessFor(args.usuario_id, false);
          if (!isDate(args.data_inicio)) throw new Error("data_inicio inválida (use AAAA-MM-DD).");
          const end = isDate(args.data_fim) ? args.data_fim : args.data_inicio;
          const items = await busyOf(a.user_id, args.data_inicio, addDays(end > args.data_inicio ? end : args.data_inicio, 1), parseSettings(a.user.schedule_settings).meetingDuration);
          return JSON.stringify({
            usuario: fullName(a.user),
            compromissos: items.slice(0, 60).map((b) => ({ id: b.id, titulo: b.title, data: dateStrOf(b.start), hora: b.hour, tipo: b.type, status: b.status, duracao_min: b.minutes || null, contato: b.contact })),
          });
        }
        case "horarios_disponiveis": {
          const a = accessFor(args.usuario_id, false);
          if (!isDate(args.data_inicio)) throw new Error("data_inicio inválida (use AAAA-MM-DD).");
          const days = Math.min(14, Math.max(1, Math.floor(num(args.dias) || 7)));
          const settings = parseSettings(a.user.schedule_settings);
          const duration = Math.min(480, Math.max(5, Math.floor(num(args.duracao_min) || settings.meetingDuration)));
          const busy = await busyOf(a.user_id, args.data_inicio, addDays(args.data_inicio, days), settings.meetingDuration);
          const notBefore = new Date(Date.now() + 30 * 60_000); // margem mínima de 30 min
          const livres: Record<string, string[]> = {};
          for (let i = 0; i < days; i++) {
            const day = addDays(args.data_inicio, i);
            const slots = freeSlots(settings, day, busy.filter((b) => dateStrOf(b.start) === day), duration, notBefore);
            if (slots.length) livres[`${day} (${WEEKDAYS[weekdayOf(day)]})`] = slots.slice(0, 14);
          }
          return JSON.stringify({ usuario: fullName(a.user), duracao_min: duration, horarios_livres: livres, observacao: Object.keys(livres).length ? undefined : "Sem horários livres nesse período." });
        }
        case "agendar_compromisso": {
          const a = accessFor(args.usuario_id, true);
          if (!isDate(args.data) || !isHhmm(args.hora)) throw new Error("Informe data (AAAA-MM-DD) e hora (HH:MM) válidas.");
          const titulo = String(args.titulo ?? "").trim();
          if (!titulo) throw new Error("Informe o título do compromisso.");
          const settings = parseSettings(a.user.schedule_settings);
          const duration = Math.min(480, Math.max(5, Math.floor(num(args.duracao_min) || settings.meetingDuration)));
          const { start } = await assertBookable(a, args.data, args.hora, duration);

          const tipo = args.tipo === "task" ? "task" : "meeting";
          const contactName = String(args.nome_contato ?? ctx.contactName ?? "").trim();
          const [first, ...rest] = contactName.split(/\s+/).filter(Boolean);
          const origem = `Agendado pelo agente "${agent.name}" (${ctx.channel === "whatsapp" ? "WhatsApp" : "chat"}).`;
          const extra = [contactName && `Contato: ${contactName}`, args.telefone_contato && `Telefone: ${args.telefone_contato}`, args.email_contato && `E-mail: ${args.email_contato}`].filter(Boolean).join("\n");
          const task = await createTask(
            {
              title: titulo,
              description: [String(args.descricao ?? "").trim(), extra, origem].filter(Boolean).join("\n\n"),
              user_id: a.user_id,
              due_at: args.data,
              hour_at: args.hora,
              estimated_time: minutesToHhmm(duration),
              type: tipo,
              first_name: first ?? null,
              last_name: rest.join(" ") || null,
            },
            a.user_id
          );
          const typedPhone = String(args.telefone_contato ?? "").replace(/\D/g, "");
          const waPhone = ctx.contactJid?.endsWith("@s.whatsapp.net") ? ctx.contactJid.split("@")[0].split(":")[0] : "";
          const phone = (typedPhone || waPhone).slice(0, 20);
          await prisma.task.update({ where: { id: task.id }, data: { email: args.email_contato ? String(args.email_contato).slice(0, 150) : null, phone: phone || null, is_whatsapp: ctx.channel === "whatsapp" ? true : null } }).catch(() => {});
          await log("created", a.user_id, task.id, start, contactName || null);
          notifyUser(a.user_id, {
            type: "meeting_reminder",
            title: "Novo compromisso agendado pelo agente",
            body: `${titulo} — ${args.data.split("-").reverse().join("/")} às ${args.hora}${contactName ? ` (${contactName})` : ""}`,
            link: `/task/${task.id}`,
            metadata: { taskId: task.id },
          }).catch(() => {});
          return JSON.stringify({ sucesso: true, compromisso_id: task.id, usuario: fullName(a.user), data: args.data, hora: args.hora, duracao_min: duration, link_reuniao: task.meet_uri ?? null });
        }
        case "remarcar_compromisso":
        case "cancelar_compromisso": {
          const task = await prisma.task.findFirst({ where: { id: num(args.compromisso_id), deleted_at: null } });
          const a = task ? [...byUser.values()].find((x) => x.user_id === task.user_id) : undefined;
          if (!task || !a) throw new Error("Compromisso não encontrado na agenda dos usuários liberados para este agente.");
          if (!a.can_write) throw new Error("Esta agenda é somente para consulta.");
          if (name === "cancelar_compromisso") {
            await softDeleteTask(task.id);
            await log("canceled", a.user_id, task.id, task.due_at, task.first_name);
            return JSON.stringify({ sucesso: true, cancelado: task.title });
          }
          if (!isDate(args.nova_data) || !isHhmm(args.nova_hora)) throw new Error("Informe nova_data (AAAA-MM-DD) e nova_hora (HH:MM) válidas.");
          const settings = parseSettings(a.user.schedule_settings);
          const est = task.estimated_time && /^\d{1,2}:\d{2}$/.test(task.estimated_time) ? toMinutes(task.estimated_time) : settings.meetingDuration;
          const { start } = await assertBookable(a, args.nova_data, args.nova_hora, est, task.id);
          await updateTask(task.id, { due_at: args.nova_data, hour_at: args.nova_hora }, a.user_id);
          await prisma.task.update({ where: { id: task.id }, data: { reminder_sent_at: null } }).catch(() => {});
          await log("rescheduled", a.user_id, task.id, start, task.first_name);
          return JSON.stringify({ sucesso: true, compromisso_id: task.id, nova_data: args.nova_data, nova_hora: args.nova_hora });
        }
        default:
          return null;
      }
    } catch (err: any) {
      return JSON.stringify({ sucesso: false, erro: err?.message || "Falha ao acessar a agenda." });
    }
  }

  return { definitions, execute, promptNote };
}
