import type { Funnel, Project, Task, User } from "@/src/types";
import { doneStageIdsOf, isTaskDone } from "@/src/lib/task-actions";
import { PINK, SEMANTIC, stageColor } from "@/src/lib/design";

/** Status agrupáveis de uma tarefa (o mesmo conjunto de `Task.status`, na ordem do fluxo). */
export type TaskStatusKey = "notdone" | "inprogress" | "review" | "done";

export const STATUS_META: { key: TaskStatusKey; label: string; color: string }[] = [
  { key: "notdone", label: "A fazer", color: SEMANTIC.info },
  { key: "inprogress", label: "Em andamento", color: PINK },
  { key: "review", label: "Em revisão", color: SEMANTIC.warning },
  { key: "done", label: "Concluído", color: SEMANTIC.success },
];

/** "Tag" das tarefas: o tipo de conteúdo (template) e marcadores como sprint/chamado. */
const TEMPLATE_TAGS: Record<string, { label: string; color: string }> = {
  default: { label: "Documento", color: "#4C9BFF" },
  spreadsheet: { label: "Planilha", color: "#2BD47D" },
  form: { label: "Formulário", color: "#9B7BFF" },
  proposal: { label: "Proposta", color: "#FF5CAE" },
  flowchart: { label: "Fluxograma", color: "#2DD4BF" },
  whatsapp: { label: "WhatsApp", color: "#2BD47D" },
  whiteboard: { label: "Quadro branco", color: "#F7B32B" },
};

export interface TaskTag {
  label: string;
  color: string;
}

export function taskTags(task: Task): TaskTag[] {
  const tags: TaskTag[] = [];
  if (task.type === "note") tags.push({ label: "Nota", color: "#F7B32B" });
  if (task.template && TEMPLATE_TAGS[task.template]) tags.push(TEMPLATE_TAGS[task.template]);
  if (task.is_sprint) tags.push({ label: "Sprint", color: "#F7B32B" });
  if (task.is_called) tags.push({ label: "Chamado", color: "#4C9BFF" });
  return tags;
}

/** Responsáveis únicos: dono da tarefa + membros adicionados. */
export function taskPeople(task: Task): Pick<User, "id" | "first_name" | "last_name" | "photo">[] {
  const seen = new Set<number>();
  const people: Pick<User, "id" | "first_name" | "last_name" | "photo">[] = [];
  const push = (u?: { id: number; first_name: string; last_name?: string | null; photo?: string | null } | null) => {
    if (!u || seen.has(u.id)) return;
    seen.add(u.id);
    people.push({ id: u.id, first_name: u.first_name, last_name: u.last_name, photo: u.photo });
  };
  push(task.user);
  task.taskUsers?.forEach((tu) => push(tu.user as any));
  return people;
}

export interface TaskRow {
  task: Task;
  project: Project | null;
  funnel: Funnel | null;
  stageName: string;
  stageColor: string;
  status: TaskStatusKey;
  done: boolean;
  /** 0–100: checklist, ou subtarefas, ou 100 quando concluída. */
  progress: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Tarefas de projetos (nível superior, não excluídas) já com projeto, etapa, status e progresso resolvidos. */
export function buildTaskRows(tasks: Task[], projects: Project[], funnels: Funnel[]): TaskRow[] {
  const doneStageIds = doneStageIdsOf(funnels);
  const funnelById = new Map(funnels.map((f) => [f.id, f]));
  const projectByFunnel = new Map<number, Project>();
  projects.forEach((p) => p.funnels.forEach((f) => projectByFunnel.set(f.id, p)));

  const subtasksByParent = new Map<number, Task[]>();
  tasks.forEach((t) => {
    if (t.task_id && !t.deleted_at) {
      const list = subtasksByParent.get(t.task_id) ?? [];
      list.push(t);
      subtasksByParent.set(t.task_id, list);
    }
  });

  return tasks
    .filter((t) => !t.deleted_at && (t.task_id == null || t.task_id === 0) && t.funnel_id != null && t.funnel_id !== 0)
    .map((task) => {
      const funnel = funnelById.get(task.funnel_id!) ?? null;
      const stage = funnel?.stages.find((s) => s.id === task.stage_id);
      const done = isTaskDone(task, doneStageIds);
      // O status da etapa manda (o campo `status` da tarefa pode estar defasado em tarefas antigas).
      const isKnown = (v?: string | null): v is TaskStatusKey => STATUS_META.some((s) => s.key === v);
      const status: TaskStatusKey = done
        ? "done"
        : isKnown(stage?.status) ? stage.status : isKnown(task.status) ? task.status : "notdone";

      const checks = task.checklists ?? [];
      const subs = subtasksByParent.get(task.id) ?? [];
      let progress = done ? 100 : 0;
      if (!done) {
        if (checks.length > 0) {
          progress = Math.round((checks.filter((c) => c.is_done === true || c.is_done === 1).length / checks.length) * 100);
        } else if (subs.length > 0) {
          progress = Math.round((subs.filter((s) => s.status === "done").length / subs.length) * 100);
        }
      }

      return {
        task,
        project: projectByFunnel.get(task.funnel_id!) ?? null,
        funnel,
        stageName: stage?.name ?? "Sem etapa",
        stageColor: stage ? stageColor(stage) : "#8A8A94",
        status,
        done,
        progress,
      };
    });
}

export type DueTone = "done" | "overdue" | "today" | "normal";

export function dueTone(task: Task, done: boolean, now: Date = new Date()): DueTone {
  if (done) return "done";
  if (!task.due_at) return "normal";
  const due = startOfDay(new Date(task.due_at)).getTime();
  const today = startOfDay(now).getTime();
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "normal";
}

const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "23 set" */
export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()]}`;
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  done: "text-subtle",
  overdue: "text-destructive",
  today: "text-primary",
  normal: "text-muted-foreground",
};
