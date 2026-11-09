import { Suspense, lazy, useMemo, useRef } from "react";
import type { Task } from "@/src/types";
import { useTaskStore } from "@/src/store/task.store";
import { useThemeStore } from "@/src/store/theme.store";
import * as taskService from "@/src/services/task.service";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((mod) => ({ default: mod.Excalidraw }))
);

function parseWhiteboardState(content: string | null | undefined): ExcalidrawInitialDataState {
  const empty: ExcalidrawInitialDataState = { elements: [], appState: {}, files: {} };
  if (!content) return empty;
  try {
    const parsed = JSON.parse(content);
    return {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      appState: parsed.appState ?? {},
      files: parsed.files ?? {},
    };
  } catch {
    return empty;
  }
}

interface WhiteboardTemplateProps {
  currentTask: Task;
  readOnly?: boolean;
}

export function WhiteboardTemplate({ currentTask, readOnly = false }: WhiteboardTemplateProps) {
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);
  const darkMode = useThemeStore((s) => s.darkMode);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialData = useMemo(() => parseWhiteboardState(currentTask.content), [currentTask.id]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
      {readOnly && (
        <div className="flex items-center gap-1.5 border-b bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <span>Quadro branco — somente leitura</span>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Carregando quadro...
            </div>
          }
        >
          <Excalidraw
            key={currentTask.id}
            initialData={initialData}
            viewModeEnabled={readOnly}
            theme={darkMode ? "dark" : "light"}
            onChange={(elements, appState, files) => {
              if (readOnly) return;
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
              saveTimerRef.current = setTimeout(async () => {
                try {
                  // Excalidraw's appState.collaborators is a Map (live presence
                  // data, meaningless to persist); JSON.stringify silently turns
                  // it into "{}", which then breaks Excalidraw on restore since
                  // it expects a real Map there. Drop it before saving.
                  const { collaborators, ...persistedAppState } = appState;
                  const state = { elements, appState: persistedAppState, files };
                  const updated = await taskService.updateTask(currentTask.id, {
                    content: JSON.stringify(state),
                  });
                  updateTaskInState(updated);
                } catch (err) {
                  console.error("Auto-save whiteboard error", err);
                }
              }, 850);
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
