// Agente de CLIs de IA para a CollabSuite.
// Conecta o seu computador à CollabSuite: detecta os CLIs instalados aqui (Claude Code, Codex, Gemini, Qwen e outros do
// config.json), recebe os pedidos de texto (roteiros, legendas...) e roda o CLI localmente com o SEU login, devolvendo a resposta.
// O CLI roda numa pasta temporária vazia: ele não lê nem altera os seus projetos.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HERE, "config.json");
const IS_WIN = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local");
const ROAMING = process.env.APPDATA || path.join(HOME, "AppData", "Roaming");

/** Modelos que a conta do Codex aceita: vêm do cache do próprio Codex (a config dele pode apontar para um modelo que a conta recusa). */
function codexModels() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(HOME, ".codex", "models_cache.json"), "utf8"));
    // codex-auto-review é o que qualquer versão do CLI com login ChatGPT aceita; os outros ficam depois (podem exigir um Codex mais novo)
    return ["codex-auto-review", ...(j.models || []).map((m) => m.slug).filter(Boolean)].filter((m, i, a) => a.indexOf(m) === i);
  } catch { return ["codex-auto-review"]; }
}

/** Modelos do Antigravity (`agy models`). Só consulta se o agy existir. */
function agyModels() {
  try {
    const exe = resolveCommand("agy", [path.join(LOCAL, "agy", "bin", "agy.exe")]);
    if (!exe) return [];
    const r = spawnSync(exe, ["models"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    return (r.stdout || "").split(/\r?\n/).map((l) => l.split("\t")[0].trim()).filter((m) => /^[\w.-]+$/.test(m)).slice(0, 40);
  } catch { return []; }
}

// Receitas prontas. {model} some sozinho (com a flag anterior) quando nenhum modelo é pedido; {outfile} = arquivo de resposta.
// "where" = lugares comuns de instalação que costumam ficar FORA do PATH (o agente procura lá também).
const PRESETS = () => [
  { name: "Claude Code", command: "claude", args: "-p --output-format text --model {model}", prompt_mode: "stdin", models: ["sonnet", "opus", "haiku"],
    where: [path.join(HOME, ".local", "bin", "claude.exe"), path.join(HOME, ".claude", "local", "claude.exe"), path.join(ROAMING, "npm", "claude.cmd")] },
  { name: "Codex", command: "codex", args: "exec --skip-git-repo-check --sandbox read-only -c model_reasoning_effort=low --model {model} --output-last-message {outfile} -", prompt_mode: "stdin", models: codexModels(),
    where: [path.join(LOCAL, "Programs", "OpenAI", "Codex", "bin", "codex.exe"), path.join(ROAMING, "npm", "codex.cmd")] },
  { name: "Gemini CLI", command: "gemini", args: "--model {model} -p \"Responda ao pedido recebido.\"", prompt_mode: "stdin", models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    where: [path.join(ROAMING, "npm", "gemini.cmd")] },
  // O agy só aceita o prompt como argumento do -p (não lê do stdin). Roda direto, sem shell, para não esbarrar no limite de ~8 mil caracteres do cmd.
  { name: "Antigravity", command: "agy", args: "--model {model} -p", prompt_mode: "arg", models: agyModels(),
    where: [path.join(LOCAL, "agy", "bin", "agy.exe")] },
  { name: "Qoder", command: "qodercli", args: "--model {model} --tools \"\" -p", prompt_mode: "stdin", models: [],
    where: [path.join(HOME, ".qoder", "bin", "qodercli", "qodercli.exe")] },
  { name: "OpenCode", command: "opencode", args: "run --model {model} \"Siga o pedido recebido.\"", prompt_mode: "stdin", models: [],
    where: [path.join(HOME, ".opencode", "bin", "opencode.exe"), path.join(HOME, ".bun", "bin", "opencode.exe"), path.join(ROAMING, "npm", "opencode.cmd"),
      path.join(LOCAL, "Programs", "Open Design", "resources", "open-design", "bin", "libexec", "opencode", "opencode.exe")] },
  { name: "Qwen Code", command: "qwen", args: "--model {model} -p \"Responda ao pedido recebido.\"", prompt_mode: "stdin", models: [],
    where: [path.join(LOCAL, "qwen-code", "bin", "qwen.cmd")] },
];

// ---- configuração ------------------------------------------------------------------------------------------------
async function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { /* primeira execução */ }
  cfg.server = (process.env.COLLAB_SERVER || cfg.server || "").replace(/\/+$/, "");
  cfg.token = process.env.COLLAB_TOKEN || cfg.token;
  if (!cfg.server || !cfg.token) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("Primeira execução: informe os dados de conexão (Configurações > Integrações > Agente de CLIs).");
    cfg.server = (await rl.question("Endereço da CollabSuite (ex.: https://suaempresa.com): ")).trim().replace(/\/+$/, "");
    cfg.token = (await rl.question("Código de conexão: ")).trim();
    rl.close();
    fs.writeFileSync(CONFIG, JSON.stringify({ server: cfg.server, token: cfg.token, clis: cfg.clis || [] }, null, 2));
  }
  return cfg;
}

