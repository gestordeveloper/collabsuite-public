import { prisma } from "../lib/prisma";
import { notifyUsers } from "./notification.service";
import { assertProjectMember } from "./access.service";
import {
  addDays,
  computeStats,
  fmt,
  loadLogs,
  normalizeReminderTime,
  parseChecklist,
  parseDays,
  serializeChecklist,
  serializeDays,
  todayUtc,
  weekStart,
  type HabitKind,
} from "./habit.service";

/**
 * Hábitos e rotinas de equipe: o gestor define uma vez (TeamHabit) e atribui a pessoas; cada pessoa
 * recebe a sua própria linha em `habit`, então check-ins e sequências continuam individuais.
 * O gestor acompanha a aderência de todos num quadro e pode "cobrar" quem ainda não cumpriu hoje.
 */

export interface TeamHabitInput {
  name: string;
  description?: string | null;
  color?: string;
  target_per_week?: number;
  kind?: HabitKind;
  project_id?: number | null;
  reminder_time?: string | null;
  reminder_days?: number[] | null;
  checklist?: string[] | null;
  assignee_ids?: number[];
}

const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;
const lastNudge = new Map<number, number>();

const fullName = (u: { first_name: string; last_name: string | null }) => `${u.first_name} ${u.last_name ?? ""}`.trim();

// ── quem pode ser atribuído ──

/** Pessoas que compartilham ao menos um projeto com o gestor (dono ou membro). */
export async function listCandidates(userId: number) {
  const projects = await prisma.project.findMany({
    where: { OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] },
    select: { user_id: true, projectUsers: { select: { user_id: true } } },
  });
  const ids = new Set<number>([userId]);
  for (const p of projects) {
    if (p.user_id) ids.add(p.user_id);
    for (const pu of p.projectUsers) if (pu.user_id) ids.add(pu.user_id);
  }
  return prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, first_name: true, last_name: true, photo: true, email: true },
    orderBy: { first_name: "asc" },
  });
}

async function assertAssignable(creatorId: number, assigneeIds: number[]) {
  const allowed = new Set((await listCandidates(creatorId)).map((u) => u.id));
  const invalid = assigneeIds.filter((id) => !allowed.has(id));
  if (invalid.length) throw new Error("Só é possível atribuir hábitos a pessoas que participam de algum dos seus projetos.");
}

async function nextSortOrder(userId: number): Promise<number> {
  const last = await prisma.habit.findFirst({ where: { user_id: userId }, orderBy: { sort_order: "desc" }, select: { sort_order: true } });
  return (last?.sort_order ?? 0) + 1;
}

type TeamHabitRow = NonNullable<Awaited<ReturnType<typeof prisma.teamHabit.findFirst>>>;

function habitFieldsFrom(team: TeamHabitRow) {
  return {
    name: team.name,
    description: team.description,
    color: team.color,
    target_per_week: team.target_per_week,
    kind: team.kind,
    project_id: team.project_id,
    reminder_time: team.reminder_time,
    reminder_days: team.reminder_days,
    checklist: team.checklist,
  };
}

async function findOwnedTeamHabit(id: number, creatorId: number) {
  const team = await prisma.teamHabit.findFirst({ where: { id, creator_id: creatorId } });
  if (!team) throw new Error("Hábito de equipe não encontrado ou você não tem acesso a ele.");
  return team;
}

async function assignTo(team: TeamHabitRow, userIds: number[], creatorId: number, creatorName: string) {
  for (const uid of userIds) {
    const existing = await prisma.habit.findFirst({ where: { user_id: uid, team_habit_id: team.id } });
    if (existing) {
      // Já esteve na equipe e foi removido: reativa em vez de duplicar (preserva o histórico).
      if (existing.archived_at) await prisma.habit.update({ where: { id: existing.id }, data: { archived_at: null, ...habitFieldsFrom(team) } });
      continue;
    }
    await prisma.habit.create({
      data: { user_id: uid, company_id: team.company_id, team_habit_id: team.id, sort_order: await nextSortOrder(uid), ...habitFieldsFrom(team) },
    });
  }
  const toNotify = userIds.filter((id) => id !== creatorId);
  if (toNotify.length) {
    await notifyUsers(toNotify, {
      type: "habit_reminder",
      title: `Novo ${team.kind === "routine" ? "rotina" : "hábito"} da equipe: ${team.name}`,
      body: `${creatorName} atribuiu a você${team.reminder_time ? ` — lembrete às ${team.reminder_time}` : ""}.`,
      link: "/habitos",
      metadata: { teamHabitId: team.id },
    });
  }
}

