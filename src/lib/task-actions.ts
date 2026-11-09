import * as taskService from "@/src/services/task.service";
import type { Funnel, Task } from "@/src/types";

/** Ids das etapas que representam "concluído" em qualquer funil. */
export function doneStageIdsOf(funnels: Funnel[]): Set<number> {
  return new Set(funnels.flatMap((f) => f.stages.filter((s) => s.stage_done).map((s) => s.id)));
}

export function isTaskDone(task: Task, doneStageIds: Set<number>): boolean {
  return task.status === "done" || (task.stage_id != null && doneStageIds.has(task.stage_id));
}

// Etapa em que a tarefa estava antes de ser concluída nesta sessão, para "reabrir" devolvê-la ao lugar de origem.
const stageBeforeDone = new Map<number, number>();

/**
 * Conclui/reabre uma tarefa levando-a para a etapa "concluída" do próprio funil — o mesmo efeito de
 * arrastá-la no quadro. Ao reabrir, volta para a etapa anterior (se conhecida) ou a primeira etapa aberta.
 */
export async function setTaskDone(task: Task, funnels: Funnel[], done: boolean): Promise<Task> {
  const stages = [...(funnels.find((f) => f.id === task.funnel_id)?.stages ?? [])].sort(
    (a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0)
  );
  let target;
  if (done) {
    target = stages.find((s) => s.stage_done);
    const current = stages.find((s) => s.id === task.stage_id);
    if (target && current && !current.stage_done) stageBeforeDone.set(task.id, current.id);
  } else {
    const remembered = stages.find((s) => s.id === stageBeforeDone.get(task.id) && !s.stage_done);
    target = remembered ?? stages.find((s) => !s.stage_done);
  }
  const payload = target
    ? { stage_id: target.id, status: target.status ?? (done ? "done" : "notdone") }
    : { status: done ? "done" : "notdone" };
  const updated = await taskService.updateTask(task.id, payload);
  if (!done) stageBeforeDone.delete(task.id);
  return updated;
}
