import { prisma } from "../../lib/prisma";
import type { ToolDefinition } from "../../lib/ai-providers/types";
import type { ExtraToolset } from "../agent-run.service";
import { createTask, updateTask } from "../task.service";
import { listHabits, setHabitLog } from "../habit.service";
import { listNotifications, markAllRead, unreadCount } from "../notification.service";
import { WEEKDAYS, addDays, dateStrOf, dayStartUtc, hhmmOf, instantOf, isDate, isHhmm, weekdayOf } from "../agent-calendar/calendar.service";

/** Ferramentas do assistente pessoal: agem sempre como o dono do agente (nunca em nome de outro usuário). */

const STATUS_LABEL: Record<string, string> = { notdone: "a fazer", inprogress: "em andamento", review: "em revisão", done: "concluída" };
const TASK_STATUSES = ["notdone", "inprogress", "review", "done"];
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const br = (d: string) => d.split("-").reverse().join("/");

const taskScope = (userId: number) => ({ deleted_at: null, OR: [{ user_id: userId }, { taskUsers: { some: { user_id: userId } } }] });
const taskSelect = { id: true, title: true, type: true, status: true, priority: true, due_at: true, hour_at: true } as const;
type TaskRow = { id: number; title: string | null; type: string | null; status: string; priority: string | null; due_at: Date | null; hour_at: string | null };

const taskView = (t: TaskRow) => ({
  id: t.id,
  titulo: t.title,
  tipo: t.type,
  status: STATUS_LABEL[t.status] ?? t.status,
  prioridade: t.priority,
  data: t.due_at ? dateStrOf(t.due_at) : null,
  hora: t.hour_at,
});

export interface DayOverview {
  date: string;
  weekday: string;
  agenda: ReturnType<typeof taskView>[];
  dueToday: ReturnType<typeof taskView>[];
  overdue: ReturnType<typeof taskView>[];
  habitsPending: { id: number; nome: string }[];
  habitsDone: number;
  unreadNotifications: number;
  reminders: { id: number; texto: string; hora: string }[];
}

/** Retrato do dia (horário de Brasília): usado pela ferramenta resumo_do_dia e pelo briefing matinal. */
export async function buildDayOverview(userId: number, date: string = dateStrOf(new Date())): Promise<DayOverview> {
  const from = dayStartUtc(date);
  const to = dayStartUtc(addDays(date, 1));
  const [dayTasks, overdue, habits, unread, reminders] = await Promise.all([
    prisma.task.findMany({ where: { ...taskScope(userId), due_at: { gte: from, lt: to }, status: { not: "done" } }, select: taskSelect, orderBy: [{ hour_at: "asc" }, { due_at: "asc" }], take: 40 }),
    prisma.task.findMany({ where: { ...taskScope(userId), due_at: { lt: from }, status: { not: "done" }, type: "task" }, select: taskSelect, orderBy: { due_at: "desc" }, take: 15 }),
    listHabits(userId, date).catch(() => []),
    unreadCount(userId).catch(() => 0),
    prisma.assistantReminder.findMany({ where: { user_id: userId, sent_at: null, remind_at: { gte: from, lt: to } }, orderBy: { remind_at: "asc" }, take: 20 }),
  ]);
  const pending = habits.filter((h) => !h.logs.includes(date));
  return {
    date,
    weekday: WEEKDAYS[weekdayOf(date)],
    agenda: dayTasks.filter((t) => t.hour_at).map(taskView),
    dueToday: dayTasks.filter((t) => !t.hour_at).map(taskView),
    overdue: overdue.map(taskView),
    habitsPending: pending.map((h) => ({ id: h.id, nome: h.name })),
    habitsDone: habits.length - pending.length,
    unreadNotifications: unread,
    reminders: reminders.map((r) => ({ id: r.id, texto: r.text, hora: hhmmOf(r.remind_at) })),
  };
}

