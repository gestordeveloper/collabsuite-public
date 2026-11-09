import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState, useEffect } from "react";
import { ListTree, Plus, Check, Users } from "lucide-react";
import { useTaskStore } from "@/src/store/task.store";
import * as taskService from "@/src/services/task.service";
import * as userService from "@/src/services/user.service";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { UserAvatar } from "@/src/components/common/UserAvatar";

const SubtaskListComponent = ({ editor }: NodeViewProps) => {
  const storage = (editor.storage as any).subtaskList as { taskId?: number; subtasks?: any[] };
  const taskId = storage.taskId;
  const navigate = useNavigate();

  const [newItem, setNewItem] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { tasks, addTask, updateTaskInState } = useTaskStore();
  const [users, setUsers] = useState<any[]>([]);

  const [, forceUpdate] = useState(0);

  useEffect(() => {
    userService.fetchUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    const handleTransaction = () => forceUpdate((x) => x + 1);
    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor]);

  const subtasks = editor.isEditable
    ? tasks.filter((t) => t.task_id === taskId && !t.deleted_at)
    : (storage.subtasks || []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newItem.trim() || !taskId || isSubmitting) return;

    setIsSubmitting(true);
    const parentTask = tasks.find(t => t.id === taskId);

    try {
      const created = await taskService.createTask({
        title: newItem.trim(),
        task_id: taskId,
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
          <ListTree className="h-4 w-4 text-blue-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subtarefas</span>
        </div>

        <div className="space-y-1">
          {subtasks.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nenhuma subtarefa.</p>}
          {subtasks.map((t) => (
            <div key={t.id} className="group flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 transition-all hover:bg-accent">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <button
                  disabled={!editor.isEditable}
                  onClick={() => handleToggle(t.id, t.status)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${t.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-input hover:border-emerald-500"} ${!editor.isEditable ? "cursor-default" : ""}`}
                >
                  {t.status === "done" && <Check className="h-3 w-3" />}
                </button>
                {editor.isEditable ? (
                  <button onClick={() => navigate(`/task/${t.id}`)} className={`text-sm hover:underline text-left truncate ${t.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                    {t.title}
                  </button>
                ) : (
                  <span className={`text-sm truncate ${t.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                    {t.title}
                  </span>
                )}
              </div>

              {editor.isEditable && (
                <div className="flex items-center gap-2 shrink-0">
                  {/* Prioridade select */}
                  <select
                    value={t.priority ?? "none"}
                    onChange={async (e) => {
                      const priority = e.target.value === "none" ? null : e.target.value;
                      const updated = await taskService.updateTask(t.id, { priority });
                      updateTaskInState(updated);
                    }}
                    className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground focus:outline-none"
                  >
                    <option value="none">Prioridade: Sem</option>
                    <option value="low">Baixa</option>
                    <option value="medium">Média</option>
                    <option value="high">Alta</option>
                  </select>

                  {/* Responsável select */}
                  <select
                    value={t.user_id ?? ""}
                    onChange={async (e) => {
                      const userId = Number(e.target.value) || null;
                      const updated = await taskService.updateTask(t.id, { user_id: userId });
                      updateTaskInState(updated);
                    }}
                    className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground focus:outline-none max-w-[120px]"
                  >
                    <option value="">Sem responsável</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.first_name} {u.last_name ? u.last_name[0] + "." : ""}
                      </option>
                    ))}
                  </select>

                  {/* Membros popover */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">
                        <Users className="h-3.5 w-3.5" />
                        <span>Membros ({t.taskUsers?.length ?? 0})</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-1 z-50">
                      <div className="p-1.5 text-xs font-semibold text-muted-foreground border-b mb-1">
                        Gerenciar membros
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {users.map((u) => {
                          const isMember = t.taskUsers?.some((tu) => tu.user_id === u.id);
                          return (
                            <button
                              key={u.id}
                              onClick={async () => {
                                if (isMember) {
                                  await taskService.removeTaskMember(t.id, u.id);
                                } else {
                                  await taskService.addTaskMember(t.id, u.id);
                                }
                                const fresh = await taskService.fetchTask(t.id);
                                updateTaskInState(fresh);
                              }}
                              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                            >
                              <div className="flex items-center gap-2">
                                <UserAvatar user={u} className="h-5 w-5" />
                                <span>{u.first_name} {u.last_name ?? ""}</span>
                              </div>
                              {isMember && <Check className="h-3 w-3 text-emerald-500" />}
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          ))}
        </div>

        {editor.isEditable && (
          <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
            <div className="flex flex-grow items-center gap-2">
              <Plus className="h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Adicionar subtarefa..."
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

export const SubtaskListExtension = Node.create({
  name: "subtaskList",
  group: "block",
  atom: true,
  draggable: true,

  addStorage() {
    return {
      taskId: undefined as number | undefined,
      subtasks: [] as any[],
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='subtask-list']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "subtask-list", ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubtaskListComponent);
  },
});
