import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import http from "http";
import path from "path";

/**
 * StudioX (editor de vídeo) é um app Python/FastAPI que mora em `studiox/`. Roda como processo-filho do servidor,
 * só em 127.0.0.1, e só é alcançado através do proxy autenticado (`proxy.ts`). Sobe sob demanda, na primeira vez
 * que alguém abre o editor, para não exigir Python em quem nunca o usa.
 */
const ROOT = path.join(process.cwd(), "studiox");
export const STUDIOX_PORT = parseInt(process.env.STUDIOX_PORT || "8765");
export const STUDIOX_BASE = "/studiox";
const STARTUP_TIMEOUT_MS = 90_000;

let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;
let lastError: string | null = null;
const logTail: string[] = [];

function pythonCandidates(): string[] {
  const venv = process.platform === "win32"
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");
  const list = [process.env.STUDIOX_PYTHON, venv, process.platform === "win32" ? "python" : "python3", "python"];
  return list.filter((p): p is string => !!p && (!path.isAbsolute(p) || fs.existsSync(p)));
}

function storageDir() {
  return path.resolve(process.env.STUDIOX_STORAGE_DIR || path.join(ROOT, "storage"));
}

export function studioxInstalled() {
  return fs.existsSync(path.join(ROOT, "server.py"));
}

function ping(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: STUDIOX_PORT, path: "/api/status", timeout: 2000 }, (res) => {
      res.resume();
      resolve((res.statusCode || 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function remember(chunk: Buffer) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    logTail.push(line);
    if (logTail.length > 40) logTail.shift();
  }
}

function launch(python: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(python, ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", String(STUDIOX_PORT)], {
      cwd: ROOT,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
        STUDIOX_URL_BASE: STUDIOX_BASE,
        VIDEOUSE_STORAGE_DIR: storageDir(),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    proc.stdout?.on("data", remember);
    proc.stderr?.on("data", remember);
    proc.once("error", (err) => { if (!settled) { settled = true; reject(err); } });
    proc.once("exit", (code) => {
      if (child === proc) child = null;
      if (!settled) { settled = true; reject(new Error(`o processo terminou com código ${code}`)); }
    });
    child = proc;

    const startedAt = Date.now();
    const poll = async () => {
      if (settled) return;
      if (await ping()) { settled = true; return resolve(); }
      if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) {
        settled = true;
        proc.kill();
        return reject(new Error("tempo esgotado esperando o StudioX subir"));
      }
      setTimeout(poll, 500);
    };
    void poll();
  });
}

/** Garante que o StudioX está de pé; chamadas simultâneas esperam a mesma subida. */
export function ensureStudioxRunning(): Promise<void> {
  if (!studioxInstalled()) return Promise.reject(new Error("A pasta studiox/ não existe nesta instalação."));
  if (child && !child.killed) return starting ?? Promise.resolve();
  if (starting) return starting;

  starting = (async () => {
    const errors: string[] = [];
    for (const python of pythonCandidates()) {
      logTail.length = 0;
      try {
        await launch(python);
        lastError = null;
        console.log(`[StudioX] no ar em 127.0.0.1:${STUDIOX_PORT} (${python})`);
        return;
      } catch (err: any) {
        errors.push(`${python}: ${err?.message || err}`);
        child?.kill();
        child = null;
      }
    }
    const detail = logTail.slice(-6).join(" | ");
    lastError = `Não foi possível iniciar o StudioX. Instale as dependências (pip install -r studiox/requirements.txt) e o FFmpeg. ${errors.join("; ")}${detail ? ` — ${detail}` : ""}`;
    throw new Error(lastError);
  })().finally(() => { starting = null; });
  return starting;
}

export async function studioxStatus() {
  return { installed: studioxInstalled(), running: await ping(), error: lastError };
}

export function stopStudiox() {
  if (child && !child.killed) child.kill();
  child = null;
}

process.on("exit", stopStudiox);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { stopStudiox(); process.exit(0); });
