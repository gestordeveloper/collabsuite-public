import { prisma } from "../lib/prisma";
import { addDays, loadLogs, toDbDate, todayUtc } from "./habit.service";

/**
 * Resumo semanal (domingo a sábado, igual ao resto da tela de hábitos): hábitos cumpridos, tarefas
 * entregues e atrasadas, foco do dia e — para quem gerencia — a aderência da equipe.
 */

const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Instante UTC em que o dia (calendário de Brasília) começa. */
function brtDayStart(day: string): Date {
  return new Date(toDbDate(day).getTime() + BRAZIL_OFFSET_MS);
}

export interface WeeklySummary {
  week_start: string;
  week_end: string;
  in_progress: boolean;
  habits: {
    overall_pct: number;
    previous_pct: number | null;
    items: { id: number; name: string; color: string; done: number; target: number; pct: number; streak_hint: boolean }[];
  };
  tasks: {
    completed: number;
    completed_titles: { id: number; title: string }[];
    overdue: number;
    overdue_list: { id: number; title: string; due_at: string }[];
    due_next_7_days: number;
  };
  focus: { days_planned: number; items_total: number; items_done: number; reviews: number };
  team: { id: number; name: string; avg_pct: number; behind: string[] }[];
  highlights: string[];
}

function weekPct(
  habits: { id: number; target_per_week: number; created_at: Date }[],
  logs: Map<number, string[]>,
  from: string,
  to: string
): { pct: number; per: Map<number, number> } {
  const per = new Map<number, number>();
  let done = 0;
  let target = 0;
  for (const h of habits) {
    if (h.created_at.toISOString().slice(0, 10) > to) continue; // ainda não existia
    const count = (logs.get(h.id) ?? []).filter((d) => d >= from && d <= to).length;
    per.set(h.id, count);
    done += Math.min(count, h.target_per_week);
    target += h.target_per_week;
  }
  return { pct: target === 0 ? 0 : Math.round((done / target) * 100), per };
}

