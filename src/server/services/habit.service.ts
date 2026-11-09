import { prisma } from "../lib/prisma";
import { assertProjectMember } from "./access.service";

/**
 * Hábitos diários.
 *
 * Datas de check-in são "dias de calendário" do usuário (YYYY-MM-DD), enviadas pelo cliente
 * — o servidor nunca converte para fuso horário, só grava/lê o dia (coluna DATE, UTC 00:00).
 * Sequência ("streak"):
 *  - hábito diário (target_per_week = 7): dias consecutivos;
 *  - hábito "N vezes por semana" (1–6): semanas consecutivas (domingo–sábado) com a meta batida.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Quantos dias de check-ins vão no payload (26 semanas do mapa de calor + a semana atual). */
const LOG_WINDOW_DAYS = 200;

export type HabitKind = "habit" | "routine";

export interface HabitInput {
  name: string;
  description?: string | null;
  color?: string;
  target_per_week?: number;
  kind?: HabitKind;
  project_id?: number | null;
  /** HH:MM (horário de Brasília). null remove o lembrete. */
  reminder_time?: string | null;
  /** Dias do lembrete (0 = domingo … 6 = sábado). null/vazio = todos os dias. */
  reminder_days?: number[] | null;
  /** Passos da rotina. */
  checklist?: string[] | null;
  /** Liga o hábito a uma meta de Saúde: é marcado sozinho quando a meta do dia é batida. */
  health_metric?: HealthMetric | null;
}

export const HEALTH_METRICS = ["steps", "water", "sleep", "workout"] as const;
export type HealthMetric = (typeof HEALTH_METRICS)[number];

export interface HabitView {
  id: number;
  name: string;
  description: string | null;
  color: string;
  target_per_week: number;
  created_at: string;
  streak: number;
  best_streak: number;
  streak_unit: "days" | "weeks";
  rate_30: number;
  logs: string[];
  kind: HabitKind;
  project_id: number | null;
  project: { id: number; name: string; color: string | null } | null;
  reminder_time: string | null;
  reminder_days: number[] | null;
  checklist: string[];
  health_metric: HealthMetric | null;
  /** Preenchido quando o hábito foi atribuído por um gestor (definição somente leitura). */
  team: { id: number; creator_name: string } | null;
}

// ── campos de lembrete/checklist ──

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeReminderTime(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!TIME_RE.test(value)) throw new Error("Horário do lembrete inválido (use HH:MM).");
  return value;
}

export function serializeDays(days: number[] | null | undefined): string | null {
  if (!days || days.length === 0) return null;
  const unique = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return unique.length === 0 || unique.length >= 7 ? null : unique.join(",");
}

export function parseDays(raw: string | null): number[] | null {
  if (!raw) return null;
  const days = raw.split(",").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return days.length ? days : null;
}

export function serializeChecklist(items: string[] | null | undefined): string | null {
  const clean = (items ?? []).map((i) => i.trim()).filter(Boolean).slice(0, 20).map((i) => i.slice(0, 200));
  return clean.length ? JSON.stringify(clean) : null;
}

export function parseChecklist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// ── helpers de data (tudo em UTC, sobre strings YYYY-MM-DD) ──

export function toDbDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  return fmt(new Date(toDbDate(day).getTime() + amount * DAY_MS));
}

function diffDays(from: string, to: string): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS);
}

/** Domingo da semana que contém o dia (a semana do design vai de Dom a Sáb). */
export function weekStart(day: string): string {
  return addDays(day, -toDbDate(day).getUTCDay());
}

export function todayUtc(): string {
  return fmt(new Date());
}

// ── estatísticas ──

function longestRun(sortedKeys: string[], stepDays: number): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of sortedKeys) {
    run = prev !== null && diffDays(prev, key) === stepDays ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}

