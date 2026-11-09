import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuthStore } from "@/src/store/auth.store";
import { useTaskStore } from "@/src/store/task.store";
import { useDashboard } from "@/src/context/dashboard.context";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import { TasksTable } from "@/src/components/tasks/TasksTable";
import { TasksTimeline } from "@/src/components/tasks/TasksTimeline";
import { setTaskDone } from "@/src/lib/task-actions";
import { buildTaskRows, type TaskRow } from "@/src/lib/task-view";
import { cn } from "@/src/lib/utils";

type ViewKey = "table" | "timeline";
type FilterKey = "all" | "mine" | "today" | "overdue" | "high";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "mine", label: "Minhas" },
  { key: "today", label: "Hoje" },
  { key: "overdue", label: "Atrasadas" },
  { key: "high", label: "Prioridade alta" },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const tabClass = (active: boolean) =>
  cn(
    "-mb-px mr-3 whitespace-nowrap border-b-2 px-1 py-2 text-[13px] font-medium transition-colors",
    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
  );

/** Tarefas de todos os projetos: visão em tabela (agrupada por status) e linha do tempo. */
export function TasksPage() {
  const { projects, funnels, tasks, isLoading, searchQuery, openNewTask } = useDashboard();
  const { user } = useAuthStore();
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: ViewKey = params.get("view") === "timeline" ? "timeline" : "table";
  const [filter, setFilter] = useState<FilterKey>("all");
  const [pendingId, setPendingId] = useState<number | null>(null);

  const allRows = useMemo(() => buildTaskRows(tasks, projects, funnels), [tasks, projects, funnels]);

  const rows = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    const q = fold(searchQuery.trim());
    return allRows.filter(({ task, done }) => {
      if (q && !fold(task.title).includes(q) && !String(task.id).includes(q)) return false;
      switch (filter) {
        case "mine":
          return task.user_id === user?.id || !!task.taskUsers?.some((tu) => tu.user_id === user?.id);
        case "today":
          return !!task.due_at && startOfDay(new Date(task.due_at)).getTime() === today;
        case "overdue":
          return !done && !!task.due_at && startOfDay(new Date(task.due_at)).getTime() < today;
        case "high":
          return !done && task.priority === "high";
        default:
          return true;
      }
    });
  }, [allRows, filter, searchQuery, user?.id]);

  const openCount = allRows.filter((r) => !r.done).length;

  function setView(next: ViewKey) {
    setParams(next === "table" ? {} : { view: next }, { replace: true });
  }

  async function toggleDone(row: TaskRow) {
    setPendingId(row.task.id);
    try {
      updateTaskInState(await setTaskDone(row.task, funnels, !row.done));
    } catch (err) {
      console.error(err);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Tarefas</h1>
          <span className="text-sm text-muted-foreground">
            Todas as tarefas dos projetos, agrupadas por status.
            {allRows.length > 0 && <span className="text-subtle"> {openCount} em aberto de {allRows.length}.</span>}
          </span>
        </div>
        <Button onClick={() => openNewTask()} className="gap-1.5">
          <Plus className="h-4 w-4" strokeWidth={2.4} /> Nova tarefa
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b">
        <div className="flex items-center overflow-x-auto no-scrollbar">
          <button type="button" onClick={() => setView("table")} className={tabClass(view === "table")}>Tabela</button>
          <button type="button" onClick={() => navigate("/kanban")} className={tabClass(false)}>Quadro</button>
          <button type="button" onClick={() => navigate("/agenda")} className={tabClass(false)}>Calendário</button>
          <button type="button" onClick={() => setView("timeline")} className={tabClass(view === "timeline")}>Linha do tempo</button>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-1.5 pb-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex h-7 items-center rounded-[7px] border px-2.5 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && allRows.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            {allRows.length === 0 ? "Nenhuma tarefa nos seus projetos ainda." : "Nenhuma tarefa com esses filtros."}
          </p>
          {filter !== "all" && (
            <button type="button" onClick={() => setFilter("all")} className="mt-2 text-[13px] text-primary hover:underline">
              Limpar filtro
            </button>
          )}
        </div>
      ) : view === "table" ? (
        <TasksTable rows={rows} pendingId={pendingId} onOpen={(r) => navigate(`/task/${r.task.id}`)} onToggle={toggleDone} />
      ) : (
        <TasksTimeline rows={rows} projects={projects} onOpen={(r) => navigate(`/task/${r.task.id}`)} />
      )}
    </div>
  );
}
