import { createContext, useContext } from "react";
import type { TaskChecklist, TaskActivity } from "../../../types";

interface TaskEditorContextValue {
  taskId: number;
  activities: TaskActivity[];
  checklists: TaskChecklist[];
  onAddActivity: (content: string) => Promise<void>;
  onAddChecklist: (title: string) => Promise<void>;
  onToggleChecklist: (itemId: number, is_done: boolean) => Promise<void>;
  onDeleteChecklist: (itemId: number) => Promise<void>;
  onRefreshTask: () => void;
}

export const TaskEditorContext = createContext<TaskEditorContextValue | null>(null);

export function useTaskEditor() {
  const ctx = useContext(TaskEditorContext);
  if (!ctx) throw new Error("useTaskEditor must be used within TaskEditorContext.Provider");
  return ctx;
}
