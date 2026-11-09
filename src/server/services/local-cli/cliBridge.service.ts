/**
 * Ponte com o "agente de CLIs" (agent/cli-agent) que roda no PC do usuário.
 *
 * O servidor (por exemplo no Docker) não alcança os CLIs da máquina de cada pessoa, então o agente conecta de fora para
 * dentro (long-poll, como o agente do Google Flow): avisa quais CLIs tem, recebe os prompts, roda o CLI localmente e
 * devolve o texto. Aqui ficam só a fila (em memória, por usuário), o heartbeat e a lista de CLIs de cada agente.
 */
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "collabsuite-secret-key-change-in-production";
const CONNECTED_WINDOW_MS = 45_000; // o agente pergunta por trabalho a cada ~25 s
const POLL_MS = 25_000;
const JOB_TIMEOUT_MS = 12 * 60_000;

export class CliBridgeError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export interface AgentCli { name: string; models: string[] }

interface Job {
  id: string;
  user_id: number;
  cli: string;
  model: string;
  prompt: string;
  timeout_sec: number;
  status: "pending" | "claimed" | "done" | "error";
  created_at: number;
  resolve: (text: string) => void;
  reject: (e: Error) => void;
}

const jobs = new Map<string, Job>();
const agents = new Map<number, { clis: AgentCli[]; seen: number }>();
const waiters = new Map<number, (() => void)[]>();

export function createAgentToken(userId: number, email: string): string {
  return jwt.sign({ userId, email, via: "cli-agent" }, JWT_SECRET, { expiresIn: "180d" });
}

function sanitizeClis(input: unknown): AgentCli[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).map((c: any) => ({
    name: String(c?.name || "").trim().slice(0, 60),
    models: Array.isArray(c?.models) ? c.models.slice(0, 30).map((m: unknown) => String(m).slice(0, 80)).filter(Boolean) : [],
  })).filter((c) => c.name && !c.name.includes(":"));
}

export function touch(userId: number, clis?: unknown) {
  const cur = agents.get(userId);
  agents.set(userId, { clis: clis === undefined ? cur?.clis || [] : sanitizeClis(clis), seen: Date.now() });
}

export const isConnected = (userId: number) => Date.now() - (agents.get(userId)?.seen || 0) < CONNECTED_WINDOW_MS;
export const listClis = (userId: number): AgentCli[] => (isConnected(userId) ? agents.get(userId)?.clis || [] : []);
export const pendingCount = (userId: number) => [...jobs.values()].filter((j) => j.user_id === userId && (j.status === "pending" || j.status === "claimed")).length;

function wake(userId: number) {
  for (const w of waiters.get(userId) || []) w();
  waiters.delete(userId);
}

/** Enfileira um prompt para o CLI do PC do usuário e espera o texto de volta. */
export function requestCompletion(userId: number, input: { cli: string; model: string; prompt: string; timeout_sec?: number }): Promise<string> {
  if (!isConnected(userId)) {
    throw new CliBridgeError("O agente de CLIs não está conectado. Abra o agente no seu computador (Configurações > Integrações > Agente de CLIs).", 400);
  }
  if (!listClis(userId).some((c) => c.name === input.cli)) {
    throw new CliBridgeError(`O CLI '${input.cli}' não está disponível no seu agente. Confira o agente ou escolha outra IA.`, 400);
  }
  return new Promise<string>((resolve, reject) => {
    const job: Job = { id: randomUUID().replace(/-/g, "").slice(0, 12), user_id: userId, timeout_sec: input.timeout_sec ?? 600, cli: input.cli, model: input.model, prompt: input.prompt, status: "pending", created_at: Date.now(), resolve, reject };
    const timer = setTimeout(() => {
      if (job.status === "done" || job.status === "error") return;
      job.status = "error";
      jobs.delete(job.id);
      reject(new CliBridgeError(`O CLI '${input.cli}' não respondeu em ${JOB_TIMEOUT_MS / 60000} minutos.`, 504));
    }, JOB_TIMEOUT_MS);
    job.resolve = (t) => { clearTimeout(timer); resolve(t); };
    job.reject = (e) => { clearTimeout(timer); reject(e); };
    jobs.set(job.id, job);
    wake(userId);
  });
}

function claimNext(userId: number): Job | null {
  const job = [...jobs.values()].filter((j) => j.user_id === userId && j.status === "pending").sort((a, b) => a.created_at - b.created_at)[0];
  if (job) job.status = "claimed";
  return job || null;
}

/** Long-poll do agente: devolve o próximo pedido ou null depois de ~25 s sem nada. */
export async function nextJob(userId: number, clis: unknown, signal?: AbortSignal) {
  touch(userId, clis);
  let job = claimNext(userId);
  if (!job) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_MS);
      const list = waiters.get(userId) || [];
      list.push(() => { clearTimeout(t); resolve(); });
      waiters.set(userId, list);
      signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); });
    });
    touch(userId);
    job = claimNext(userId);
  }
  return job ? { id: job.id, cli: job.cli, model: job.model, prompt: job.prompt, timeout_sec: job.timeout_sec } : null;
}

export function completeJob(userId: number, id: string, text: string): boolean {
  const j = jobs.get(id);
  if (!j || j.user_id !== userId) return false;
  j.status = "done";
  jobs.delete(id);
  j.resolve(text);
  return true;
}

export function failJob(userId: number, id: string, message: string): boolean {
  const j = jobs.get(id);
  if (!j || j.user_id !== userId) return false;
  j.status = "error";
  jobs.delete(id);
  j.reject(new CliBridgeError(message, 502));
  return true;
}
