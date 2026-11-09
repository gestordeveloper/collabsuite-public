import { useRef } from "react";
import type { Task } from "@/src/types";
import { useTaskStore } from "@/src/store/task.store";
import * as taskService from "@/src/services/task.service";
import { FlowchartCanvas } from "@/src/components/flowchart/FlowchartCanvas";
import { parseFlowchartState, type FlowchartState } from "@/src/components/flowchart/types";

interface FlowchartTemplateProps {
  currentTask: Task;
  readOnly?: boolean;
}

export function FlowchartTemplate({ currentTask, readOnly = false }: FlowchartTemplateProps) {
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (state: FlowchartState) => {
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      try {
        const updated = await taskService.updateTask(currentTask.id, {
          content: JSON.stringify(state),
        });
        updateTaskInState(updated);
      } catch (err) {
        console.error("Auto-save flowchart error", err);
      }
    }, 850);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
      <div className="min-h-0 flex-1">
        <FlowchartCanvas
          key={currentTask.id}
          title={currentTask.title}
          initialState={parseFlowchartState(currentTask.content)}
          onChange={handleChange}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
