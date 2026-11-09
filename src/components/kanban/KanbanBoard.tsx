import { useState } from "react";
import { Plus } from "lucide-react";
import type { Task, Funnel } from "@/src/types";
import { KanbanColumn } from "./KanbanColumn";

interface KanbanBoardProps {
  funnels: Funnel[];
  selectedFunnelId: number | null;
  filteredTasks: Task[];
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: number, stageId: number) => void;
  onAddTask: (stageId: number) => void;
  onNewProject: () => void;
  onNewStage: () => void;
  onDeleteStage: (stageId: number) => void;
  onReorderStage: (stageId: number, direction: "left" | "right") => void;
}

export function KanbanBoard({
  funnels, selectedFunnelId, filteredTasks, onTaskClick, onMoveTask, onAddTask, onNewProject, onNewStage, onDeleteStage, onReorderStage,
}: KanbanBoardProps) {
  const funnel = funnels.find((f) => f.id === selectedFunnelId);
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<number | null>(null);

  if (!funnel) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
        <p className="text-muted-foreground">Nenhum projeto selecionado.</p>
        <button onClick={onNewProject} className="text-primary hover:underline">
          Criar primeiro projeto
        </button>
      </div>
    );
  }

  function handleDrop(stageId: number) {
    if (draggedTaskId !== null) {
      onMoveTask(draggedTaskId, stageId);
    }
    setDraggedTaskId(null);
    setDragOverStageId(null);
  }

  return (
    <div className="h-full overflow-x-auto p-4 sm:p-6 md:px-8 md:py-6">
      <div className="flex h-full min-w-max items-start gap-4 pb-4">
        {funnel.stages.map((stage, idx) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            tasks={filteredTasks.filter((t) => t.stage_id === stage.id)}
            allStages={funnel.stages}
            onTaskClick={onTaskClick}
            onMoveTask={onMoveTask}
            onAddTask={onAddTask}
            onDeleteStage={onDeleteStage}
            onReorderStage={onReorderStage}
            isFirstStage={idx === 0}
            isLastStage={idx === funnel.stages.length - 1}
            draggedTaskId={draggedTaskId}
            dragOverStageId={dragOverStageId}
            onDragStartTask={setDraggedTaskId}
            onDragEndTask={() => { setDraggedTaskId(null); setDragOverStageId(null); }}
            onDragOverColumn={setDragOverStageId}
            onDropColumn={handleDrop}
          />
        ))}

        <button
          onClick={onNewStage}
          className="flex h-[42px] w-[292px] shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-input text-[13px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          Adicionar Nova Coluna
        </button>
      </div>
    </div>
  );
}