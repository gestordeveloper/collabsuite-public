import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Flame, LibraryBig, Pencil, Plus } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Skeleton } from "@/src/components/ui/skeleton";
import { HabitCheck } from "@/src/components/habits/HabitCheck";
import { HabitFormModal } from "@/src/components/habits/HabitFormModal";
import { FocusCard } from "@/src/components/habits/FocusCard";
import { TeamHabitsBoard } from "@/src/components/habits/TeamHabitsBoard";
import { WeeklySummaryPanel } from "@/src/components/habits/WeeklySummaryPanel";
import { RoutineTemplatesDialog } from "@/src/components/habits/RoutineTemplatesDialog";
import { HabitDetailPanel } from "@/src/components/habits/HabitDetailPanel";
import { useDashboard } from "@/src/context/dashboard.context";
import { PO_TEMPLATES, type HabitTemplate } from "@/src/lib/habit-templates";
import * as habitApi from "@/src/services/habit.service";
import { formatBestStreak, formatStreak, goalLabel, useHabitStore } from "@/src/store/habit.store";
import { fromDayString, toDayString } from "@/src/services/habit.service";
import type { Habit, HabitPayload, TeamBoardHabit, TeamHabitPayload } from "@/src/services/habit.service";
import { ACCENT_COLORS } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const HEATMAP_WEEKS = 26;
/** Volta máxima na navegação por semana (os check-ins carregados cobrem ~200 dias). */
const MAX_WEEKS_BACK = 26;
const GRID_COLUMNS = "minmax(0,1fr) repeat(7,52px) 100px 72px";

/** Sugestões para o estado vazio (mesmos exemplos do design system). */
const SUGGESTIONS: HabitPayload[] = [
  { name: "Beber 2L de água", color: ACCENT_COLORS[2], target_per_week: 7 },
  { name: "Leitura 20 min", color: ACCENT_COLORS[1], target_per_week: 7 },
  { name: "Exercício físico", color: ACCENT_COLORS[5], target_per_week: 4 },
  { name: "Meditação", color: ACCENT_COLORS[3], target_per_week: 7 },
  { name: "Estudar inglês", color: ACCENT_COLORS[4], target_per_week: 5 },
  { name: "Dormir antes das 23h", color: ACCENT_COLORS[0], target_per_week: 7 },
];

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date): Date {
  return addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -date.getDay());
}

function formatRange(start: Date, end: Date): string {
  const a = `${String(start.getDate()).padStart(2, "0")} ${MONTHS[start.getMonth()]}`;
  const b = `${String(end.getDate()).padStart(2, "0")} ${MONTHS[end.getMonth()]}`;
  return start.getMonth() === end.getMonth() ? `${String(start.getDate()).padStart(2, "0")} – ${b}` : `${a} – ${b}`;
}

/** Cor de uma célula do mapa de calor: nível 0 = vazio; 4 = cor cheia. */
function heatColor(color: string, level: number): string {
  if (level <= 0) return "hsl(var(--muted))";
  const mix = [0, 28, 52, 76, 100][level];
  return `color-mix(in srgb, ${color} ${mix}%, hsl(var(--muted)))`;
}

