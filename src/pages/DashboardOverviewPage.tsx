import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, CalendarDays, CheckCircle, FolderHeart, Check } from "lucide-react";
import { useAuthStore } from "@/src/store/auth.store";
import { useTaskStore } from "@/src/store/task.store";
import { useHabitStore } from "@/src/store/habit.store";
import { useDashboard } from "@/src/context/dashboard.context";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { Skeleton } from "@/src/components/ui/skeleton";
import { RightCalendarSidebar } from "@/src/components/dashboard/RightCalendarSidebar";
import { HabitsTodayCard } from "@/src/components/habits/HabitsTodayCard";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { projectProgress } from "@/src/lib/project-progress";
import { doneStageIdsOf, isTaskDone, setTaskDone } from "@/src/lib/task-actions";
import { PINK, PRIORITY_META, SEMANTIC, hexA } from "@/src/lib/design";
import { toDayString } from "@/src/services/habit.service";
import type { Task } from "@/src/types";
import { cn } from "@/src/lib/utils";

type Period = "week" | "month" | "quarter";

const PERIODS: { key: Period; label: string }[] = [
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "quarter", label: "Trimestre" },
];

const DOW_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function greeting(hour: number) {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

interface Bucket {
  label: string;
  start: Date;
  end: Date; // exclusivo
}

/** Intervalos exibidos no gráfico de concluídas + o período anterior equivalente (para o delta). */
function periodBuckets(period: Period, today: Date): { buckets: Bucket[]; range: string; prev: [Date, Date] } {
  const now = startOfDay(today);
  if (period === "week") {
    const start = addDays(now, -now.getDay());
    const buckets = Array.from({ length: 7 }, (_, i) => ({
      label: DOW_SHORT[i],
      start: addDays(start, i),
      end: addDays(start, i + 1),
    }));
    const last = addDays(start, 6);
    return {
      buckets,
      range: `${start.getDate()} – ${last.getDate()} ${MONTH_SHORT[last.getMonth()]}`,
      prev: [addDays(start, -7), start],
    };
  }
  if (period === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const buckets: Bucket[] = [];
    for (let s = first, i = 1; s < next; s = addDays(s, 7), i++) {
      buckets.push({ label: `S${i}`, start: s, end: new Date(Math.min(addDays(s, 7).getTime(), next.getTime())) });
    }
    return {
      buckets,
      range: `${MONTH_SHORT[now.getMonth()]} ${now.getFullYear()}`,
      prev: [new Date(now.getFullYear(), now.getMonth() - 1, 1), first],
    };
  }
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const buckets = Array.from({ length: 3 }, (_, i) => ({
    label: MONTH_SHORT[quarterStartMonth + i],
    start: new Date(now.getFullYear(), quarterStartMonth + i, 1),
    end: new Date(now.getFullYear(), quarterStartMonth + i + 1, 1),
  }));
  return {
    buckets,
    range: `${MONTH_SHORT[quarterStartMonth]} – ${MONTH_SHORT[quarterStartMonth + 2]} ${now.getFullYear()}`,
    prev: [new Date(now.getFullYear(), quarterStartMonth - 3, 1), buckets[0].start],
  };
}

export function DashboardOverviewPage() {
  const { user } = useAuthStore();
  const { projects, tasks, funnels, isLoading, openNewProject, setSelectedFunnelId } = useDashboard();
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);
  const habits = useHabitStore((s) => s.habits);
  const habitsLoaded = useHabitStore((s) => s.loaded);
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("week");
  const [pendingId, setPendingId] = useState<number | null>(null);

  const currentDate = new Date();
  const today = startOfDay(currentDate);
  const doneStageIds = useMemo(() => doneStageIdsOf(funnels), [funnels]);

  const topTasks = useMemo(
    () => tasks.filter((t) => !t.deleted_at && (t.task_id == null || t.task_id === 0)),
    [tasks]
  );

  const projectOf = (task: Task) => projects.find((p) => p.funnels.some((f) => f.id === task.funnel_id));

  // Tarefas de hoje (abertas e concluídas) + atrasadas em aberto.
  const todayList = useMemo(() => {
    const due = (t: Task) => (t.due_at ? new Date(t.due_at) : null);
    const list = topTasks.filter((t) => {
      const d = due(t);
      if (!d) return false;
      if (sameDay(d, today)) return true;
      return d < today && !isTaskDone(t, doneStageIds);
    });
    return list
      .sort((a, b) => Number(isTaskDone(a, doneStageIds)) - Number(isTaskDone(b, doneStageIds)) || +new Date(a.due_at!) - +new Date(b.due_at!))
      .slice(0, 8);
  }, [topTasks, doneStageIds, today]);

  const dueToday = topTasks.filter((t) => t.due_at && sameDay(new Date(t.due_at), today));
  const openToday = dueToday.filter((t) => !isTaskDone(t, doneStageIds)).length;
  const overdue = topTasks.filter((t) => t.due_at && new Date(t.due_at) < today && !isTaskDone(t, doneStageIds)).length;

  // Concluídas por período (closed_at, ou updated_at para tarefas antigas já concluídas).
  const { buckets, range, prev } = useMemo(() => periodBuckets(period, currentDate), [period, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const closedAt = (t: Task) => new Date(t.closed_at ?? t.updated_at);
  const doneTasks = topTasks.filter((t) => isTaskDone(t, doneStageIds));
  const bucketCounts = buckets.map((b) => doneTasks.filter((t) => closedAt(t) >= b.start && closedAt(t) < b.end).length);
  const doneInPeriod = bucketCounts.reduce((a, b) => a + b, 0);
  const doneInPrev = doneTasks.filter((t) => closedAt(t) >= prev[0] && closedAt(t) < prev[1]).length;
  const delta = doneInPrev === 0 ? null : Math.round(((doneInPeriod - doneInPrev) / doneInPrev) * 100);
  const maxCount = Math.max(...bucketCounts, 1);

  const habitsToday = toDayString(currentDate);
  const habitsDone = habits.filter((h) => h.logs.includes(habitsToday)).length;

  const favoriteProjects = projects.filter((p) => p.favorite);
  const progressRanking = [...projects]
    .map((p) => ({ project: p, pct: projectProgress(p, tasks) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);
  const recentActivities = tasks
    .filter((t) => t.activities?.length)
    .flatMap((t) => t.activities.map((a) => ({ ...a, taskTitle: t.title, taskId: t.id })))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  async function toggleDone(task: Task, done: boolean) {
    setPendingId(task.id);
    try {
      updateTaskInState(await setTaskDone(task, funnels, !done));
    } catch (err) {
      console.error(err);
    } finally {
      setPendingId(null);
    }
  }

  function progressColor(p: number) {
    if (p >= 100) return "text-success";
    if (p >= 50) return "text-warning";
    return "text-primary";
  }

  const rawDate = currentDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const weekdayLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

  const stats = [
    { label: "Tarefas para hoje", value: String(openToday), note: `de ${dueToday.length}`, noteClass: "text-subtle" },
    {
      label: "Concluídas no período",
      value: String(doneInPeriod),
      note: delta === null ? "sem comparação" : `${delta >= 0 ? "+" : ""}${delta}% vs. anterior`,
      noteClass: delta === null ? "text-subtle" : delta >= 0 ? "text-success" : "text-destructive",
    },
    {
      label: "Atrasadas",
      value: String(overdue),
      note: overdue === 0 ? "tudo em dia" : "precisam de atenção",
      noteClass: overdue === 0 ? "text-success" : "text-destructive",
    },
    {
      label: "Hábitos em dia",
      value: habitsLoaded ? `${habitsDone}/${habits.length}` : "—",
      note: "hoje",
      noteClass: "text-subtle",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-subtle">{weekdayLabel}</span>
          <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em]">
            {greeting(currentDate.getHours())}, {user?.first_name}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-[9px] border bg-card p-[3px]">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                  period === p.key ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button onClick={openNewProject} variant="secondary" className="gap-2">
            <Plus className="h-4 w-4" /> Novo projeto
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="flex flex-col gap-3 px-4 py-4 sm:px-5 sm:py-[18px]">
            <span className="text-[13px] text-muted-foreground">{s.label}</span>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-display text-[30px] font-semibold leading-none tracking-[-0.02em]">{s.value}</span>
              <span className={cn("text-xs font-medium", s.noteClass)}>{s.note}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Para hoje */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="font-display text-[15px] font-semibold">Para hoje</h3>
              <button type="button" onClick={() => navigate("/kanban")} className="text-[13px] text-primary hover:underline">
                Ver todas
              </button>
            </div>
            {isLoading && todayList.length === 0 ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : todayList.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nada com prazo para hoje. Aproveite o dia.</p>
            ) : (
              todayList.map((task) => {
                const done = isTaskDone(task, doneStageIds);
                const project = projectOf(task);
                const priority = PRIORITY_META[task.priority ?? ""];
                const isOverdue = !done && new Date(task.due_at!) < today;
                return (
                  <div
                    key={task.id}
                    onClick={() => navigate(`/task/${task.id}`)}
                    className="flex cursor-pointer items-center gap-3.5 border-b border-border/60 px-5 py-3 transition-colors last:border-b-0 hover:bg-accent/60"
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
                      disabled={pendingId === task.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDone(task, done);
                      }}
                      className={cn(
                        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors disabled:opacity-50",
                        done ? "border-primary bg-primary" : "border-[#4A4A52] hover:border-muted-foreground"
                      )}
                    >
                      {done && <Check className="h-3 w-3 text-white" strokeWidth={3.5} />}
                    </button>
                    <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", done && "text-subtle line-through")}>{task.title}</span>
                    {isOverdue && <span className="hidden text-xs text-destructive sm:inline">atrasada</span>}
                    {project && (
                      <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                        <span className="h-[7px] w-[7px] rounded-sm" style={{ backgroundColor: project.color || PINK }} />
                        <span className="max-w-[140px] truncate">{project.name}</span>
                      </span>
                    )}
                    {priority && (
                      <span
                        className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                        style={{ color: priority.color, backgroundColor: hexA(priority.color, 0.14) }}
                      >
                        {priority.label}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </Card>

          {/* Concluídas no período */}
          <Card className="flex flex-col gap-[18px] px-5 py-[18px]">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[15px] font-semibold">
                Tarefas concluídas {period === "week" ? "na semana" : period === "month" ? "no mês" : "no trimestre"}
              </h3>
              <span className="text-xs text-subtle">{range}</span>
            </div>
            <div className="flex h-40 items-end gap-3.5">
              {buckets.map((b, i) => {
                const isCurrent = today >= b.start && today < b.end;
                const isFuture = b.start > today;
                return (
                  <div key={b.label + i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{isFuture ? "" : bucketCounts[i]}</span>
                    <div
                      className={cn("w-full max-w-11 rounded-md", isCurrent ? "bg-primary" : isFuture ? "bg-border" : "bg-input")}
                      style={{ height: isFuture || bucketCounts[i] === 0 ? 6 : Math.max(10, (bucketCounts[i] / maxCount) * 104) }}
                    />
                    <span className={cn("text-xs", isCurrent ? "text-primary" : "text-subtle")}>{b.label}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Favoritos */}
          <Card>
            <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
              <CardTitle className="flex items-center justify-between text-[15px]">
                <span>Projetos Favoritos</span>
                <Badge variant="secondary">{favoriteProjects.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
              {isLoading ? (
                <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
                  <Skeleton className="h-28" />
                  <Skeleton className="h-28" />
                </div>
              ) : favoriteProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                  <FolderHeart className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nenhum projeto favorito ainda.</p>
                </div>
              ) : (
                <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
                  {favoriteProjects.map((proj) => {
                    const p = projectProgress(proj, tasks);
                    const r = 28;
                    const circ = 2 * Math.PI * r;
                    const offset = circ - (p / 100) * circ;
                    const funnelIds = proj.funnels.map((f) => f.id);
                    const projectTasks = tasks.filter((t) => t.funnel_id != null && funnelIds.includes(t.funnel_id));
                    const defaultFunnel = proj.funnels.find((f) => f.is_default) || proj.funnels[0];
                    return (
                      <div
                        key={proj.id}
                        onClick={() => { if (defaultFunnel) setSelectedFunnelId(defaultFunnel.id); navigate("/kanban"); }}
                        role="button"
                        className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl border bg-surface p-3 text-left transition-colors hover:border-input sm:gap-4 sm:p-4"
                      >
                        <div className="relative h-12 w-12 shrink-0 sm:h-16 sm:w-16">
                          <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
                            <circle cx="32" cy="32" r={r} fill="none" strokeWidth="4" className="stroke-input/70" />
                            <circle cx="32" cy="32" r={r} fill="none" strokeWidth="4" stroke={proj.color ?? PINK} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
                          </svg>
                          <span className={`absolute inset-0 flex items-center justify-center font-mono text-[10px] font-medium sm:text-xs ${progressColor(p)}`}>{p}%</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{proj.name}</p>
                          <p className="mb-2 truncate text-xs text-muted-foreground">{proj.content || "Sem descrição"}</p>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex -space-x-2">
                              {proj.projectUsers?.slice(0, 3).map((pu) => pu.user && <UserAvatar key={pu.id} user={pu.user} className="h-6 w-6 text-[10px] ring-2 ring-surface" />)}
                              {(!proj.projectUsers || proj.projectUsers.length === 0) && <span className="text-xs text-muted-foreground">—</span>}
                            </div>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <CalendarDays className="h-3 w-3" /> {projectTasks.length} tarefas
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Atividades recentes */}
          <Card>
            <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
              <CardTitle className="flex items-center gap-2 text-[15px]">
                <CheckCircle className="h-4 w-4 text-primary" /> Atividades Recentes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
              {recentActivities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma atividade recente.</p>
              ) : (
                <ul className="space-y-1">
                  {recentActivities.map((a) => (
                    <li key={a.id} onClick={() => navigate(`/task/${a.taskId}`)} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-accent">
                      <UserAvatar user={a.user} className="h-8 w-8 shrink-0 text-xs" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm"><span className="font-medium">{a.user?.first_name}</span> comentou em <span className="font-medium">{a.taskTitle}</span></p>
                        <p className="mb-1 truncate text-xs text-muted-foreground">{a.content}</p>
                        <span className="block font-mono text-[10px] text-subtle md:hidden">{new Date(a.created_at).toLocaleDateString("pt-BR")}</span>
                      </div>
                      <span className="hidden shrink-0 font-mono text-xs text-subtle md:inline">{new Date(a.created_at).toLocaleDateString("pt-BR")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <RightCalendarSidebar tasks={tasks} currentDate={currentDate} projects={projects} />
          <HabitsTodayCard />

          <Card className="flex flex-col gap-3.5 p-5">
            <h3 className="font-display text-[15px] font-semibold">Projetos</h3>
            {progressRanking.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum projeto ainda.</p>
            ) : (
              progressRanking.map(({ project, pct }) => (
                <div key={project.id} className="flex flex-col gap-[7px]">
                  <div className="flex justify-between text-[13px]">
                    <span className="truncate">{project.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-md bg-input/70">
                    <div
                      className="h-full rounded-md transition-all"
                      style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? SEMANTIC.success : project.color || PINK }}
                    />
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