export function computeStats(targetPerWeek: number, createdDay: string, sortedDates: string[], today: string) {
  const set = new Set(sortedDates);
  let streak = 0;
  let best = 0;
  let unit: "days" | "weeks" = "days";

  if (targetPerWeek >= 7) {
    // O dia de hoje ainda pode ser cumprido: se não está marcado, a sequência conta a partir de ontem.
    let cursor = set.has(today) ? today : addDays(today, -1);
    while (set.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    best = longestRun(sortedDates, 1);
  } else {
    unit = "weeks";
    const perWeek = new Map<string, number>();
    for (const day of sortedDates) {
      const key = weekStart(day);
      perWeek.set(key, (perWeek.get(key) ?? 0) + 1);
    }
    const metWeeks = [...perWeek.entries()].filter(([, count]) => count >= targetPerWeek).map(([key]) => key).sort();
    const met = new Set(metWeeks);
    let cursor = weekStart(today);
    if (!met.has(cursor)) cursor = addDays(cursor, -7); // semana atual ainda em andamento
    while (met.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -7);
    }
    best = longestRun(metWeeks, 7);
  }

  // Taxa dos últimos 30 dias, sem penalizar dias anteriores à criação do hábito.
  let windowStart = addDays(today, -29);
  if (createdDay > windowStart) windowStart = createdDay;
  if (windowStart > today) windowStart = today;
  const windowDays = diffDays(windowStart, today) + 1;
  const done = sortedDates.filter((d) => d >= windowStart && d <= today).length;
  const expected = targetPerWeek >= 7 ? windowDays : Math.max(1, Math.round((windowDays * targetPerWeek) / 7));
  const rate30 = Math.min(100, Math.round((done / expected) * 100));

  return { streak, best_streak: best, streak_unit: unit, rate_30: rate30 };
}

/** Linha de `habit` com as relações que o `buildView` usa para montar o payload. */
export type HabitRow = {
  id: number;
  name: string;
  description: string | null;
  color: string;
  target_per_week: number;
  created_at: Date;
  kind: string;
  project_id: number | null;
  reminder_time: string | null;
  reminder_days: string | null;
  checklist: string | null;
  health_metric?: string | null;
  team_habit_id: number | null;
  project?: { id: number; name: string | null; color: string | null } | null;
  teamHabit?: { id: number; creator: { first_name: string; last_name: string | null } } | null;
};

export const HABIT_INCLUDE = {
  project: { select: { id: true, name: true, color: true } },
  teamHabit: { select: { id: true, creator: { select: { first_name: true, last_name: true } } } },
} as const;

export function buildView(habit: HabitRow, sortedDates: string[], today: string): HabitView {
  const stats = computeStats(habit.target_per_week, fmt(habit.created_at), sortedDates, today);
  const windowStart = addDays(today, -LOG_WINDOW_DAYS);
  return {
    id: habit.id,
    name: habit.name,
    description: habit.description,
    color: habit.color,
    target_per_week: habit.target_per_week,
    created_at: habit.created_at.toISOString(),
    ...stats,
    logs: sortedDates.filter((d) => d >= windowStart),
    kind: habit.kind === "routine" ? "routine" : "habit",
    project_id: habit.project_id,
    project: habit.project ? { id: habit.project.id, name: habit.project.name ?? "", color: habit.project.color } : null,
    reminder_time: habit.reminder_time,
    reminder_days: parseDays(habit.reminder_days),
    checklist: parseChecklist(habit.checklist),
    health_metric: (HEALTH_METRICS as readonly string[]).includes(habit.health_metric ?? "") ? (habit.health_metric as HealthMetric) : null,
    team: habit.teamHabit
      ? { id: habit.teamHabit.id, creator_name: `${habit.teamHabit.creator.first_name} ${habit.teamHabit.creator.last_name ?? ""}`.trim() }
      : null,
  };
}

export async function loadLogs(habitIds: number[]): Promise<Map<number, string[]>> {
  const byHabit = new Map<number, string[]>();
  if (habitIds.length === 0) return byHabit;
  const rows = await prisma.habitLog.findMany({
    where: { habit_id: { in: habitIds } },
    select: { habit_id: true, log_date: true },
    orderBy: { log_date: "asc" },
  });
  for (const row of rows) {
    const list = byHabit.get(row.habit_id) ?? [];
    list.push(fmt(row.log_date));
    byHabit.set(row.habit_id, list);
  }
  return byHabit;
}

async function findOwnedHabit(habitId: number, userId: number) {
  const habit = await prisma.habit.findFirst({ where: { id: habitId, user_id: userId } });
  if (!habit) {
    throw new Error("Hábito não encontrado ou você não tem acesso a ele.");
  }
  return habit;
}

