import { prisma } from "../lib/prisma";
import { funnelVisibilityFilter } from "./access.service";

interface AnalyticsFilter {
  userId?: number;
  isSuperAdmin?: boolean;
}

export async function getStats(opts: AnalyticsFilter) {
  const whereBase: any = {
    deleted_at: null,
    AND: [
      { funnel_id: { not: null } },
      { funnel_id: { not: 0 } }
    ]
  };

  if (!opts.isSuperAdmin && opts.userId) {
    whereBase.AND.push({
      OR: [
        { user_id: opts.userId },
        { taskUsers: { some: { user_id: opts.userId } } },
      ]
    });
  }

  const [totalTasks, tasksByStatus, tasksByPriority, totalProjects, totalUsers] = await Promise.all([
    prisma.task.count({ where: whereBase }),
    prisma.task.groupBy({
      by: ["status"],
      where: whereBase,
      _count: true,
    }),
    prisma.task.groupBy({
      by: ["priority"],
      where: whereBase,
      _count: true,
    }),
    prisma.project.count(),
    prisma.user.count({ where: { status: "active" } }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const s of tasksByStatus) {
    statusMap[s.status] = s._count;
  }

  const priorityMap: Record<string, number> = {};
  for (const p of tasksByPriority) {
    if (p.priority) priorityMap[p.priority] = p._count;
  }

  return {
    totalTasks,
    totalProjects,
    totalUsers,
    tasksByStatus: {
      notdone: statusMap.notdone ?? 0,
      inprogress: statusMap.inprogress ?? 0,
      done: statusMap.done ?? 0,
    },
    tasksByPriority: {
      low: priorityMap.low ?? 0,
      medium: priorityMap.medium ?? 0,
      high: priorityMap.high ?? 0,
    },
  };
}

export async function getBurndown(opts: AnalyticsFilter) {
  const days = 14;
  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const whereBase: any = {
    deleted_at: null,
    created_at: { gte: startDate },
    AND: [
      { funnel_id: { not: null } },
      { funnel_id: { not: 0 } }
    ]
  };

  if (!opts.isSuperAdmin && opts.userId) {
    whereBase.AND.push({
      OR: [
        { user_id: opts.userId },
        { taskUsers: { some: { user_id: opts.userId } } },
      ]
    });
  }

  const allTasks = await prisma.task.findMany({
    where: whereBase,
    select: { created_at: true, closed_at: true, status: true },
  });

  const points: { date: string; created: number; completed: number }[] = [];

  for (let i = 0; i <= days; i++) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];
    const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);

    const created = allTasks.filter(
      (t) => t.created_at >= date && t.created_at < nextDate
    ).length;

    const completed = allTasks.filter(
      (t) =>
        t.status === "done" &&
        t.closed_at &&
        new Date(t.closed_at) >= date &&
        new Date(t.closed_at) < nextDate
    ).length;

    points.push({ date: dateStr, created, completed });
  }

  let cumulativeTotal = 0;
  const burndown = points.map((p) => {
    cumulativeTotal += p.created;
    return {
      date: p.date,
      remaining: cumulativeTotal - p.completed,
      completed: p.completed,
      created: p.created,
    };
  });

  return burndown;
}

export async function getRanking(opts: AnalyticsFilter) {
  const whereBase: any = {
    deleted_at: null,
    status: "done",
    AND: [
      { funnel_id: { not: null } },
      { funnel_id: { not: 0 } }
    ]
  };

  if (!opts.isSuperAdmin && opts.userId) {
    whereBase.AND.push({
      OR: [
        { user_id: opts.userId },
        { taskUsers: { some: { user_id: opts.userId } } },
      ]
    });
  }

  const completedTasks = await prisma.task.findMany({
    where: whereBase,
    select: { user_id: true, closed_at: true, estimated_time: true, story_points: true },
  });

  const userMap = new Map<number, { count: number; points: number; hours: number }>();

  for (const t of completedTasks) {
    if (!t.user_id) continue;
    const entry = userMap.get(t.user_id) || { count: 0, points: 0, hours: 0 };
    entry.count++;
    if (t.story_points) entry.points += t.story_points;
    if (t.estimated_time) {
      const [h, m] = t.estimated_time.split(":").map(Number);
      entry.hours += h + (m || 0) / 60;
    }
    userMap.set(t.user_id, entry);
  }

  const userIds = Array.from(userMap.keys());
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, first_name: true, last_name: true, photo: true, email: true },
  });

  const userLookup = new Map(users.map((u) => [u.id, u]));

  const ranking = Array.from(userMap.entries())
    .map(([userId, data]) => ({
      userId,
      user: userLookup.get(userId) || null,
      completedTasks: data.count,
      storyPoints: data.points,
      hoursWorked: Math.round(data.hours * 10) / 10,
    }))
    .sort((a, b) => b.completedTasks - a.completedTasks);

  return ranking;
}

// ── Produtividade ──────────────────────────────────────────────────────────────
// Base: o histórico de etapas (TaskStageHistory), que registra quem moveu cada tarefa e quando.
// "Iniciada" = movida para uma etapa com status inprogress; "concluída" = etapa done.
// Só entram funis que o próprio solicitante pode ver (membro do projeto + visibilidade do funil),
// inclusive para super_admin — o relatório nunca expõe funis privados de outras pessoas.
const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;
const STALLED_AFTER_DAYS = 3;

interface ProductivityOptions {
  viewerId: number;
  days: number;
  userId?: number;
  projectId?: number;
}

