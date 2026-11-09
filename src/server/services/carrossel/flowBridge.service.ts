/**
 * Ponte com a extensão "CollabSuite · Google Flow" (extension/flow-bridge).
 *
 * O Flow não tem API: quem gera é a extensão, dentro do navegador do usuário (logado no Google). Aqui ficam só a fila de
 * pedidos (em memória, por usuário), o heartbeat da extensão e o recebimento da imagem pronta.
 */
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { AIGenerationError } from "./aiClient";

const JWT_SECRET = process.env.JWT_SECRET || "collabsuite-secret-key-change-in-production";
const CONNECTED_WINDOW_MS = 45_000; // a extensão pergunta por trabalho a cada ~25 s
const JOB_TIMEOUT_MS = 6 * 60_000;
const POLL_MS = 25_000;

export interface FlowRef { name: string; mime: string; data_base64: string }
export interface FlowJob {
  id: string;
  user_id: number;
  prompt: string;
  refs: FlowRef[];
  project_key: string;
  title: string;
  status: "pending" | "claimed" | "done" | "error";
  created_at: number;
  resolve: (png: Buffer) => void;
  reject: (e: Error) => void;
}

const jobs = new Map<string, FlowJob>();
const lastSeen = new Map<number, number>();
const waiters = new Map<number, (() => void)[]>();

/** Token de longa duração só para a extensão (mesmo formato do login, então o requireAuth o aceita). */
export function createExtensionToken(userId: number, email: string): string {
  return jwt.sign({ userId, email, via: "flow-extension" }, JWT_SECRET, { expiresIn: "180d" });
}

export const touch = (userId: number) => { lastSeen.set(userId, Date.now()); };
export const isConnected = (userId: number) => Date.now() - (lastSeen.get(userId) || 0) < CONNECTED_WINDOW_MS;
export const pendingCount = (userId: number) => [...jobs.values()].filter((j) => j.user_id === userId && j.status !== "done" && j.status !== "error").length;

function wake(userId: number) {
  for (const w of waiters.get(userId) || []) w();
  waiters.delete(userId);
}

/** Enfileira um pedido e espera a extensão devolver a imagem (PNG). */
export function requestImage(userId: number, input: { prompt: string; refs: FlowRef[]; project_key: string; title: string }): Promise<Buffer> {
  if (!isConnected(userId)) {
    throw new AIGenerationError("A extensão do Google Flow não está conectada. Abra o navegador com a extensão ativa (veja \"Prompts e estilos\" > Google Flow).", 400);
  }
  return new Promise<Buffer>((resolve, reject) => {
    const job: FlowJob = { id: randomUUID().replace(/-/g, "").slice(0, 12), user_id: userId, ...input, status: "pending", created_at: Date.now(), resolve, reject };
    jobs.set(job.id, job);
    const timer = setTimeout(() => {
      if (job.status === "done" || job.status === "error") return;
      job.status = "error";
      jobs.delete(job.id);
      reject(new AIGenerationError("O Google Flow não devolveu a imagem em 6 minutos. Veja a aba do Flow (limite de uso, filtro de segurança ou login).", 504));
    }, JOB_TIMEOUT_MS);
    const done = () => clearTimeout(timer);
    const origResolve = job.resolve;
    const origReject = job.reject;
    job.resolve = (b) => { done(); origResolve(b); };
    job.reject = (e) => { done(); origReject(e); };
    wake(userId);
  });
}

function claimNext(userId: number): FlowJob | null {
  const job = [...jobs.values()].filter((j) => j.user_id === userId && j.status === "pending").sort((a, b) => a.created_at - b.created_at)[0];
  if (job) job.status = "claimed";
  return job || null;
}

/** Long-poll da extensão: devolve o próximo pedido ou null depois de ~25 s sem nada. */
export async function nextJob(userId: number, signal?: AbortSignal): Promise<FlowJob | null> {
  lastSeen.set(userId, Date.now());
  const now = claimNext(userId);
  if (now) return now;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, POLL_MS);
    const list = waiters.get(userId) || [];
    list.push(() => { clearTimeout(t); resolve(); });
    waiters.set(userId, list);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); });
  });
  lastSeen.set(userId, Date.now());
  return claimNext(userId);
}

export function publicJob(j: FlowJob) {
  return { id: j.id, prompt: j.prompt, refs: j.refs, project_key: j.project_key, title: j.title };
}

export function completeJob(userId: number, id: string, png: Buffer): boolean {
  const j = jobs.get(id);
  if (!j || j.user_id !== userId) return false;
  j.status = "done";
  jobs.delete(id);
  j.resolve(png);
  return true;
}

export function failJob(userId: number, id: string, message: string): boolean {
  const j = jobs.get(id);
  if (!j || j.user_id !== userId) return false;
  j.status = "error";
  jobs.delete(id);
  j.reject(new AIGenerationError(`Google Flow: ${message}`, 502));
  return true;
}
