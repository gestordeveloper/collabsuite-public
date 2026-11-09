import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useTaskStore } from "@/src/store/task.store";
import { Skeleton } from "@/src/components/ui/skeleton";
import type { Task, FunnelStage } from "@/src/types";
import { TaskCard } from "./TaskCard";
import { stageColor } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";

interface KanbanColumnProps {
  stage: FunnelStage;
  tasks: Task[];
  allStages: FunnelStage[];
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: number, stageId: number) => void;
  onAddTask: (stageId: number) => void;
  onDeleteStage: (stageId: number) => void;
  onReorderStage: (stageId: number, direction: "left" | "right") => void;
  isFirstStage: boolean;
  isLastStage: boolean;
  draggedTaskId: number | null;
  dragOverStageId: number | null;
  onDragStartTask: (id: number | null) => void;
  onDragEndTask: () => void;
  onDragOverColumn: (stageId: number | null) => void;
  onDropColumn: (stageId: number) => void;
}

function TaskCardSkeleton() {
  return (
    <div className="space-y-3 rounded-[11px] border bg-elevated p-3">
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-6 w-full rounded-full" />
    </div>
  );
}

const iconButton =
  "flex h-6 w-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-accent hover:text-foreground";

export function KanbanColumn({
  stage, tasks, allStages, onTaskClick, onMoveTask, onAddTask, onDeleteStage, onReorderStage,
  isFirstStage, isLastStage,
  draggedTaskId, dragOverStageId, onDragStartTask, onDragEndTask, onDragOverColumn, onDropColumn,
}: KanbanColumnProps) {
  const isLoading = useTaskStore((s) => s.isLoading);
  const isDragOver = dragOverStageId === stage.id;

  return (
    <div
      className={cn(
        "flex max-h-full w-[292px] shrink-0 flex-col gap-2.5 rounded-xl border bg-surface p-2.5 transition-colors",
        isDragOver && "border-primary/50 bg-primary/5"
      )}
      onDragOver={(e) => { e.preventDefault(); onDragOverColumn(stage.id); }}
      onDragLeave={() => onDragOverColumn(null)}
      onDrop={(e) => { e.preventDefault(); onDropColumn(stage.id); }}
    >
      <div className="group flex shrink-0 items-center gap-2 px-1 pb-0.5 pt-1">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stageColor(stage) }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{stage.name}</span>
        <span className="font-mono text-xs text-subtle">{tasks.length}</span>
        <div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!isFirstStage && (
            <button type="button" title="Mover para a esquerda" className={iconButton} onClick={() => onReorderStage(stage.id, "left")}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
          {!isLastStage && (
            <button type="button" title="Mover para a direita" className={iconButton} onClick={() => onReorderStage(stage.id, "right")}>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
          {allStages.length > 1 && (
            <button type="button" title="Excluir coluna" className={cn(iconButton, "hover:text-destructive")} onClick={() => onDeleteStage(stage.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {isLoading && tasks.length === 0 ? (
          <>
            <TaskCardSkeleton />
            <TaskCardSkeleton />
          </>
        ) : tasks.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-[11px] border border-dashed text-xs text-subtle">
            {isDragOver ? "Soltar aqui" : "Sem tarefas"}
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              stages={allStages}
              onClick={() => onTaskClick(task)}
              onMoveTask={onMoveTask}
              isDragging={draggedTaskId === task.id}
              onDragStart={() => onDragStartTask(task.id)}
              onDragEnd={onDragEndTask}
            />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => onAddTask(stage.id)}
        className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-subtle transition-colors hover:bg-accent hover:text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> Adicionar cartão
      </button>
    </div>
  );
}