// ── CRUD ──

export async function createTeamHabit(creatorId: number, companyId: number | null, data: TeamHabitInput) {
  const assignees = [...new Set(data.assignee_ids ?? [])];
  if (assignees.length === 0) throw new Error("Escolha ao menos uma pessoa da equipe.");
  if (data.project_id) await assertProjectMember(data.project_id, creatorId);
  await assertAssignable(creatorId, assignees);

  const creator = await prisma.user.findUniqueOrThrow({ where: { id: creatorId }, select: { first_name: true, last_name: true } });
  const team = await prisma.teamHabit.create({
    data: {
      company_id: companyId,
      creator_id: creatorId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      color: data.color ?? "#EC1889",
      target_per_week: data.target_per_week ?? 7,
      kind: data.kind ?? "habit",
      project_id: data.project_id ?? null,
      reminder_time: normalizeReminderTime(data.reminder_time),
      reminder_days: serializeDays(data.reminder_days),
      checklist: serializeChecklist(data.checklist),
    },
  });
  await assignTo(team, assignees, creatorId, fullName(creator));
  return { id: team.id };
}

export async function updateTeamHabit(id: number, creatorId: number, data: Partial<TeamHabitInput>) {
  const current = await findOwnedTeamHabit(id, creatorId);
  if (data.project_id) await assertProjectMember(data.project_id, creatorId);
  const assignees = data.assignee_ids ? [...new Set(data.assignee_ids)] : null;
  if (assignees) {
    if (assignees.length === 0) throw new Error("Escolha ao menos uma pessoa da equipe.");
    await assertAssignable(creatorId, assignees);
  }

  const reminderChanged = data.reminder_time !== undefined && normalizeReminderTime(data.reminder_time) !== current.reminder_time;
  const team = await prisma.teamHabit.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.target_per_week !== undefined ? { target_per_week: data.target_per_week } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.project_id !== undefined ? { project_id: data.project_id } : {}),
      ...(data.reminder_time !== undefined ? { reminder_time: normalizeReminderTime(data.reminder_time) } : {}),
      ...(data.reminder_days !== undefined ? { reminder_days: serializeDays(data.reminder_days) } : {}),
      ...(data.checklist !== undefined ? { checklist: serializeChecklist(data.checklist) } : {}),
    },
  });

  // Propaga a definição para quem já recebeu.
  await prisma.habit.updateMany({
    where: { team_habit_id: id },
    data: { ...habitFieldsFrom(team), ...(reminderChanged ? { last_reminded_on: null } : {}) },
  });

  if (assignees) {
    const active = await prisma.habit.findMany({ where: { team_habit_id: id, archived_at: null }, select: { user_id: true } });
    const activeIds = new Set(active.map((h) => h.user_id));
    const creator = await prisma.user.findUniqueOrThrow({ where: { id: creatorId }, select: { first_name: true, last_name: true } });
    await assignTo(team, assignees.filter((uid) => !activeIds.has(uid)), creatorId, fullName(creator));
    const removed = [...activeIds].filter((uid) => !assignees.includes(uid));
    if (removed.length) {
      await prisma.habit.updateMany({ where: { team_habit_id: id, user_id: { in: removed } }, data: { archived_at: new Date() } });
    }
  }
  return { id };
}

/** Remove a definição; quem já recebeu mantém o hábito como pessoal (com todo o histórico). */
export async function deleteTeamHabit(id: number, creatorId: number) {
  await findOwnedTeamHabit(id, creatorId);
  await prisma.teamHabit.delete({ where: { id } });
  return { success: true };
}