// ── operações ──

export async function listHabits(userId: number, today: string = todayUtc()): Promise<HabitView[]> {
  const habits = await prisma.habit.findMany({
    where: { user_id: userId, archived_at: null },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    include: HABIT_INCLUDE,
  });
  const logs = await loadLogs(habits.map((h) => h.id));
  return habits.map((h) => buildView(h, logs.get(h.id) ?? [], today));
}

async function viewFor(habitId: number, today: string): Promise<HabitView> {
  const habit = await prisma.habit.findUniqueOrThrow({ where: { id: habitId }, include: HABIT_INCLUDE });
  const logs = await loadLogs([habitId]);
  return buildView(habit, logs.get(habitId) ?? [], today);
}

export async function createHabit(userId: number, companyId: number | null, data: HabitInput, today: string = todayUtc()) {
  if (data.project_id) await assertProjectMember(data.project_id, userId);
  const last = await prisma.habit.findFirst({
    where: { user_id: userId },
    orderBy: { sort_order: "desc" },
    select: { sort_order: true },
  });
  const habit = await prisma.habit.create({
    data: {
      user_id: userId,
      company_id: companyId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      color: data.color ?? "#EC1889",
      target_per_week: data.target_per_week ?? 7,
      kind: data.kind ?? "habit",
      project_id: data.project_id ?? null,
      reminder_time: normalizeReminderTime(data.reminder_time),
      reminder_days: serializeDays(data.reminder_days),
      checklist: serializeChecklist(data.checklist),
      health_metric: data.health_metric ?? null,
      sort_order: (last?.sort_order ?? 0) + 1,
    },
  });
  return viewFor(habit.id, today);
}

export async function updateHabit(
  habitId: number,
  userId: number,
  data: Partial<HabitInput> & { archived?: boolean },
  today: string = todayUtc()
) {
  const existing = await findOwnedHabit(habitId, userId);
  if (existing.team_habit_id) {
    throw new Error("Este hábito foi atribuído pela equipe e só pode ser alterado por quem o criou.");
  }
  if (data.project_id) await assertProjectMember(data.project_id, userId);
  await prisma.habit.update({
    where: { id: habitId },
    data: {
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.project_id !== undefined ? { project_id: data.project_id } : {}),
      ...(data.reminder_time !== undefined ? { reminder_time: normalizeReminderTime(data.reminder_time), last_reminded_on: null } : {}),
      ...(data.reminder_days !== undefined ? { reminder_days: serializeDays(data.reminder_days) } : {}),
      ...(data.checklist !== undefined ? { checklist: serializeChecklist(data.checklist) } : {}),
      ...(data.health_metric !== undefined ? { health_metric: data.health_metric } : {}),
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.target_per_week !== undefined ? { target_per_week: data.target_per_week } : {}),
      ...(data.archived !== undefined ? { archived_at: data.archived ? new Date() : null } : {}),
    },
  });
  return viewFor(habitId, today);
}

export async function deleteHabit(habitId: number, userId: number) {
  const existing = await findOwnedHabit(habitId, userId);
  if (existing.team_habit_id) {
    throw new Error("Este hábito foi atribuído pela equipe e só pode ser removido por quem o criou.");
  }
  await prisma.habit.delete({ where: { id: habitId } });
  return { success: true };
}

/** Marca/desmarca o hábito em um dia. Idempotente: repetir a mesma chamada não muda o resultado. */
export async function setHabitLog(habitId: number, userId: number, day: string, done: boolean, today: string = todayUtc()) {
  await findOwnedHabit(habitId, userId);

  // Tolera 1 dia à frente do relógio do servidor por causa de fuso horário; futuro além disso não vale.
  if (day > addDays(todayUtc(), 1)) {
    throw new Error("Não é possível registrar um hábito em uma data futura.");
  }

  if (done) {
    await prisma.habitLog.upsert({
      where: { habit_id_log_date: { habit_id: habitId, log_date: toDbDate(day) } },
      create: { habit_id: habitId, log_date: toDbDate(day) },
      update: {},
    });
  } else {
    await prisma.habitLog.deleteMany({ where: { habit_id: habitId, log_date: toDbDate(day) } });
  }
  return viewFor(habitId, today);
}
