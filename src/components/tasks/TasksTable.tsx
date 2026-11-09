import { Check } from "lucide-react";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { PINK, PRIORITY_META, hexA } from "@/src/lib/design";
import {
  DUE_TONE_CLASS, STATUS_META, dueTone, formatShortDate, taskPeople, taskTags,
  type TaskRow,
} from "@/src/lib/task-view";
import { cn } from "@/src/lib/utils";

interface TasksTableProps {
  rows: TaskRow[];
  pendingId: number | null;
  onOpen: (row: TaskRow) => void;
  onToggle: (row: TaskRow) => void;
}

const GRID = "40px minmax(0,2.6fr) 150px 130px 110px 110px 160px 170px";

function DoneCheck({ row, pending, onToggle }: { row: TaskRow; pending: boolean; onToggle: (row: TaskRow) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={row.done}
      aria-label={row.done ? "Reabrir tarefa" : "Concluir tarefa"}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(row);
      }}
      className={cn(
        "grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors disabled:opacity-50",
        row.done ? "border-primary bg-primary" : "border-[#4A4A52] hover:border-muted-foreground"
      )}
    >
      {row.done && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
    </button>
  );
}

function StatusPill({ row }: { row: TaskRow }) {
  return (
    <span
      className="inline-block max-w-full truncate rounded-md px-2 py-[3px] text-xs font-medium"
      style={{ color: row.stageColor, backgroundColor: hexA(row.stageColor, 0.14) }}
    >
      {row.stageName}
    </span>
  );
}

function People({ row, size = 24 }: { row: TaskRow; size?: number }) {
  const people = taskPeople(row.task);
  if (people.length === 0) return <span className="text-xs text-subtle">—</span>;
  return (
    <div className="flex pl-1.5">
      {people.slice(0, 3).map((p) => (
        <UserAvatar
          key={p.id}
          user={p}
          className="-ml-1.5 border-2 border-background text-[9px]"
          style={{ width: size, height: size }}
        />
      ))}
      {people.length > 3 && (
        <span className="-ml-1.5 grid place-items-center rounded-full border-2 border-background bg-input px-1 font-mono text-[9px] text-muted-foreground" style={{ height: size, minWidth: size }}>
          +{people.length - 3}
        </span>
      )}
    </div>
  );
}

function PriorityCell({ row }: { row: TaskRow }) {
  const priority = PRIORITY_META[row.task.priority ?? ""];
  if (!priority) return <span className="text-xs text-subtle">—</span>;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: priority.color }} />
      {priority.label}
    </span>
  );
}

function ProjectCell({ row }: { row: TaskRow }) {
  if (!row.project) return <span className="text-xs text-subtle">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-[7px] text-xs text-muted-foreground">
      <span className="h-[7px] w-[7px] shrink-0 rounded-sm" style={{ backgroundColor: row.project.color || PINK }} />
      <span className="truncate">{row.project.name}</span>
    </span>
  );
}

function Tags({ row }: { row: TaskRow }) {
  const tags = taskTags(row.task);
  return (
    <div className="flex gap-1 overflow-hidden">
      {tags.map((t) => (
        <span
          key={t.label}
          className="whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-medium"
          style={{ color: t.color, backgroundColor: hexA(t.color, 0.14) }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

/** Tabela de tarefas agrupada por status (visão "Tabela" do design). */
export function TasksTable({ rows, pendingId, onOpen, onToggle }: TasksTableProps) {
  const groups = STATUS_META.map((s) => ({ ...s, rows: rows.filter((r) => r.status === s.key) })).filter((g) => g.rows.length > 0);

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto md:block">
        <div className="flex min-w-[1040px] flex-col gap-[22px]">
          <div className="grid px-2 text-xs font-medium text-subtle" style={{ gridTemplateColumns: GRID }}>
            <span />
            <span>Nome</span>
            <span>Status</span>
            <span>Responsáveis</span>
            <span>Prazo</span>
            <span>Prioridade</span>
            <span>Projeto</span>
            <span>Tags</span>
          </div>

          {groups.map((group) => (
            <div key={group.key} className="flex flex-col">
              <div className="flex items-center gap-2.5 px-2 pb-2">
                <span
                  className="flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-xs font-semibold"
                  style={{ color: group.color, backgroundColor: hexA(group.color, 0.14) }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: group.color }} />
                  {group.label}
                </span>
                <span className="font-mono text-xs text-subtle">{group.rows.length}</span>
              </div>
              {group.rows.map((row) => (
                <div
                  key={row.task.id}
                  onClick={() => onOpen(row)}
                  className="grid h-11 cursor-pointer items-center border-t border-border/60 px-2 text-[13px] transition-colors hover:bg-card"
                  style={{ gridTemplateColumns: GRID }}
                >
                  <DoneCheck row={row} pending={pendingId === row.task.id} onToggle={onToggle} />
                  <span className={cn("truncate pr-4 font-medium", row.done && "text-subtle")}>{row.task.title}</span>
                  <span className="flex min-w-0 items-center pr-2"><StatusPill row={row} /></span>
                  <People row={row} />
                  <span className={cn("font-mono text-xs", DUE_TONE_CLASS[dueTone(row.task, row.done)])}>
                    {formatShortDate(row.task.due_at)}
                  </span>
                  <PriorityCell row={row} />
                  <ProjectCell row={row} />
                  <Tags row={row} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile */}
      <div className="flex flex-col gap-5 md:hidden">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col">
            <div className="flex items-center gap-2.5 pb-2">
              <span
                className="flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-xs font-semibold"
                style={{ color: group.color, backgroundColor: hexA(group.color, 0.14) }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: group.color }} />
                {group.label}
              </span>
              <span className="font-mono text-xs text-subtle">{group.rows.length}</span>
            </div>
            {group.rows.map((row) => (
              <div
                key={row.task.id}
                onClick={() => onOpen(row)}
                className="flex cursor-pointer flex-col gap-2 border-t border-border/60 py-3"
              >
                <div className="flex items-center gap-3">
                  <DoneCheck row={row} pending={pendingId === row.task.id} onToggle={onToggle} />
                  <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", row.done && "text-subtle")}>{row.task.title}</span>
                  <span className={cn("font-mono text-xs", DUE_TONE_CLASS[dueTone(row.task, row.done)])}>
                    {formatShortDate(row.task.due_at)}
                  </span>
                </div>
                <div className="flex items-center gap-3 pl-[29px]">
                  <StatusPill row={row} />
                  <ProjectCell row={row} />
                  <div className="ml-auto"><People row={row} size={22} /></div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
