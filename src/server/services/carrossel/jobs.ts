/**
 * Tarefas longas (geração por IA, renderização) rodando em segundo plano, com progresso consultável.
 * Ficam em memória: se o servidor reiniciar, o usuário simplesmente gera de novo.
 */
import { randomUUID } from "crypto";
import { AIGenerationError } from "./aiClient";

export interface Job<T = unknown> {
  id: string;
  user_id: number;
  kind: string;
  status: "running" | "done" | "error" | "cancelled";
  stage: string;
  pct: number;
  result?: T;
  error?: string;
  error_status?: number;
  cancelled: boolean;
  created_at: number;
}

const jobs = new Map<string, Job>();
const TTL_MS = 60 * 60 * 1000;

class JobCancelled extends Error {}

function sweep() {
  const limit = Date.now() - TTL_MS;
  for (const [id, j] of jobs) if (j.created_at < limit) jobs.delete(id);
}

/** Inicia `fn` em segundo plano. `progress` atualiza etapa/porcentagem e também é o ponto de cancelamento. */
export function startJob<T>(
  userId: number, kind: string, fn: (progress: (stage: string, pct: number) => void) => Promise<T>,
): Job<T> {
  sweep();
  const job: Job<T> = {
    id: randomUUID().replace(/-/g, "").slice(0, 12), user_id: userId, kind, status: "running", stage: "Iniciando", pct: 0,
    cancelled: false, created_at: Date.now(),
  };
  jobs.set(job.id, job);
  const progress = (stage: string, pct: number) => {
    if (job.cancelled) throw new JobCancelled();
    job.stage = stage;
    job.pct = Math.max(0, Math.min(100, Math.round(pct)));
  };
  void fn(progress).then(
    (result) => {
      if (job.cancelled) { job.status = "cancelled"; return; }
      job.result = result;
      job.status = "done";
      job.pct = 100;
      job.stage = "Pronto";
    },
    (err) => {
      if (err instanceof JobCancelled || job.cancelled) { job.status = "cancelled"; job.stage = "Cancelado"; return; }
      job.status = "error";
      job.error = err?.message || "Erro inesperado.";
      job.error_status = err instanceof AIGenerationError ? err.status : 500;
      if (!(err instanceof AIGenerationError)) console.error(`[carrossel:${kind}]`, err);
    },
  );
  return job;
}

export function getJob(id: string, userId: number): Job | null {
  const j = jobs.get(id);
  return j && j.user_id === userId ? j : null;
}

export function cancelJob(id: string, userId: number): boolean {
  const j = getJob(id, userId);
  if (!j || j.status !== "running") return false;
  j.cancelled = true;
  return true;
}

export function publicJob(j: Job) {
  return { id: j.id, kind: j.kind, status: j.status, stage: j.stage, pct: j.pct, result: j.result, error: j.error, error_status: j.error_status };
}
