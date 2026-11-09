import { X } from "lucide-react";
import type { Task, FunnelStage } from "@/src/types";

export interface Filters {
  priority: string[];
  stageId: number | null;
  assigneeId: number | null;
  dateFrom: string;
  dateTo: string;
  hasChecklist: boolean | null;
  isOverdue: boolean | null;
}

export const EMPTY_FILTERS: Filters = {
  priority: [],
  stageId: null,
  assigneeId: null,
  dateFrom: "",
  dateTo: "",
  hasChecklist: null,
  isOverdue: null,
};

export function applyFilters(tasks: Task[], filters: Filters): Task[] {
  return tasks.filter((t) => {
    if (filters.priority.length > 0 && !filters.priority.includes(t.priority ?? "")) return false;
    if (filters.stageId !== null && t.stage_id !== filters.stageId) return false;
    if (filters.assigneeId !== null) {
      const assigneeMatch =
        t.user?.id === filters.assigneeId ||
        t.taskUsers?.some((tu) => tu.user?.id === filters.assigneeId);
      if (!assigneeMatch) return false;
    }
    if (filters.dateFrom && t.due_at && new Date(t.due_at) < new Date(`${filters.dateFrom}T00:00:00`)) return false;
    if (filters.dateTo && t.due_at && new Date(t.due_at) > new Date(`${filters.dateTo}T23:59:59.999`)) return false;
    if (filters.hasChecklist === true && (!t.checklists || t.checklists.length === 0)) return false;
    if (filters.hasChecklist === false && t.checklists && t.checklists.length > 0) return false;
    if (filters.isOverdue === true) {
      if (!t.due_at) return false;
      if (["done", "completed", "closed", "canceled"].includes(t.status)) return false;
      if (new Date(t.due_at) >= new Date()) return false;
    }
    if (filters.isOverdue === false) {
      if (!t.due_at) return true;
      if (["done", "completed", "closed", "canceled"].includes(t.status)) return true;
      if (new Date(t.due_at) >= new Date()) return true;
      return false;
    }
    return true;
  });
}

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  stages: FunnelStage[];
  allTasks: Task[];
}

export function FilterBar({ filters, onChange, stages, allTasks }: FilterBarProps) {
  const assigneeIds = new Set<number>();
  allTasks.forEach((t) => {
    if (t.user?.id) assigneeIds.add(t.user.id);
    t.taskUsers?.forEach((tu) => { if (tu.user?.id) assigneeIds.add(tu.user.id); });
  });

  const togglePriority = (value: string) => {
    const next = filters.priority.includes(value)
      ? filters.priority.filter((p) => p !== value)
      : [...filters.priority, value];
    onChange({ ...filters, priority: next });
  };

  const activeCount =
    filters.priority.length +
    (filters.stageId !== null ? 1 : 0) +
    (filters.assigneeId !== null ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0) +
    (filters.hasChecklist !== null ? 1 : 0) +
    (filters.isOverdue !== null ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Priority filter */}
      <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
        <span className="text-xs text-muted-foreground">Prioridade:</span>
        {["high", "medium", "low"].map((p) => (
          <button
            key={p}
            onClick={() => togglePriority(p)}
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
              filters.priority.includes(p)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {p === "high" ? "Alta" : p === "medium" ? "Média" : "Baixa"}
          </button>
        ))}
      </div>

      {/* Stage filter */}
      <select
        value={filters.stageId ?? ""}
        onChange={(e) => onChange({ ...filters, stageId: e.target.value ? Number(e.target.value) : null })}
        className="h-7 rounded-md border border-input bg-surface px-2 text-xs"
      >
        <option value="">Todas as etapas</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {/* Date range */}
      <input
        type="date"
        value={filters.dateFrom}
        onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
        className="h-7 rounded-md border border-input bg-surface px-2 text-xs"
        title="Data início"
      />
      <span className="text-xs text-muted-foreground">—</span>
      <input
        type="date"
        value={filters.dateTo}
        onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
        className="h-7 rounded-md border border-input bg-surface px-2 text-xs"
        title="Data fim"
      />

      {/* Overdue filter */}
      <button
        onClick={() =>
          onChange({
            ...filters,
            isOverdue: filters.isOverdue === true ? null : true,
          })
        }
        className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
          filters.isOverdue === true
            ? "border-red-300 bg-red-50 text-red-700 dark:text-red-400"
            : "border-input bg-surface text-muted-foreground hover:bg-accent"
        }`}
      >
        Atrasadas
      </button>

      {/* Clear all */}
      {activeCount > 0 && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="flex items-center gap-1 rounded-md border border-input bg-surface px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <X className="h-3 w-3" />
          Limpar ({activeCount})
        </button>
      )}
    </div>
  );
}