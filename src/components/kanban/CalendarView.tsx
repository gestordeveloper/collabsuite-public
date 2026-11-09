import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTaskStore } from "@/src/store/task.store";
import type { Task, Funnel } from "@/src/types";
import { PINK, PRIORITY_META, hexA } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";

interface CalendarViewProps {
  funnel: Funnel;
  filteredTasks: Task[];
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: number, stageId: number) => void;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MAX_CHIPS = 3;

/** Calendário mensal do quadro (visão "Calendário" do Kanban), no padrão do design system. */
export function CalendarView({ funnel, filteredTasks, onTaskClick, onMoveTask }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const projectColor = useTaskStore((s) => s.projects.find((p) => p.id === funnel.project_id)?.color) ?? PINK;

  const stages = useMemo(() => [...funnel.stages].sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0)), [funnel]);

  const monthGrid = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startOffset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [currentDate]);

  function tasksForDay(day: Date) {
    const target = day.toDateString();
    return filteredTasks.filter((t) => t.due_at && new Date(t.due_at).toDateString() === target);
  }

  function shiftMonth(amount: number) {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() + amount);
    setCurrentDate(d);
  }

  const today = new Date().toDateString();
  const noDateTasks = filteredTasks.filter((t) => !t.due_at);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="font-display text-[26px] font-semibold tracking-[-0.02em]">
          {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h2>
        <div className="flex gap-1">
          <button type="button" aria-label="Mês anterior" onClick={() => shiftMonth(-1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Próximo mês" onClick={() => shiftMonth(1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button type="button" onClick={() => setCurrentDate(new Date())} className="flex h-[30px] items-center rounded-[7px] border px-3 text-[13px] transition-colors hover:bg-accent">
          Hoje
        </button>
        <span className="ml-auto text-xs text-subtle">{filteredTasks.length} tarefas</span>
      </div>

      <div className="overflow-hidden rounded-xl border bg-border">
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-surface px-3 py-2.5 text-xs font-medium text-subtle">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px" style={{ gridAutoRows: "minmax(124px, auto)" }}>
          {monthGrid.map((day, i) => {
            if (!day) return <div key={i} className="bg-surface" />;
            const dayTasks = tasksForDay(day);
            const isToday = day.toDateString() === today;
            return (
              <div key={i} className="flex min-w-0 flex-col gap-1 bg-card p-2">
                <span className={cn("grid h-[26px] w-[26px] place-items-center rounded-full text-[13px] font-medium", isToday && "bg-primary text-white")}>
                  {day.getDate()}
                </span>
                {dayTasks.slice(0, MAX_CHIPS).map((task) => (
                  <div
                    key={task.id}
                    onClick={() => onTaskClick(task)}
                    title={task.title}
                    className="flex min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[5px] px-1.5 py-[3px] text-xs transition-opacity hover:opacity-80"
                    style={{ backgroundColor: hexA(projectColor, 0.16) }}
                  >
                    <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_META[task.priority ?? ""]?.color ?? projectColor }} />
                    <span className="truncate">{task.title}</span>
                  </div>
                ))}
                {dayTasks.length > MAX_CHIPS && (
                  <span className="pl-1.5 text-[11px] text-muted-foreground">+{dayTasks.length - MAX_CHIPS} mais</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {noDateTasks.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 text-[13px] font-semibold">Sem data definida <span className="font-mono font-normal text-subtle">{noDateTasks.length}</span></p>
          <div className="flex flex-wrap gap-2">
            {noDateTasks.map((task) => (
              <div
                key={task.id}
                onClick={() => onTaskClick(task)}
                className="flex cursor-pointer items-center gap-2 rounded-lg border bg-elevated px-2.5 py-1.5 text-xs transition-colors hover:border-input"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_META[task.priority ?? ""]?.color ?? "#8A8A94" }} />
                <span className="font-medium">{task.title}</span>
                {stages.length > 1 && (
                  <select
                    value={task.stage_id ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onMoveTask(task.id, Number(e.target.value))}
                    className="h-6 rounded border border-input bg-surface px-1 text-[10px] focus-visible:border-primary focus-visible:outline-none"
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
