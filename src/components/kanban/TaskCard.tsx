import { GripVertical, CalendarDays, Rocket, Phone, MessageCircle, FileText, FileSpreadsheet, ClipboardList, StickyNote, ListTree, ScrollText, Workflow, PenTool } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { Progress } from "@/src/components/ui/progress";
import type { Task, FunnelStage } from "@/src/types";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { cn } from "@/src/lib/utils";
import { useTaskStore } from "@/src/store/task.store";

const priorityConfig: Record<string, { label: string; variant: "destructive" | "warning" | "secondary" | "outline" }> = {
  high: { label: "Alta", variant: "destructive" },
  medium: { label: "Média", variant: "warning" },
  low: { label: "Baixa", variant: "secondary" },
  none: { label: "Sem prioridade", variant: "outline" },
};

interface TaskCardProps {
  task: Task;
  stages: FunnelStage[];
  onClick: () => void;
  onMoveTask: (taskId: number, stageId: number) => void;
  isDragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function TaskCard({ task, stages, onClick, onMoveTask, isDragging, onDragStart, onDragEnd }: TaskCardProps) {
  const priority = priorityConfig[task.priority ?? "none"];
  const doneCount = task.checklists?.filter((c) => c.is_done === true || c.is_done === 1).length ?? 0;
  const total = task.checklists?.length ?? 0;
  const progress = total > 0 ? (doneCount / total) * 100 : 0;

  const { tasks, funnels } = useTaskStore();
  const subtasks = tasks.filter((t) => t.task_id === task.id && !t.deleted_at);
  const totalSubtasks = subtasks.length;
  const doneSubtasks = subtasks.filter((t) => t.status === "done").length;
  const subtaskProgress = totalSubtasks > 0 ? (doneSubtasks / totalSubtasks) * 100 : 0;

  const funnel = funnels.find((f) => f.id === task.funnel_id);
  const taskCode = funnel?.prefix ? `${funnel.prefix}-${task.id}` : `#${task.id}`;

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-pointer rounded-[11px] border bg-elevated p-3 transition-colors hover:border-input",
        isDragging && "opacity-40"
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[10px] font-mono font-semibold bg-muted/50 hover:bg-muted text-muted-foreground">{taskCode}</Badge>
          {task.type === "note" ? (
            <Badge variant="outline" className="gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20">
              <StickyNote className="h-3 w-3" /> Nota
            </Badge>
          ) : (
            <Badge variant={priority.variant} className="text-[10px]">{priority.label}</Badge>
          )}
        </div>
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-subtle/40 group-hover:text-subtle" />
      </div>

      <p className="mb-2 text-sm font-medium leading-snug">{task.title}</p>

      <div className="mb-2 flex flex-wrap gap-1">
        {task.template === "default" && (
          <Badge variant="outline" className="gap-1 text-[10px] text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/20">
            <FileText className="h-3 w-3" /> Documento
          </Badge>
        )}
        {task.template === "spreadsheet" && (
          <Badge variant="outline" className="gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
            <FileSpreadsheet className="h-3 w-3" /> Planilha
          </Badge>
        )}
        {task.template === "form" && (
          <Badge variant="outline" className="gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20">
            <ClipboardList className="h-3 w-3" /> Formulário
          </Badge>
        )}
        {task.template === "proposal" && (
          <Badge variant="outline" className="gap-1 text-[10px] text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/20">
            <ScrollText className="h-3 w-3" /> Proposta
          </Badge>
        )}
        {task.template === "flowchart" && (
          <Badge variant="outline" className="gap-1 text-[10px] text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
            <Workflow className="h-3 w-3" /> Fluxograma
          </Badge>
        )}
        {task.template === "whiteboard" && (
          <Badge variant="outline" className="gap-1 text-[10px] text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20">
            <PenTool className="h-3 w-3" /> Quadro Branco
          </Badge>
        )}

        {(task.is_sprint) && (
          <Badge variant="outline" className="gap-1 text-[10px] text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20">
            <Rocket className="h-3 w-3" /> Sprint
          </Badge>
        )}
        {task.is_called && (
          <Badge variant="outline" className="gap-1 text-[10px] text-blue-600 dark:text-blue-400">
            <Phone className="h-3 w-3" /> Chamado
          </Badge>
        )}
        {task.is_whatsapp && (
          <Badge variant="outline" className="gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
            <MessageCircle className="h-3 w-3" /> WhatsApp
          </Badge>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <div className="flex -space-x-2">
          {task.user ? <UserAvatar user={task.user} className="h-6 w-6 ring-2 ring-card" /> : null}
          {task.taskUsers?.slice(0, 2).map((tu) => tu.user && <UserAvatar key={tu.id} user={tu.user} className="h-6 w-6 ring-2 ring-card" />)}
          {task.user || task.taskUsers?.length ? null : <span className="text-xs text-muted-foreground">Sem responsável</span>}
        </div>
        {task.due_at && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            {new Date(task.due_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <Progress value={progress} className="h-1.5" />
          <span className="text-[10px] text-muted-foreground shrink-0">{doneCount}/{total}</span>
        </div>
      )}

      {totalSubtasks > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <ListTree className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <Progress value={subtaskProgress} className="h-1.5" />
          <span className="text-[10px] text-muted-foreground shrink-0">{doneSubtasks}/{totalSubtasks}</span>
        </div>
      )}

      {stages.length > 1 && (
        <div className={cn("flex border-t pt-2", total > 0 && "mt-2")}>
          <select
            value={task.stage_id ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onMoveTask(task.id, Number(e.target.value))}
            className={cn(
              "h-7 w-full rounded-md border border-input bg-surface px-2 text-xs text-muted-foreground",
              "cursor-pointer focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25"
            )}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.id === task.stage_id ? " (atual)" : ""}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}