/** Procura o executável no PATH; entre os resultados do "where" prefere .exe/.cmd/.bat (o shim sem extensão do npm não roda direto). */
function findOnPath(command) {
  try {
    const r = spawnSync(IS_WIN ? "where" : "which", [command], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0) return null;
    const lines = (r.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.find((l) => /\.(exe|cmd|bat|com)$/i.test(l)) || lines[0] || null;
  } catch { return null; }
}

/** Caminho completo do executável (PATH ou lugares conhecidos), ou null. */
function resolveCommand(command, where = []) {
  if (path.isAbsolute(command) && fs.existsSync(command)) return command;
  return findOnPath(command) || where.find((f) => fs.existsSync(f)) || null;
}

/** CLIs disponíveis: presets encontrados no PATH + os definidos em config.json ("clis": [{name, command, args, models, prompt_mode, timeout_sec}]).
 *  Uma entrada do config com o mesmo nome de um preset substitui o preset (útil para fixar um modelo que a sua conta aceita). */
function availableClis(cfg) {
  const byName = new Map();
  for (const p of PRESETS()) {
    const exe = resolveCommand(p.command, p.where);
    if (exe) byName.set(p.name, { ...p, exe });
  }
  for (const c of cfg.clis || []) {
    if (!c?.name || !c?.command) continue;
    const exe = resolveCommand(c.command);
    if (!exe) { log(`Aviso: o comando "${c.command}" (${c.name}) não foi encontrado e foi ignorado.`); continue; }
    byName.set(c.name, { prompt_mode: "stdin", args: "", models: [], ...(byName.get(c.name) || {}), ...c, exe });
  }
  return [...byName.values()];
}

// ---- execução do CLI ---------------------------------------------------------------------------------------------
function tokenize(line) {
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(line || ""))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function buildArgs(template, model, outfile) {
  const out = [];
  for (const tok of tokenize(template)) {
    if (tok.includes("{model}")) {
      if (!model) { if (out.length && out[out.length - 1].startsWith("-")) out.pop(); continue; }
      out.push(tok.replace(/\{model\}/g, model));
    } else out.push(tok.replace(/\{outfile\}/g, outfile));
  }
  return out;
}

const winQuote = (s) => (/^[\w\-./:\\=@]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

/** Traduz erros comuns dos CLIs em instruções do que fazer. */
function explainError(cli, err, code) {
  const low = err.toLowerCase();
  const tail = err.slice(-300) || "sem detalhes";
  if (/not logged in|\/login|please log ?in|unauthenticated|401|invalid api-key|api key/.test(low)) {
    return `O CLI "${cli.name}" não está autenticado neste computador. Abra o ${cli.command} no terminal, faça o login (ou configure a chave dele) e tente de novo. Detalhe: ${tail}`;
  }
  if (/requires a newer version|upgrade to the latest/.test(low)) {
    return `O modelo escolhido exige uma versão mais nova do ${cli.name}. Atualize o CLI (ou o app) ou escolha outro modelo no seletor. Detalhe: ${tail}`;
  }
  if (/model.*(not supported|not found|does not exist)|model_not_found/.test(low)) {
    return `O CLI "${cli.name}" recusou o modelo. Escolha outro modelo no seletor ou ajuste os modelos dele no config.json do agente. Detalhe: ${tail}`;
  }
  return `O CLI "${cli.name}" terminou com erro (${code}): ${tail}`;
}

function runCli(cli, model, prompt, timeoutSec) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "collabsuite-cli-"));
  const outfile = path.join(workDir, "out.txt");
  const args = buildArgs(cli.args, model, outfile);
  if (cli.prompt_mode === "arg") args.push(prompt);
  const useOutfile = (cli.args || "").includes("{outfile}");
  const timeoutMs = Math.max(10, Math.min(timeoutSec || cli.timeout_sec || 600, 1800)) * 1000;

  return new Promise((resolve, reject) => {
    const exe = cli.exe || cli.command;
    // .exe roda direto (sem o limite de tamanho do cmd); só .cmd/.bat do npm precisam do shell no Windows
    const child = IS_WIN && /\.(cmd|bat)$/i.test(exe)
      ? spawn([winQuote(exe), ...args.map(winQuote)].join(" "), { cwd: workDir, shell: true, windowsHide: true })
      : spawn(exe, args, { cwd: workDir, windowsHide: true });
    let stdout = ""; let stderr = ""; let done = false;
    const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); fs.rm(workDir, { recursive: true, force: true }, () => {}); fn(); };
    const timer = setTimeout(() => {
      try { if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill("SIGKILL"); } catch { /* já saiu */ }
      finish(() => reject(new Error(`O CLI "${cli.name}" passou de ${Math.round(timeoutMs / 1000)}s sem responder e foi encerrado.`)));
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => finish(() => reject(new Error(`Falha ao iniciar "${cli.command}": ${e.message}`))));
    child.on("close", (code) => {
      let text = stdout;
      if (useOutfile) { try { const f = fs.readFileSync(outfile, "utf8"); if (f.trim()) text = f; } catch { /* usa stdout */ } }
      text = text.replace(ANSI_RE, "").trim();
      finish(() => {
        if (code !== 0 && !text) return reject(new Error(explainError(cli, stderr.replace(ANSI_RE, "").trim(), code)));
        if (!text) return reject(new Error(`O CLI "${cli.name}" não devolveu resposta.`));
        resolve(text);
      });
    });
    child.stdin.on("error", () => {});
    if (cli.prompt_mode === "arg") child.stdin.end(); else child.stdin.end(prompt, "utf8");
  });
}