export async function buildWeeklySummary(userId: number, weekStartDay: string, today: string = todayUtc()): Promise<WeeklySummary> {
  const weekEnd = addDays(weekStartDay, 6);
  const prevStart = addDays(weekStartDay, -7);
  const prevEnd = addDays(weekStartDay, -1);
  const inProgress = today >= weekStartDay && today <= weekEnd;

  // ── hábitos ──
  const habits = await prisma.habit.findMany({
    where: { user_id: userId, archived_at: null },
    select: { id: true, name: true, color: true, target_per_week: true, created_at: true },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
  });
  const logs = await loadLogs(habits.map((h) => h.id));
  const current = weekPct(habits, logs, weekStartDay, weekEnd);
  const previous = weekPct(habits, logs, prevStart, prevEnd);
  const items = habits
    .filter((h) => current.per.has(h.id))
    .map((h) => {
      const done = current.per.get(h.id) ?? 0;
      return {
        id: h.id,
        name: h.name,
        color: h.color,
        done,
        target: h.target_per_week,
        pct: Math.min(100, Math.round((done / h.target_per_week) * 100)),
        streak_hint: done >= h.target_per_week,
      };
    });

  // ── tarefas ──
  const rangeStart = brtDayStart(weekStartDay);
  const rangeEnd = new Date(rangeStart.getTime() + 7 * DAY_MS);
  const todayStart = brtDayStart(today);
  const mine = { deleted_at: null, type: { not: "note" as const }, OR: [{ user_id: userId }, { taskUsers: { some: { user_id: userId } } }] };

  const [completed, overdue, dueNext] = await Promise.all([
    prisma.task.findMany({
      where: { ...mine, status: "done", closed_at: { gte: rangeStart, lt: rangeEnd } },
      select: { id: true, title: true },
      orderBy: { closed_at: "desc" },
      take: 200,
    }),
    prisma.task.findMany({
      where: { ...mine, status: { not: "done" }, due_at: { lt: todayStart } },
      select: { id: true, title: true, due_at: true },
      orderBy: { due_at: "asc" },
      take: 200,
    }),
    prisma.task.count({
      where: { ...mine, status: { not: "done" }, due_at: { gte: todayStart, lt: new Date(todayStart.getTime() + 7 * DAY_MS) } },
    }),
  ]);

  // ── foco ──
  const focusRows = await prisma.dailyFocus.findMany({
    where: { user_id: userId, focus_date: { gte: toDbDate(weekStartDay), lte: toDbDate(weekEnd) } },
    select: { items: true, review: true },
  });
  let itemsTotal = 0;
  let itemsDone = 0;
  let daysPlanned = 0;
  for (const row of focusRows) {
    try {
      const list = JSON.parse(row.items) as { done?: boolean }[];
      if (list.length) daysPlanned++;
      itemsTotal += list.length;
      itemsDone += list.filter((i) => i.done).length;
    } catch {
      /* linha antiga/inválida: ignora */
    }
  }

  // ── equipe (só para quem criou hábitos de equipe) ──
  const teams = await prisma.teamHabit.findMany({
    where: { creator_id: userId },
    include: { habits: { where: { archived_at: null }, include: { user: { select: { first_name: true, last_name: true } } } } },
  });
  const teamLogs = await loadLogs(teams.flatMap((t) => t.habits.map((h) => h.id)));
  const team = teams
    .filter((t) => t.habits.length > 0)
    .map((t) => {
      const memberPcts = t.habits.map((h) => {
        const count = (teamLogs.get(h.id) ?? []).filter((d) => d >= weekStartDay && d <= weekEnd).length;
        return { name: `${h.user.first_name} ${h.user.last_name ?? ""}`.trim(), pct: Math.min(100, Math.round((count / h.target_per_week) * 100)) };
      });
      return {
        id: t.id,
        name: t.name,
        avg_pct: Math.round(memberPcts.reduce((s, m) => s + m.pct, 0) / memberPcts.length),
        behind: memberPcts.filter((m) => m.pct < 50).map((m) => m.name),
      };
    });

  // ── destaques em texto (também usados na notificação de segunda-feira) ──
  const highlights: string[] = [];
  if (habits.length) {
    const delta = prevHasData(habits, logs, prevStart, prevEnd) ? current.pct - previous.pct : null;
    highlights.push(
      `Hábitos: ${current.pct}% da meta cumprida${delta === null ? "" : ` (${delta >= 0 ? "+" : ""}${delta} pts vs. semana anterior)`}.`
    );
    const weakest = [...items].sort((a, b) => a.pct - b.pct)[0];
    if (weakest && weakest.pct < 50) highlights.push(`Ponto de atenção: “${weakest.name}” ficou em ${weakest.done}/${weakest.target}.`);
  }
  highlights.push(`Tarefas concluídas: ${completed.length}.`);
  if (overdue.length) highlights.push(`${overdue.length} ${overdue.length === 1 ? "tarefa atrasada" : "tarefas atrasadas"} aguardando você.`);
  if (itemsTotal) highlights.push(`Foco do dia: ${itemsDone} de ${itemsTotal} prioridades cumpridas.`);
  for (const t of team) {
    if (t.behind.length) highlights.push(`Equipe — “${t.name}”: ${t.avg_pct}% de aderência; abaixo de 50%: ${t.behind.join(", ")}.`);
  }

  return {
    week_start: weekStartDay,
    week_end: weekEnd,
    in_progress: inProgress,
    habits: { overall_pct: current.pct, previous_pct: prevHasData(habits, logs, prevStart, prevEnd) ? previous.pct : null, items },
    tasks: {
      completed: completed.length,
      completed_titles: completed.slice(0, 5).map((t) => ({ id: t.id, title: t.title ?? "Sem título" })),
      overdue: overdue.length,
      overdue_list: overdue.slice(0, 5).map((t) => ({ id: t.id, title: t.title ?? "Sem título", due_at: t.due_at!.toISOString() })),
      due_next_7_days: dueNext,
    },
    focus: { days_planned: daysPlanned, items_total: itemsTotal, items_done: itemsDone, reviews: focusRows.filter((r) => r.review).length },
    team,
    highlights,
  };
}

/** A semana anterior só entra na comparação se algum hábito já existia nela. */
function prevHasData(habits: { created_at: Date }[], _logs: Map<number, string[]>, _from: string, to: string): boolean {
  return habits.some((h) => h.created_at.toISOString().slice(0, 10) <= to);
}