/** Texto do briefing (determinístico, sem custo de LLM). */
export function formatBriefing(name: string, o: DayOverview): string {
  const lines: string[] = [`${greeting()}, ${name}! Hoje é ${o.weekday}, ${br(o.date)}.`, ""];
  lines.push("📅 Agenda");
  lines.push(...(o.agenda.length ? o.agenda.map((t) => `• ${t.hora} — ${t.titulo}${t.tipo === "meeting" ? " (reunião)" : ""}`) : ["• Nada com horário marcado."]));
  if (o.dueToday.length) lines.push("", "✅ Para hoje (sem horário)", ...o.dueToday.map((t) => `• ${t.titulo}`));
  if (o.overdue.length) lines.push("", `⚠️ Atrasadas (${o.overdue.length})`, ...o.overdue.slice(0, 5).map((t) => `• ${t.titulo} (venceu em ${br(t.data ?? "")})`));
  if (o.reminders.length) lines.push("", "⏰ Lembretes", ...o.reminders.map((r) => `• ${r.hora} — ${r.texto}`));
  if (o.habitsPending.length) lines.push("", "🔁 Hábitos pendentes", ...o.habitsPending.slice(0, 8).map((h) => `• ${h.nome}`));
  if (o.unreadNotifications) lines.push("", `🔔 ${o.unreadNotifications} notificaç${o.unreadNotifications === 1 ? "ão não lida" : "ões não lidas"}.`);
  lines.push("", "Quer que eu ajuste algo?");
  return lines.join("\n");
}

