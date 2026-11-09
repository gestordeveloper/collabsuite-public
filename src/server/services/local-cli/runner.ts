/**
 * Executa um CLI de IA instalado na máquina do servidor (claude, codex, gemini...) como se fosse um provedor:
 * o prompt entra por stdin (ou como último argumento) e a resposta sai pelo stdout (ou por um arquivo {outfile}).
 * Roda numa pasta temporária vazia, para o agente do CLI não mexer no código do projeto.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CliRunConfig {
  command: string;
  args: string;
  prompt_mode: string; // stdin | arg
  timeout_sec: number;
}

export class LocalCliError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const IS_WIN = process.platform === "win32";

/** Divide a linha de argumentos respeitando aspas simples e duplas. */
export function tokenizeArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line || ""))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Aplica {model}/{outfile}. Sem modelo, remove o argumento com {model} e a flag (-m/--model) que o antecede. */
export function buildArgs(template: string, model: string, outfile: string): string[] {
  const out: string[] = [];
  for (const tok of tokenizeArgs(template)) {
    if (tok.includes("{model}")) {
      if (!model) {
        if (out.length && out[out.length - 1].startsWith("-")) out.pop();
        continue;
      }
      out.push(tok.replace(/\{model\}/g, model));
    } else out.push(tok.replace(/\{outfile\}/g, outfile));
  }
  return out;
}

const winQuote = (s: string) => (/^[\w\-./:\\=@]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(pid, "SIGKILL");
  } catch { /* já encerrou */ }
}

export async function runCli(cfg: CliRunConfig, model: string, prompt: string): Promise<string> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "collabsuite-cli-"));
  const outfile = path.join(workDir, "out.txt");
  const args = buildArgs(cfg.args, model, outfile);
  if (cfg.prompt_mode === "arg") args.push(prompt);
  const useOutfile = cfg.args.includes("{outfile}");
  const timeoutMs = Math.max(10, cfg.timeout_sec || 300) * 1000;

  try {
    return await new Promise<string>((resolve, reject) => {
      // .cmd/.bat do npm só rodam via shell no Windows (o comando vem do cadastro feito por um admin); .exe roda direto, sem o limite de tamanho do cmd
      const child = IS_WIN && !/\.exe$/i.test(cfg.command)
        ? spawn([winQuote(cfg.command), ...args.map(winQuote)].join(" "), { cwd: workDir, shell: true, windowsHide: true })
        : spawn(cfg.command, args, { cwd: workDir, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let done = false;
      let timer: NodeJS.Timeout;
      const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
      timer = setTimeout(() => {
        killTree(child.pid);
        finish(() => reject(new LocalCliError(`O CLI '${cfg.command}' passou de ${cfg.timeout_sec}s sem responder e foi encerrado.`, 504)));
      }, timeoutMs);

      child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
      child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
      child.on("error", (e: NodeJS.ErrnoException) => finish(() => reject(new LocalCliError(
        e.code === "ENOENT"
          ? `Não encontrei o comando '${cfg.command}' neste servidor. Instale o CLI ou informe o caminho completo.`
          : `Falha ao iniciar '${cfg.command}': ${e.message}`, 502))));
      child.on("close", (code) => finish(() => {
        let text = stdout;
        if (useOutfile) {
          try { const f = fs.readFileSync(outfile, "utf8"); if (f.trim()) text = f; } catch { /* usa o stdout */ }
        }
        text = text.replace(ANSI_RE, "").trim();
        if (code !== 0 && !text) {
          const err = stderr.replace(ANSI_RE, "").trim();
          if (/not recognized|não é reconhecido|command not found/i.test(err)) {
            return reject(new LocalCliError(`Não encontrei o comando '${cfg.command}' neste servidor. Instale o CLI ou informe o caminho completo.`));
          }
          return reject(new LocalCliError(`O CLI '${cfg.command}' terminou com erro (${code}): ${err.slice(-400) || "sem detalhes"}`));
        }
        if (!text) return reject(new LocalCliError(`O CLI '${cfg.command}' não devolveu resposta.`));
        resolve(text);
      }));

      child.stdin.on("error", () => { /* o CLI pode fechar o stdin antes */ });
      if (cfg.prompt_mode === "arg") child.stdin.end();
      else child.stdin.end(prompt, "utf8");
    });
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => undefined);
  }
}

/** Monta um único texto de prompt a partir de system + conversa (CLIs recebem texto puro). */
export function composePrompt(system: string | undefined, messages: { role: string; content: string }[]): string {
  const parts: string[] = [
    "Responda apenas com o conteúdo pedido, diretamente. Não use ferramentas, não leia nem edite arquivos, não faça perguntas e não explique o que está fazendo.",
  ];
  if (system) parts.push(`## INSTRUÇÕES\n${system}`);
  if (messages.length === 1) parts.push(`## PEDIDO\n${messages[0].content}`);
  else for (const m of messages) parts.push(`## ${m.role === "assistant" ? "SUA RESPOSTA ANTERIOR" : "PEDIDO"}\n${m.content}`);
  return parts.join("\n\n");
}

/** Procura um executável no PATH (where/which). */
export function commandExists(command: string): string | null {
  try {
    const r = spawnSync(IS_WIN ? "where" : "which", [command], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0) return null;
    return (r.stdout || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}
