import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState, useEffect } from "react";
import { Rocket, Plus, Check } from "lucide-react";
import { useTaskStore } from "@/src/store/task.store";
import * as taskService from "@/src/services/task.service";
import { useNavigate } from "react-router-dom";

const SprintListComponent = ({ editor }: NodeViewProps) => {
  const storage = (editor.storage as any).sprintList as { taskId?: number; sprintTasks?: any[] };
  const taskId = storage.taskId;
  const navigate = useNavigate();

  const [newItem, setNewItem] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { tasks, addTask, updateTaskInState } = useTaskStore();

  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const handleTransaction = () => forceUpdate((x) => x + 1);
    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor]);

  const sprintTasks = editor.isEditable
    ? tasks.filter((t) => t.sprint_id === taskId && !t.deleted_at)
    : (storage.sprintTasks || []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newItem.trim() || !taskId || isSubmitting) return;

    setIsSubmitting(true);
    const parentTask = tasks.find(t => t.id === taskId);

    try {
      const created = await taskService.createTask({
        title: newItem.trim(),
        sprint_id: taskId,
        funnel_id: parentTask?.funnel_id || null,
        stage_id: parentTask?.stage_id || null,
        type: "task"
      });
      addTask(created);
      setNewItem("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggle(subId: number, currentStatus: string) {
    const newStatus = currentStatus === "done" ? "notdone" : "done";
    const updated = await taskService.updateTask(subId, { status: newStatus });
    updateTaskInState(updated);
  }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} className="my-4 select-none rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Rocket className="h-4 w-4 text-orange-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tarefas da Sprint</span>
        </div>

        <div className="space-y-1">
          {sprintTasks.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nenhuma tarefa nesta Sprint.</p>}
          {sprintTasks.map((t) => (
            <div key={t.id} className="group flex items-center justify-between rounded-lg px-2 py-1.5 transition-all hover:bg-accent">
              <div className="flex items-center gap-2.5">
                <button
                  disabled={!editor.isEditable}
                  onClick={() => handleToggle(t.id, t.status)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${t.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-input hover:border-emerald-500"} ${!editor.isEditable ? "cursor-default" : ""}`}
                >
                  {t.status === "done" && <Check className="h-3 w-3" />}
                </button>
                {editor.isEditable ? (
                  <button onClick={() => navigate(`/task/${t.id}`)} className={`text-sm hover:underline ${t.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                    {t.title}
                  </button>
                ) : (
                  <span className={`text-sm ${t.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                    {t.title}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {editor.isEditable && (
          <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
            <div className="flex flex-grow items-center gap-2">
              <Plus className="h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Adicionar tarefa na sprint..."
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                disabled={isSubmitting}
                className="flex-grow border-b border-transparent bg-transparent px-0 py-1 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
              />
            </div>
            <button type="submit" disabled={isSubmitting} className="rounded px-2 py-1 text-xs font-medium text-primary transition-all hover:bg-primary/10 disabled:opacity-60">Criar</button>
          </form>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const SprintListExtension = Node.create({
  name: "sprintList",
  group: "block",
  atom: true,
  draggable: true,

  addStorage() {
    return {
      taskId: undefined as number | undefined,
      sprintTasks: [] as any[],
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='sprint-list']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "sprint-list", ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SprintListComponent);
  },
});