function greeting() {
  const h = Number(hhmmOf(new Date()).slice(0, 2));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export function openAssistantToolset(ctx: { agentId: number; userId: number; chatId?: string | null; userName: string }): ExtraToolset & { promptNote: string } {
  const now = new Date();
  const promptNote = `Você é o assistente pessoal de ${ctx.userName} no Collab Suite e conversa pelo Telegram.
Data e hora atuais (Brasília): ${dateStrOf(now)} (${WEEKDAYS[weekdayOf(dateStrOf(now))]}) ${hhmmOf(now)}. Use datas AAAA-MM-DD e horas HH:MM nas ferramentas.
Estilo: português do Brasil, mensagens curtas e diretas, sem enrolação; listas simples com "•". Não use Markdown (o Telegram mostra o texto cru).
Regras: use as ferramentas em vez de supor (agenda, tarefas, hábitos, lembretes, notificações). Quando o pedido for ambíguo (data/hora faltando), pergunte antes de criar. Para apagar/cancelar algo ou remarcar compromissos com outras pessoas, confirme com ${ctx.userName} antes. Depois de executar, confirme em uma frase o que foi feito.`;

  const definitions: ToolDefinition[] = [
    {
      name: "resumo_do_dia",
      description: "Resumo do dia: agenda com horário, tarefas do dia, atrasadas, lembretes, hábitos pendentes e notificações não lidas.",
      parameters: { type: "object", properties: { data: { type: "string", description: "AAAA-MM-DD (padrão: hoje)" } } },
    },
    {
      name: "listar_tarefas",
      description: "Lista as tarefas do usuário por filtro.",
      parameters: {
        type: "object",
        properties: {
          filtro: { type: "string", enum: ["hoje", "atrasadas", "semana", "abertas"], description: "padrão: abertas" },
          limite: { type: "number", description: "máximo de itens (padrão 20)" },
        },
      },
    },
    {
      name: "criar_tarefa",
      description: "Cria uma tarefa para o usuário (com data e hora opcionais).",
      parameters: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          data: { type: "string", description: "AAAA-MM-DD (opcional)" },
          hora: { type: "string", description: "HH:MM (opcional, exige data)" },
          prioridade: { type: "string", enum: ["low", "medium", "high"] },
          descricao: { type: "string" },
        },
        required: ["titulo"],
      },
    },
    {
      name: "atualizar_tarefa",
      description: "Muda o status, o título ou a data/hora de uma tarefa do usuário (use listar_tarefas para achar o id).",
      parameters: {
        type: "object",
        properties: {
          tarefa_id: { type: "number" },
          status: { type: "string", enum: TASK_STATUSES, description: "notdone, inprogress, review ou done" },
          titulo: { type: "string" },
          data: { type: "string", description: "AAAA-MM-DD" },
          hora: { type: "string", description: "HH:MM" },
        },
        required: ["tarefa_id"],
      },
    },
    { name: "listar_habitos", description: "Lista os hábitos/rotinas do usuário e se já foram feitos hoje.", parameters: { type: "object", properties: {} } },
    {
      name: "marcar_habito",
      description: "Marca (ou desmarca) um hábito como feito em um dia.",
      parameters: {
        type: "object",
        properties: { habito_id: { type: "number" }, feito: { type: "boolean", description: "padrão true" }, data: { type: "string", description: "AAAA-MM-DD (padrão hoje)" } },
        required: ["habito_id"],
      },
    },
    {
      name: "criar_lembrete",
      description: "Agenda um lembrete que será enviado ao usuário no Telegram na data e hora indicadas.",
      parameters: {
        type: "object",
        properties: { texto: { type: "string" }, data: { type: "string", description: "AAAA-MM-DD" }, hora: { type: "string", description: "HH:MM" } },
        required: ["texto", "data", "hora"],
      },
    },
    { name: "listar_lembretes", description: "Lista os lembretes pendentes do usuário.", parameters: { type: "object", properties: {} } },
    {
      name: "cancelar_lembrete",
      description: "Cancela um lembrete pendente.",
      parameters: { type: "object", properties: { lembrete_id: { type: "number" } }, required: ["lembrete_id"] },
    },
    {
      name: "ver_notificacoes",
      description: "Lista as notificações recentes do usuário no Collab Suite.",
      parameters: { type: "object", properties: { apenas_nao_lidas: { type: "boolean" }, limite: { type: "number" } } },
    },
    { name: "marcar_notificacoes_lidas", description: "Marca todas as notificações do usuário como lidas.", parameters: { type: "object", properties: {} } },
  ];

  const ownedTask = async (id: unknown) => {
    const t = await prisma.task.findFirst({ where: { id: num(id), ...taskScope(ctx.userId) }, select: { ...taskSelect, estimated_time: true } });
    if (!t) throw new Error("Tarefa não encontrada entre as tarefas deste usuário.");
    return t;
  };

  async function execute(name: string, args: Record<string, unknown>): Promise<string | null> {
    try {
      switch (name) {
        case "resumo_do_dia": {
          const date = isDate(args.data) ? args.data : dateStrOf(new Date());
          return JSON.stringify(await buildDayOverview(ctx.userId, date));
        }
        case "listar_tarefas": {
          const today = dateStrOf(new Date());
          const limit = Math.min(50, Math.max(1, Math.floor(num(args.limite) || 20)));
          const filtro = String(args.filtro ?? "abertas");
          const where: Record<string, unknown> = { ...taskScope(ctx.userId), status: { not: "done" }, type: { not: "note" } };
          if (filtro === "hoje") where.due_at = { gte: dayStartUtc(today), lt: dayStartUtc(addDays(today, 1)) };
          else if (filtro === "atrasadas") where.due_at = { lt: dayStartUtc(today) };
          else if (filtro === "semana") where.due_at = { gte: dayStartUtc(today), lt: dayStartUtc(addDays(today, 7)) };
          const rows = await prisma.task.findMany({ where, select: taskSelect, orderBy: [{ due_at: "asc" }, { id: "desc" }], take: limit });
          return JSON.stringify({ filtro, total: rows.length, tarefas: rows.map(taskView) });
        }
        case "criar_tarefa": {
          const titulo = String(args.titulo ?? "").trim();
          if (!titulo) throw new Error("Informe o título da tarefa.");
          if (args.data !== undefined && !isDate(args.data)) throw new Error("data inválida (use AAAA-MM-DD).");
          if (args.hora !== undefined && !isHhmm(args.hora)) throw new Error("hora inválida (use HH:MM).");
          if (args.hora && !args.data) throw new Error("Para definir a hora, informe também a data.");
          const priority = ["low", "medium", "high"].includes(String(args.prioridade)) ? String(args.prioridade) : undefined;
          const task = await createTask(
            { title: titulo.slice(0, 255), description: String(args.descricao ?? "").trim() || undefined, user_id: ctx.userId, due_at: args.data as string | undefined, hour_at: args.hora as string | undefined, type: "task", priority },
            ctx.userId
          );
          return JSON.stringify({ sucesso: true, tarefa: taskView(task as unknown as TaskRow) });
        }
        case "atualizar_tarefa": {
          const task = await ownedTask(args.tarefa_id);
          const data: Record<string, unknown> = {};
          if (args.status !== undefined) {
            if (!TASK_STATUSES.includes(String(args.status))) throw new Error("status inválido.");
            data.status = args.status;
          }
          if (args.titulo !== undefined && String(args.titulo).trim()) data.title = String(args.titulo).trim().slice(0, 255);
          if (args.data !== undefined) {
            if (!isDate(args.data)) throw new Error("data inválida (use AAAA-MM-DD).");
            data.due_at = args.data;
          }
          if (args.hora !== undefined) {
            if (!isHhmm(args.hora)) throw new Error("hora inválida (use HH:MM).");
            data.hour_at = args.hora;
          }
          if (!Object.keys(data).length) throw new Error("Nada para atualizar.");
          await updateTask(task.id, data, ctx.userId);
          const fresh = await prisma.task.findUnique({ where: { id: task.id }, select: taskSelect });
          return JSON.stringify({ sucesso: true, tarefa: fresh ? taskView(fresh) : null });
        }
        case "listar_habitos": {
          const today = dateStrOf(new Date());
          const habits = await listHabits(ctx.userId, today);
          return JSON.stringify({
            data: today,
            habitos: habits.map((h) => ({ id: h.id, nome: h.name, tipo: h.kind, feito_hoje: h.logs.includes(today), sequencia: h.streak, lembrete: h.reminder_time })),
          });
        }
        case "marcar_habito": {
          const day = args.data === undefined ? dateStrOf(new Date()) : isDate(args.data) ? args.data : null;
          if (!day) throw new Error("data inválida (use AAAA-MM-DD).");
          const view = await setHabitLog(num(args.habito_id), ctx.userId, day, args.feito !== false, dateStrOf(new Date()));
          return JSON.stringify({ sucesso: true, habito: view.name, data: day, feito: view.logs.includes(day), sequencia: view.streak });
        }
        case "criar_lembrete": {
          const texto = String(args.texto ?? "").trim();
          if (!texto) throw new Error("Informe o texto do lembrete.");
          if (!isDate(args.data) || !isHhmm(args.hora)) throw new Error("Informe data (AAAA-MM-DD) e hora (HH:MM) válidas.");
          const at = instantOf(args.data, args.hora);
          if (at.getTime() <= Date.now()) throw new Error("Esse horário já passou.");
          const row = await prisma.assistantReminder.create({ data: { agent_id: ctx.agentId, user_id: ctx.userId, chat_id: ctx.chatId ?? null, text: texto.slice(0, 500), remind_at: at } });
          return JSON.stringify({ sucesso: true, lembrete_id: row.id, data: args.data, hora: args.hora });
        }
        case "listar_lembretes": {
          const rows = await prisma.assistantReminder.findMany({ where: { user_id: ctx.userId, sent_at: null, remind_at: { gte: new Date() } }, orderBy: { remind_at: "asc" }, take: 30 });
          return JSON.stringify({ lembretes: rows.map((r) => ({ id: r.id, texto: r.text, data: dateStrOf(r.remind_at), hora: hhmmOf(r.remind_at) })) });
        }
        case "cancelar_lembrete": {
          const res = await prisma.assistantReminder.deleteMany({ where: { id: num(args.lembrete_id), user_id: ctx.userId, sent_at: null } });
          if (!res.count) throw new Error("Lembrete pendente não encontrado.");
          return JSON.stringify({ sucesso: true });
        }
        case "ver_notificacoes": {
          const limit = Math.min(20, Math.max(1, Math.floor(num(args.limite) || 10)));
          const rows = await listNotifications(ctx.userId, { limit: args.apenas_nao_lidas ? 50 : limit });
          const list = (args.apenas_nao_lidas ? rows.filter((n) => !n.read_at) : rows).slice(0, limit);
          return JSON.stringify({ nao_lidas: await unreadCount(ctx.userId), notificacoes: list.map((n) => ({ titulo: n.title, texto: n.body, quando: `${dateStrOf(n.created_at)} ${hhmmOf(n.created_at)}`, lida: !!n.read_at })) });
        }
        case "marcar_notificacoes_lidas": {
          await markAllRead(ctx.userId);
          return JSON.stringify({ sucesso: true });
        }
        default:
          return null;
      }
    } catch (err: any) {
      return JSON.stringify({ sucesso: false, erro: err?.message || "Falha ao executar a ferramenta." });
    }
  }

  return { definitions, execute, promptNote };
}