// ── quadro de aderência ──

export interface TeamBoardMember {
  user: { id: number; name: string; photo: string | null };
  habit_id: number;
  done_today: boolean;
  week_done: number;
  rate_30: number;
  streak: number;
  streak_unit: "days" | "weeks";
  /** Dias cumpridos nos últimos 14 dias (YYYY-MM-DD). */
  recent: string[];
  last_done: string | null;
}

export async function getTeamBoard(creatorId: number, today: string = todayUtc()) {
  const teams = await prisma.teamHabit.findMany({
    where: { creator_id: creatorId },
    orderBy: { created_at: "desc" },
    include: {
      project: { select: { id: true, name: true, color: true } },
      habits: {
        where: { archived_at: null },
        include: { user: { select: { id: true, first_name: true, last_name: true, photo: true } } },
      },
    },
  });

  const allHabits = teams.flatMap((t) => t.habits);
  const logs = await loadLogs(allHabits.map((h) => h.id));
  const thisWeek = weekStart(today);
  const recentFrom = addDays(today, -13);

  return teams.map((team) => {
    const members: TeamBoardMember[] = team.habits.map((h) => {
      const dates = logs.get(h.id) ?? [];
      const stats = computeStats(h.target_per_week, fmt(h.created_at), dates, today);
      return {
        user: { id: h.user.id, name: fullName(h.user), photo: h.user.photo },
        habit_id: h.id,
        done_today: dates.includes(today),
        week_done: dates.filter((d) => d >= thisWeek && d <= today).length,
        rate_30: stats.rate_30,
        streak: stats.streak,
        streak_unit: stats.streak_unit,
        recent: dates.filter((d) => d >= recentFrom && d <= today),
        last_done: dates.length ? dates[dates.length - 1] : null,
      };
    });
    members.sort((a, b) => a.rate_30 - b.rate_30 || a.user.name.localeCompare(b.user.name));

    return {
      id: team.id,
      name: team.name,
      description: team.description,
      color: team.color,
      kind: team.kind as HabitKind,
      target_per_week: team.target_per_week,
      project: team.project ? { id: team.project.id, name: team.project.name ?? "", color: team.project.color } : null,
      reminder_time: team.reminder_time,
      reminder_days: parseDays(team.reminder_days),
      checklist: parseChecklist(team.checklist),
      members,
      summary: {
        total: members.length,
        done_today: members.filter((m) => m.done_today).length,
        avg_rate_30: members.length ? Math.round(members.reduce((sum, m) => sum + m.rate_30, 0) / members.length) : 0,
      },
    };
  });
}

/** "Cobrança": notifica quem ainda não registrou o hábito hoje. */
export async function nudgeTeamHabit(id: number, creatorId: number, today: string = todayUtc()) {
  const team = await findOwnedTeamHabit(id, creatorId);

  const last = lastNudge.get(id);
  if (last && Date.now() - last < NUDGE_COOLDOWN_MS) {
    throw new Error("Você já cobrou este hábito há pouco. Aguarde alguns minutos antes de cobrar de novo.");
  }

  const habits = await prisma.habit.findMany({ where: { team_habit_id: id, archived_at: null, user_id: { not: creatorId } }, select: { id: true, user_id: true } });
  const logs = await loadLogs(habits.map((h) => h.id));
  const pending = habits.filter((h) => !(logs.get(h.id) ?? []).includes(today));

  if (pending.length === 0) return { notified: 0, total: habits.length };

  const creator = await prisma.user.findUniqueOrThrow({ where: { id: creatorId }, select: { first_name: true, last_name: true } });
  await notifyUsers(pending.map((h) => h.user_id), {
    type: "habit_reminder",
    title: `${fullName(creator)} está cobrando: ${team.name}`,
    body: "Ainda não consta o registro de hoje. Marque quando concluir.",
    link: "/habitos",
    metadata: { teamHabitId: id, nudge: true },
  });
  lastNudge.set(id, Date.now());
  return { notified: pending.length, total: habits.length };
}