// ---- servidor ----------------------------------------------------------------------------------------------------
const publicClis = (clis) => clis.map((c) => ({ name: c.name, models: c.models || [] }));

function api(cfg, route, body) {
  return fetch(`${cfg.server}/api/cli-agent/${route}`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
  });
}

async function main() {
  const cfg = await loadConfig();
  log("CollabSuite · agente de CLIs");
  log(`Servidor: ${cfg.server}`);
  let clis = availableClis(cfg);
  if (!clis.length) log("Nenhum CLI encontrado (claude, codex, gemini, qwen). Instale um ou defina em config.json (campo \"clis\"). Continuo tentando…");
  else log(`CLIs disponíveis: ${clis.map((c) => c.name).join(", ")}`);
  log("Conectado. Aguardando pedidos… (deixe esta janela aberta enquanto usa a CollabSuite)");

  let lastScan = Date.now();
  for (;;) {
    if (Date.now() - lastScan > 60000) { clis = availableClis(cfg); lastScan = Date.now(); } // pega CLIs instalados depois
    let job;
    try {
      const res = await api(cfg, "next", { clis: publicClis(clis) });
      if (res.status === 204) continue;
      if (res.status === 401) { log("Código de conexão inválido ou expirado. Gere outro na CollabSuite e apague o config.json."); process.exit(1); }
      if (!res.ok) throw new Error(`servidor respondeu ${res.status}`);
      job = await res.json();
    } catch (e) {
      log(`Sem conexão com o servidor (${e.message}). Tentando de novo em 5 s…`);
      await sleep(5000);
      continue;
    }

    const cli = clis.find((c) => c.name === job.cli);
    log(`Pedido ${job.id}: ${job.cli}${job.model ? ` (${job.model})` : ""}`);
    const ping = setInterval(() => api(cfg, "ping", { clis: publicClis(clis) }).catch(() => {}), 10000);
    try {
      if (!cli) throw new Error(`O CLI "${job.cli}" não está mais disponível neste computador.`);
      const text = await runCli(cli, job.model, job.prompt, job.timeout_sec);
      const out = await api(cfg, `jobs/${job.id}/result`, { text });
      log(out.ok ? `Resposta enviada (${text.length} caracteres).` : `Servidor recusou a resposta (${out.status}).`);
    } catch (e) {
      log(`Erro: ${e.message}`);
      await api(cfg, `jobs/${job.id}/error`, { message: e.message }).catch(() => {});
    } finally {
      clearInterval(ping);
    }
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
