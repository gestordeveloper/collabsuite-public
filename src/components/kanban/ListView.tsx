import { useState } from "react";
import { CalendarDays, Rocket, Phone, MessageCircle, ChevronDown, ChevronRight, Plus, ListTree } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Progress } from "@/src/components/ui/progress";
import type { Task, Funnel, FunnelStage } from "@/src/types";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { cn } from "@/src/lib/utils";
import { useTaskStore } from "@/src/store/task.store";
import { PRIORITY_META, hexA, stageColor } from "@/src/lib/design";
import { DUE_TONE_CLASS, dueTone, formatShortDate } from "@/src/lib/task-view";

interface ListViewProps {
  funnel: Funnel;
  filteredTasks: Task[];
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: number, stageId: number) => void;
  onAddTask: (stageId: number) => void;
}

export function ListView({ funnel, filteredTasks, onTaskClick, onMoveTask, onAddTask }: ListViewProps) {
  const stages = [...funnel.stages].sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0));
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  function toggleCollapse(stageId: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {stages.map((stage) => {
          const tasks = filteredTasks.filter((t) => t.stage_id === stage.id);
          const isCollapsed = collapsed.has(stage.id);

          return (
            <div key={stage.id} className="flex flex-col">
              {/* Cabeçalho do grupo (pílula da etapa + contagem) */}
              <div
                className="flex cursor-pointer items-center justify-between px-2 pb-2"
                onClick={() => toggleCollapse(stage.id)}
              >
                <div className="flex items-center gap-2.5">
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-subtle" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-subtle" />
                  )}
                  <span
                    className="flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-xs font-semibold"
                    style={{ color: stageColor(stage), backgroundColor: hexA(stageColor(stage), 0.14) }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stageColor(stage) }} />
                    {stage.name}
                  </span>
                  <span className="font-mono text-xs text-subtle">{tasks.length}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={(e) => { e.stopPropagation(); onAddTask(stage.id); }}
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>

              {/* Table inside accordion */}
              {!isCollapsed && (
                tasks.length === 0 ? (
                  <div className="flex h-14 items-center border-t border-border/60 px-2 text-xs text-subtle">
                    Sem tarefas nesta etapa
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-collapse">
                      <colgroup>
                        <col className="w-24" />
                        <col />
                        <col className="w-28" />
                        <col className="w-32" />
                        <col className="w-32" />
                        <col className="w-28" />
                        <col className="w-40" />
                      </colgroup>
                      <thead>
                        <tr className="text-left text-xs font-medium text-subtle">
                          <th className="px-4 py-2">Prioridade</th>
                          <th className="px-4 py-2">Tarefa</th>
                          <th className="px-4 py-2">Responsáveis</th>
                          <th className="px-4 py-2">Checklist</th>
                          <th className="px-4 py-2">Subtarefas</th>
                          <th className="px-4 py-2">Prazo</th>
                          <th className="px-4 py-2">Etapa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            stages={stages}
                            onTaskClick={onTaskClick}
                            onMoveTask={onMoveTask}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TaskRowProps {
  task: Task;
  stages: FunnelStage[];
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: number, stageId: number) => void;
}

function TaskRow({ task, stages, onTaskClick, onMoveTask }: TaskRowProps) {
  const doneCount = task.checklists?.filter((c) => c.is_done === true || c.is_done === 1).length ?? 0;
  const total = task.checklists?.length ?? 0;
  const progress = total > 0 ? (doneCount / total) * 100 : 0;

  const { tasks } = useTaskStore();
  const subtasks = tasks.filter((t) => t.task_id === task.id && !t.deleted_at);
  const totalSubtasks = subtasks.length;
  const doneSubtasks = subtasks.filter((t) => t.status === "done").length;
  const subtaskProgress = totalSubtasks > 0 ? (doneSubtasks / totalSubtasks) * 100 : 0;

  return (
    <tr
      onClick={() => onTaskClick(task)}
      className="group h-11 cursor-pointer border-t border-border/60 text-[13px] transition-colors hover:bg-card"
    >
      {/* Priority */}
      <td className="px-4 py-2">
        {PRIORITY_META[task.priority ?? ""] ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_META[task.priority ?? ""].color }} />
            {PRIORITY_META[task.priority ?? ""].label}
          </span>
        ) : (
          <span className="text-xs text-subtle">—</span>
        )}
      </td>

      {/* Title */}
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          {task.icon && <span className="text-base leading-none">{task.icon}</span>}
          <p className="truncate text-sm font-medium leading-snug">{task.title}</p>
        </div>
        {(task.is_sprint || task.is_called || task.is_whatsapp) && (
          <div className="mt-1 flex gap-1">
            {task.is_sprint && (
              <Badge variant="outline" className="gap-1 text-[10px] text-orange-600 dark:text-orange-400">
                <Rocket className="h-3 w-3" />
              </Badge>
            )}
            {task.is_called && (
              <Badge variant="outline" className="gap-1 text-[10px] text-blue-600 dark:text-blue-400">
                <Phone className="h-3 w-3" />
              </Badge>
            )}
            {task.is_whatsapp && (
              <Badge variant="outline" className="gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <MessageCircle className="h-3 w-3" />
              </Badge>
            )}
          </div>
        )}
      </td>

      {/* Assignees */}
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <div className="flex -space-x-2">
            {task.user && <UserAvatar user={task.user} className="h-6 w-6 border-2 border-background" />}
            {task.taskUsers?.slice(0, 2).map((tu) => tu.user && <UserAvatar key={tu.id} user={tu.user} className="h-6 w-6 border-2 border-background" />)}
          </div>
          {!task.user && !task.taskUsers?.length && <span className="text-xs text-muted-foreground">—</span>}
        </div>
      </td>

      {/* Checklist */}
      <td className="px-4 py-2">
        {total > 0 ? (
          <div className="flex items-center gap-2">
            <Progress value={progress} className="h-1.5" />
            <span className="shrink-0 text-[10px] text-muted-foreground">{doneCount}/{total}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Subtasks */}
      <td className="px-4 py-2">
        {totalSubtasks > 0 ? (
          <div className="flex items-center gap-2">
            <ListTree className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <Progress value={subtaskProgress} className="h-1.5" />
            <span className="shrink-0 text-[10px] text-muted-foreground">{doneSubtasks}/{totalSubtasks}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Due date */}
      <td className="px-4 py-2">
        {task.due_at ? (
          <span className={cn("font-mono text-xs", DUE_TONE_CLASS[dueTone(task, task.status === "done")])}>
            {formatShortDate(task.due_at)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Stage select */}
      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
        {stages.length > 1 && (
          <select
            value={task.stage_id ?? ""}
            onChange={(e) => onMoveTask(task.id, Number(e.target.value))}
            className={cn(
              "h-7 w-full rounded-md border border-input bg-surface px-2 text-xs text-muted-foreground",
              "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </td>
    </tr>
  );
}