export async function getProductivity(opts: ProductivityOptions) {
  const { viewerId, days, userId, projectId } = opts;
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const funnels = await prisma.funnel.findMany({
    where: {
      ...(projectId ? { project_id: projectId } : {}),
      project: { OR: [{ user_id: viewerId }, { projectUsers: { some: { user_id: viewerId } } }] },
      ...funnelVisibilityFilter(viewerId),
    },
    select: { id: true },
  });
  const funnelIds = funnels.map((f) => f.id);

  const stages = funnelIds.length
    ? await prisma.funnelStage.findMany({
        where: { funnel_id: { in: funnelIds } },
        select: { id: true, status: true, stage_done: true },
      })
    : [];
  const stageKind = new Map<number, "started" | "completed">();
  for (const s of stages) {
    if (s.status === "done" || s.stage_done) stageKind.set(s.id, "completed");
    else if (s.status === "inprogress") stageKind.set(s.id, "started");
  }

  const moves = stageKind.size
    ? await prisma.taskStageHistory.findMany({
        where: { funnel_id: { in: funnelIds }, stage_id: { in: Array.from(stageKind.keys()) }, created_at: { gte: since } },
        select: {
          task_id: true,
          stage_id: true,
          user_id: true,
          created_at: true,
          task: { select: { user_id: true, deleted_at: true, started_at: true, closed_at: true } },
        },
        orderBy: { created_at: "asc" },
      })
    : [];

  type PersonAgg = { started: number; completed: number; cycleHours: number[]; inProgressNow: number; stalled: number };
  const people = new Map<number, PersonAgg>();
  const agg = (id: number) => {
    let p = people.get(id);
    if (!p) people.set(id, (p = { started: 0, completed: 0, cycleHours: [], inProgressNow: 0, stalled: 0 }));
    return p;
  };

  // Série diária (dia de Brasília) preenchida mesmo nos dias sem movimento.
  const dayKey = (d: Date) => new Date(d.getTime() - BRAZIL_OFFSET_MS).toISOString().slice(0, 10);
  const daily = new Map<string, { date: string; started: number; completed: number }>();
  for (let i = days; i >= 0; i--) {
    const key = dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
    daily.set(key, { date: key, started: 0, completed: 0 });
  }
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ weekday, count: 0 }));
  const totals = { started: 0, completed: 0 };

  for (const m of moves) {
    if (m.task.deleted_at) continue;
    const actor = m.user_id ?? m.task.user_id;
    const kind = stageKind.get(m.stage_id)!;
    if (actor) agg(actor)[kind]++;
    if (actor && kind === "completed" && m.task.started_at && m.task.closed_at) {
      const h = (m.task.closed_at.getTime() - m.task.started_at.getTime()) / 3_600_000;
      if (h >= 0) agg(actor).cycleHours.push(h);
    }

    if (userId && actor !== userId) continue;
    totals[kind]++;
    const bucket = daily.get(dayKey(m.created_at));
    if (bucket) bucket[kind]++;
    const local = new Date(m.created_at.getTime() - BRAZIL_OFFSET_MS);
    byHour[local.getUTCHours()].count++;
    byWeekday[local.getUTCDay()].count++;
  }

  // Situação atual: o que está em andamento agora e há quanto tempo parado.
  const inProgress = funnelIds.length
    ? await prisma.task.findMany({
        where: { funnel_id: { in: funnelIds }, deleted_at: null, status: "inprogress" },
        select: { id: true, title: true, user_id: true, started_at: true, updated_at: true, funnel_id: true },
      })
    : [];
  const stalledCutoff = now.getTime() - STALLED_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const stalled: { id: number; title: string | null; userId: number | null; daysStopped: number }[] = [];
  for (const t of inProgress) {
    const lastMove = (t.started_at ?? t.updated_at).getTime();
    const isStalled = lastMove < stalledCutoff;
    if (t.user_id) {
      agg(t.user_id).inProgressNow++;
      if (isStalled) agg(t.user_id).stalled++;
    }
    if (isStalled && (!userId || t.user_id === userId)) {
      stalled.push({ id: t.id, title: t.title, userId: t.user_id, daysStopped: Math.floor((now.getTime() - lastMove) / 86_400_000) });
    }
  }
  stalled.sort((a, b) => b.daysStopped - a.daysStopped);

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(people.keys()) } },
    select: { id: true, first_name: true, last_name: true, photo: true, email: true },
  });
  const userLookup = new Map(users.map((u) => [u.id, u]));
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

  return {
    days,
    stalledAfterDays: STALLED_AFTER_DAYS,
    totals: {
      ...totals,
      inProgressNow: userId ? agg(userId).inProgressNow : inProgress.length,
      avgCycleHours: avg(
        userId ? agg(userId).cycleHours : Array.from(people.values()).flatMap((p) => p.cycleHours),
      ),
    },
    people: Array.from(people.entries())
      .map(([id, p]) => ({
        userId: id,
        user: userLookup.get(id) || null,
        started: p.started,
        completed: p.completed,
        avgCycleHours: avg(p.cycleHours),
        inProgressNow: p.inProgressNow,
        stalled: p.stalled,
      }))
      .sort((a, b) => b.completed - a.completed || b.started - a.started),
    daily: Array.from(daily.values()),
    byHour,
    byWeekday,
    stalled: stalled.slice(0, 20).map((s) => ({ ...s, user: s.userId ? userLookup.get(s.userId) || null : null })),
  };
}