export function HabitsPage() {
  const { habits, loaded, isLoading, error, loadHabits, createHabit, updateHabit, archiveHabit, deleteHabit, toggleDay } = useHabitStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [seeding, setSeeding] = useState(false);
  const { projects } = useDashboard();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: "meus" | "equipe" | "resumo" = searchParams.get("aba") === "equipe" ? "equipe" : searchParams.get("aba") === "resumo" ? "resumo" : "meus";
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<Partial<HabitPayload> | null>(null);
  const [startAsTeam, setStartAsTeam] = useState(false);
  const [teamEdit, setTeamEdit] = useState<TeamBoardHabit | null>(null);
  const [teamReload, setTeamReload] = useState(0);

  useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  function goTab(next: "meus" | "equipe" | "resumo") {
    setSearchParams(next === "meus" ? {} : { aba: next }, { replace: true });
  }

  const now = new Date();
  const today = toDayString(now);
  const thisWeekStart = startOfWeek(now);
  const weekStart = addDays(thisWeekStart, weekOffset * 7);

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        const day = toDayString(date);
        return { day, dow: DOW[i], num: date.getDate(), isToday: day === today, isFuture: day > today };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekStart.getTime(), today]
  );

  const selected = habits.find((h) => h.id === selectedId) ?? null;
  const doneToday = habits.filter((h) => h.logs.includes(today)).length;

  // ── mapa de calor: 26 semanas terminando na semana atual ──
  const heat = useMemo(() => {
    const first = addDays(thisWeekStart, -(HEATMAP_WEEKS - 1) * 7);
    const targets = selected ? [selected] : habits;
    const cells: { day: string; level: number; future: boolean; done: number; total: number }[] = [];
    for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
      const day = toDayString(addDays(first, i));
      const future = day > today;
      let done = 0;
      let total = 0;
      if (!future) {
        for (const h of targets) {
          if (toDayString(new Date(h.created_at)) > day && !h.logs.includes(day)) continue;
          total++;
          if (h.logs.includes(day)) done++;
        }
      }
      const ratio = total === 0 ? 0 : done / total;
      const level = selected ? (done > 0 ? 4 : 0) : ratio === 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
      cells.push({ day, level, future, done, total });
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habits, selected, today, thisWeekStart.getTime()]);

  // ── cartões de resumo ──
  const weekLogsThisWeek = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => toDayString(addDays(thisWeekStart, i)));
    return habits.reduce((sum, h) => sum + h.logs.filter((d) => days.includes(d)).length, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habits, thisWeekStart.getTime()]);
  const weekGoal = habits.reduce((sum, h) => sum + h.target_per_week, 0);
  const avgRate = habits.length ? Math.round(habits.reduce((sum, h) => sum + h.rate_30, 0) / habits.length) : 0;

  function openCreate() {
    setEditing(null);
    setTeamEdit(null);
    setFormInitial(null);
    setStartAsTeam(false);
    setModalOpen(true);
  }

  function openEdit(habit: Habit) {
    setEditing(habit);
    setTeamEdit(null);
    setFormInitial(null);
    setStartAsTeam(false);
    setModalOpen(true);
  }

  /** Cria a partir de uma rotina pronta: abre o formulário já preenchido para o usuário ajustar. */
  function pickTemplate(template: HabitTemplate, mode: "me" | "team") {
    setEditing(null);
    setTeamEdit(null);
    setFormInitial(template.payload);
    setStartAsTeam(mode === "team");
    setTemplatesOpen(false);
    setModalOpen(true);
  }

  function openCreateTeam() {
    setEditing(null);
    setTeamEdit(null);
    setFormInitial(null);
    setStartAsTeam(true);
    setModalOpen(true);
  }

  function openEditTeam(team: TeamBoardHabit) {
    setEditing(null);
    setTeamEdit(team);
    setFormInitial(null);
    setStartAsTeam(true);
    setModalOpen(true);
  }

  async function handleSubmitTeam(payload: TeamHabitPayload, teamId: number | null) {
    if (teamId) await habitApi.updateTeamHabit(teamId, payload);
    else await habitApi.createTeamHabit(payload);
    setTeamReload((n) => n + 1);
    await loadHabits(); // o gestor também pode ter se incluído entre as pessoas
    goTab("equipe");
  }

  async function handleDeleteTeam(team: TeamBoardHabit) {
    await habitApi.deleteTeamHabit(team.id);
    setTeamReload((n) => n + 1);
    await loadHabits();
  }

  async function handleSubmit(payload: HabitPayload) {
    if (editing) {
      await updateHabit(editing.id, payload);
    } else {
      const created = await createHabit(payload);
      setSelectedId((current) => current ?? created.id);
    }
  }

  async function handleArchive(habit: Habit) {
    await archiveHabit(habit.id);
    if (selectedId === habit.id) setSelectedId(null);
  }

  async function handleDelete(habit: Habit) {
    await deleteHabit(habit.id);
    if (selectedId === habit.id) setSelectedId(null);
  }

  async function addSuggestion(suggestion: HabitPayload) {
    setSeeding(true);
    try {
      await createHabit(suggestion);
    } finally {
      setSeeding(false);
    }
  }

  const weekLabel = weekOffset === 0 ? "Esta semana" : "Semana";

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          {tab === "meus" && habits.length > 0 && (
          <div className="flex items-center gap-1 text-[13px] text-subtle">
            <button
              type="button"
              onClick={() => setWeekOffset((o) => Math.max(o - 1, -MAX_WEEKS_BACK))}
              disabled={weekOffset <= -MAX_WEEKS_BACK}
              aria-label="Semana anterior"
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[150px] text-center">
              {weekLabel} {formatRange(weekStart, addDays(weekStart, 6))}
            </span>
            <button
              type="button"
              onClick={() => setWeekOffset((o) => Math.min(o + 1, 0))}
              disabled={weekOffset >= 0}
              aria-label="Próxima semana"
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {weekOffset !== 0 && (
              <button type="button" onClick={() => setWeekOffset(0)} className="ml-1 text-primary hover:underline">
                Hoje
              </button>
            )}
          </div>
          )}
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Hábitos</h1>
        </div>
        <div className="flex items-center gap-4">
          {tab === "meus" && habits.length > 0 && <span className="text-sm text-muted-foreground">{doneToday} de {habits.length} hoje</span>}
          <Button variant="outline" onClick={() => setTemplatesOpen(true)} className="gap-1.5">
            <LibraryBig className="h-4 w-4" /> Rotinas prontas
          </Button>
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" strokeWidth={2.4} /> Novo hábito
          </Button>
        </div>
      </div>

      <div className="-mb-2 flex gap-1 border-b">
        {([
          ["meus", "Meus hábitos"],
          ["equipe", "Equipe"],
          ["resumo", "Resumo semanal"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => goTab(key)}
            className={cn(
              "-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors",
              tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {tab === "equipe" && <TeamHabitsBoard reloadKey={teamReload} onCreate={() => setTemplatesOpen(true)} onEdit={openEditTeam} />}

      {tab === "resumo" && <WeeklySummaryPanel />}

      {tab === "meus" && <FocusCard />}

      {tab === "meus" && (!loaded && isLoading ? (
        <Card className="space-y-3 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      ) : habits.length === 0 ? (
        <Card className="flex flex-col items-center gap-5 px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Flame className="h-6 w-6" />
          </div>
          <div className="flex max-w-md flex-col gap-1.5">
            <h2 className="font-display text-xl font-semibold">Comece pelo primeiro hábito</h2>
            <p className="text-sm text-muted-foreground">
              Marque o que você cumpriu a cada dia, acompanhe sua sequência e veja a consistência das últimas semanas.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" strokeWidth={2.4} /> Criar hábito
            </Button>
            <Button variant="outline" onClick={() => setTemplatesOpen(true)} className="gap-1.5">
              <LibraryBig className="h-4 w-4" /> Ver rotinas prontas para PO
            </Button>
          </div>
          <div className="flex max-w-xl flex-col items-center gap-2.5">
            <span className="label-caps">Ou comece com uma sugestão</span>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  disabled={seeding}
                  onClick={() => addSuggestion(s)}
                  className="flex items-center gap-2 rounded-full border border-input px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                >
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Mobile: um bloco por hábito, com os 7 dias em uma linha */}
          <Card className="md:hidden">
            {habits.map((habit) => (
              <div
                key={habit.id}
                onClick={() => setSelectedId((current) => (current === habit.id ? null : habit.id))}
                className={cn("border-b px-4 py-3 last:border-b-0", selectedId === habit.id && "bg-accent")}
              >
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: habit.color }} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{habit.name}</span>
                    <span className="truncate text-xs text-subtle">
                      {goalLabel(habit.target_per_week)} · {habit.rate_30}% em 30 dias{habit.team ? " · da equipe" : ""}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-warning">{formatStreak(habit)}</span>
                  <button
                    type="button"
                    aria-label={`Editar ${habit.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(habit);
                    }}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-input/60 hover:text-foreground",
                      habit.team && "hidden"
                    )}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-7 gap-1">
                  {weekDays.map((d) => {
                    const done = habit.logs.includes(d.day);
                    return (
                      <div key={d.day} className="flex flex-col items-center gap-1">
                        <span className={cn("text-[10px]", d.isToday ? "text-primary" : "text-subtle")}>{d.dow}</span>
                        <HabitCheck
                          shape="square"
                          size={34}
                          done={done}
                          color={habit.color}
                          disabled={d.isFuture}
                          label={`${habit.name} — ${d.dow} ${d.num}${done ? " (cumprido)" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!d.isFuture) toggleDay(habit.id, d.day);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>

          <Card className="hidden overflow-x-auto md:block">
            <div className="min-w-[760px]">
              <div
                className="grid items-center border-b px-5 py-3 text-xs text-subtle"
                style={{ gridTemplateColumns: GRID_COLUMNS }}
              >
                <span>Hábito</span>
                {weekDays.map((d) => (
                  <span key={d.day} className={cn("flex flex-col gap-0.5 text-center", d.isToday && "text-primary")}>
                    <span>{d.dow}</span>
                    <span className="font-mono">{d.num}</span>
                  </span>
                ))}
                <span className="text-right">Sequência</span>
                <span className="text-right">30 dias</span>
              </div>

              {habits.map((habit) => {
                const weekDone = weekDays.filter((d) => habit.logs.includes(d.day)).length;
                return (
                  <div
                    key={habit.id}
                    onClick={() => setSelectedId((current) => (current === habit.id ? null : habit.id))}
                    className={cn(
                      "group grid cursor-pointer items-center border-b px-5 py-2.5 last:border-b-0 transition-colors",
                      selectedId === habit.id ? "bg-accent" : "hover:bg-accent/50"
                    )}
                    style={{ gridTemplateColumns: GRID_COLUMNS }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: habit.color }} />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{habit.name}</span>
                        <span className="truncate text-xs text-subtle">
                          {goalLabel(habit.target_per_week)}
                          {habit.target_per_week < 7 && ` · ${weekDone}/${habit.target_per_week} na semana`}
                          {habit.description && ` · ${habit.description}`}
                          {habit.reminder_time && ` · lembrete ${habit.reminder_time}`}
                          {habit.project && ` · ${habit.project.name}`}
                          {habit.team && " · da equipe"}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Editar ${habit.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(habit);
                        }}
                        className={cn(
                          "ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 transition-opacity hover:bg-input/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
                          habit.team && "hidden"
                        )}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {weekDays.map((d) => {
                      const done = habit.logs.includes(d.day);
                      return (
                        <div key={d.day} className="grid place-items-center">
                          <HabitCheck
                            shape="square"
                            done={done}
                            color={habit.color}
                            disabled={d.isFuture}
                            label={`${habit.name} — ${d.dow} ${d.num}${done ? " (cumprido)" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!d.isFuture) toggleDay(habit.id, d.day);
                            }}
                          />
                        </div>
                      );
                    })}
                    <span className="text-right font-mono text-[13px] text-warning">{formatStreak(habit, true)}</span>
                    <span className="text-right font-mono text-[13px] text-muted-foreground">{habit.rate_30}%</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <Card className="flex min-w-0 flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-[15px] font-semibold">
                  {selected ? selected.name : "Todos os hábitos"} · últimas {HEATMAP_WEEKS} semanas
                </h3>
                <div className="flex items-center gap-1 text-[11px] text-subtle">
                  Menos
                  {[0, 1, 2, 3, 4].map((level) => (
                    <span
                      key={level}
                      className="h-3 w-3 rounded-[3px]"
                      style={{ backgroundColor: heatColor(selected?.color ?? "var(--primary)", level) }}
                    />
                  ))}
                  Mais
                </div>
              </div>
              <div className="overflow-x-auto pb-1">
                <div
                  className="grid gap-1"
                  style={{ gridTemplateRows: "repeat(7, 14px)", gridAutoFlow: "column", gridAutoColumns: "14px" }}
                >
                  {heat.map((cell) => (
                    <span
                      key={cell.day}
                      title={
                        cell.future
                          ? undefined
                          : `${fromDayString(cell.day).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} — ${
                              selected ? (cell.done ? "cumprido" : "não cumprido") : `${cell.done} de ${cell.total}`
                            }`
                      }
                      className="rounded-[3px]"
                      style={{
                        backgroundColor: cell.future ? "hsl(var(--card))" : heatColor(selected?.color ?? "var(--primary)", cell.level),
                      }}
                    />
                  ))}
                </div>
              </div>
              {!selected && <p className="text-xs text-subtle">Selecione um hábito na tabela para ver apenas o histórico dele.</p>}
            </Card>

            <Card className="flex flex-col gap-4 p-5">
              {selected ? (
                <>
                  <StatBlock label="Sequência atual" value={formatStreak(selected, true)} />
                  <StatBlock label="Melhor sequência" value={formatBestStreak(selected)} />
                  <StatBlock label="Taxa em 30 dias" value={`${selected.rate_30}%`} />
                  <HabitDetailPanel habit={selected} />
                </>
              ) : (
                <>
                  <StatBlock label="Cumpridos hoje" value={`${doneToday} de ${habits.length}`} />
                  <StatBlock label="Cumpridos na semana" value={`${weekLogsThisWeek} de ${weekGoal}`} />
                  <StatBlock label="Taxa média em 30 dias" value={`${avgRate}%`} />
                </>
              )}
            </Card>
          </div>
        </>
      ))}

      <RoutineTemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onPick={pickTemplate}
        ownedNames={habits.map((h) => h.name).filter((n) => PO_TEMPLATES.some((t) => t.payload.name === n))}
      />

      <HabitFormModal
        open={modalOpen}
        habit={editing}
        teamEdit={teamEdit}
        initial={formInitial}
        startAsTeam={startAsTeam}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        onSubmitTeam={handleSubmitTeam}
        onArchive={handleArchive}
        onDelete={handleDelete}
        onDeleteTeam={handleDeleteTeam}
      />
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-subtle">{label}</span>
      <span className="font-display text-[28px] font-semibold leading-tight">{value}</span>
    </div>
  );
}
