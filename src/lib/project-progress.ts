import type { Project, Task } from "@/src/types";

/** Percentual (0–100) de tarefas concluídas de um projeto, somando todos os seus funis. */
export function projectProgress(project: Project, tasks: Task[]): number {
  const funnelIds = project.funnels.map((f) => f.id);
  const doneStageIds = new Set(
    project.funnels.flatMap((f) => f.stages.filter((s) => s.stage_done).map((s) => s.id))
  );
  const projectTasks = tasks.filter((t) => t.funnel_id != null && funnelIds.includes(t.funnel_id));
  if (projectTasks.length === 0) return 0;
  const done = projectTasks.filter(
    (t) => t.status === "done" || (t.stage_id != null && doneStageIds.has(t.stage_id))
  ).length;
  return Math.round((done / projectTasks.length) * 100);
}
