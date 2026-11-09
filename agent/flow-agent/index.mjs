// Agente local do Google Flow para a CollabSuite.
// Mesmo método do CarrosselX: abre o navegador (Chrome/Brave/Edge) com um PERFIL DEDICADO e a porta de depuração ligada,
// conecta o Playwright a essa janela e usa a tela do Flow (em português) com os créditos do seu plano.
// O login do Google é feito uma vez nessa janela e fica salvo no perfil.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HERE, "config.json");
const CDP_PORT = 9333;
const FLOW_URL = "https://flow.google.com/";
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "CollabSuiteFlow", "profile");
const GENERATE_TIMEOUT_MS = 240000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ---- configuração ------------------------------------------------------------------------------------------------
async function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { /* primeira execução */ }
  cfg.server = process.env.COLLAB_SERVER || cfg.server;
  cfg.token = process.env.COLLAB_TOKEN || cfg.token;
  if (!cfg.server || !cfg.token) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("Primeira execução: informe os dados de conexão (Carrosséis > Prompts e estilos > Google Flow).");
    cfg.server = (await rl.question("Endereço da CollabSuite (ex.: https://suaempresa.com): ")).trim().replace(/\/+$/, "");
    cfg.token = (await rl.question("Código de conexão: ")).trim();
    rl.close();
    fs.writeFileSync(CONFIG, JSON.stringify({ server: cfg.server, token: cfg.token, browser: cfg.browser || "" }, null, 2));
  }
  return cfg;
}

// ---- navegador ---------------------------------------------------------------------------------------------------
function browserCandidates(custom) {
  const pf = process.env.ProgramFiles || "C:/Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  return [
    custom,
    `${pf}/Google/Chrome/Application/chrome.exe`, `${pf86}/Google/Chrome/Application/chrome.exe`, `${local}/Google/Chrome/Application/chrome.exe`,
    `${pf}/BraveSoftware/Brave-Browser/Application/brave.exe`, `${local}/BraveSoftware/Brave-Browser/Application/brave.exe`,
    `${pf86}/Microsoft/Edge/Application/msedge.exe`, `${pf}/Microsoft/Edge/Application/msedge.exe`,
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean).filter((p) => fs.existsSync(p));
}

async function cdpAlive() {
  try { return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

async function ensureBrowser(custom) {
  if (await cdpAlive()) return;
  const exe = browserCandidates(custom)[0];
  if (!exe) throw new Error('Não encontrei o Chrome, Brave ou Edge. Informe o caminho em config.json (campo "browser").');
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE_DIR}`, "--no-first-run", "--no-default-browser-check", FLOW_URL], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40; i++) { await sleep(500); if (await cdpAlive()) return; }
  throw new Error("O navegador abriu, mas não liberou o controle remoto. Feche a janela do Flow e tente de novo.");
}

// ---- Flow --------------------------------------------------------------------------------------------------------
class Flow {
  constructor(browser) {
    this.ctx = browser.contexts()[0];
    this.page = this.ctx.pages().find((p) => p.url().includes("flow.google.com")) || null;
  }

  async ensurePage() {
    if (!this.page || this.page.isClosed()) this.page = await this.ctx.newPage();
    return this.page;
  }

  async need(locator, what, timeout = 20000) {
    try {
      await locator.first().waitFor({ state: "visible", timeout });
      return locator.first();
    } catch {
      const names = await this.page.evaluate(() => [...new Set([...document.querySelectorAll("[aria-label]")].filter((e) => e.offsetParent).map((e) => e.getAttribute("aria-label")))].slice(0, 30).join(" | "));
      throw new Error(`Não encontrei ${what} na tela do Flow (a interface pode ter mudado). Elementos visíveis: ${names}`);
    }
  }

  async openProject(url, title) {
    const pg = await this.ensurePage();
    if (url) {
      await pg.goto(url, { waitUntil: "domcontentloaded" });
      await this.need(pg.getByRole("textbox", { name: "O que você quer criar?" }), "a caixa de comando do projeto", 30000);
      return pg.url();
    }
    await pg.goto(FLOW_URL, { waitUntil: "domcontentloaded" });
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      if (pg.url().includes("accounts.google") || (await pg.getByText(/^(Fazer login|Sign in|Entrar)$/).count())) {
        throw new Error("Você ainda não está logado no Google nessa janela do Flow. Faça o login na janela que abriu e gere de novo.");
      }
      if (await pg.getByText("Novo projeto").count()) break;
      await pg.waitForTimeout(500);
    }
    await (await this.need(pg.getByText("Novo projeto"), 'o botão "Novo projeto"', 30000)).click();
    await pg.waitForURL(/\/project\//, { timeout: 30000 });
    await this.need(pg.getByRole("textbox", { name: "O que você quer criar?" }), "a caixa de comando do projeto", 30000);
    try { const name = pg.getByLabel("Texto editável").first(); await name.fill(title); await name.press("Enter"); } catch { /* não é essencial */ }
    return pg.url();
  }

  async clearPrompt() {
    const pg = this.page;
    for (let i = 0; i < 12; i++) {
      const chip = pg.locator('button[aria-label="Elemento"]');
      if (!(await chip.count())) break;
      await chip.first().click();
      await pg.waitForTimeout(250);
    }
    const clear = pg.getByLabel("Apagar comando");
    if ((await clear.count()) && (await clear.first().isVisible())) { await clear.first().click(); await pg.waitForTimeout(300); }
  }

  async attach(file) {
    const pg = this.page;
    const title = path.basename(file);
    await (await this.need(pg.getByLabel("Adicionar elementos à caixa de comando"), 'o botão "+" do comando')).click();
    const search = await this.need(pg.getByLabel("Pesquisar recursos"), "o campo de busca de recursos");
    await search.fill(title);
    await pg.waitForTimeout(900);
    const option = pg.locator("button.asset-item").filter({ hasText: title });
    if (!(await option.count())) { // ainda não foi enviada a este projeto: janela de arquivos de verdade
      const [chooser] = await Promise.all([
        pg.waitForEvent("filechooser", { timeout: 15000 }),
        (await this.need(pg.getByRole("button", { name: "Enviar mídia" }), 'o botão "Enviar mídia"')).click(),
      ]);
      await chooser.setFiles(file);
      await search.fill("");
      await search.fill(title);
      const end = Date.now() + 120000;
      while (Date.now() < end && !(await option.count())) await pg.waitForTimeout(1000);
      if (!(await option.count())) throw new Error(`O Flow não confirmou o envio de ${title} em 2 minutos.`);
    }
    await pg.waitForTimeout(2500); // o recurso recém-enviado ainda está sendo processado pelo Flow
    const chips = pg.locator('button[aria-label="Elemento"]');
    const attached = async () => (await chips.count()) + (await this.composerImages());
    const before = await attached();
    for (let attempt = 0; attempt < 3 && (await attached()) <= before; attempt++) {
      await option.first().click();
      await pg.waitForTimeout(1200);
      const include = pg.getByRole("button", { name: /Incluir no comando/ });
      if ((await include.count()) && (await include.first().isVisible())) await include.first().click();
      const end = Date.now() + 5000;
      while (Date.now() < end && (await attached()) <= before) await pg.waitForTimeout(300);
    }
    if ((await attached()) <= before) {
      const near = await this.composerLabels();
      throw new Error(`Não consegui incluir ${title} no comando do Flow. Elementos da caixa de comando: ${near}`);
    }
    await pg.waitForTimeout(400);
  }

  /** Quantidade de miniaturas (imagens) dentro da caixa de comando: sinal alternativo de que o anexo entrou. */
  composerImages() {
    return this.page.evaluate(() => {
      const box = document.querySelector('[aria-label*="O que você quer criar"]');
      let root = box;
      for (let i = 0; i < 5 && root && root.parentElement; i++) root = root.parentElement;
      return root ? root.querySelectorAll("img").length : 0;
    });
  }

  composerLabels() {
    return this.page.evaluate(() => {
      const box = document.querySelector('[aria-label*="O que você quer criar"]');
      let root = box;
      for (let i = 0; i < 5 && root && root.parentElement; i++) root = root.parentElement;
      if (!root) return "(caixa não encontrada)";
      const items = [...root.querySelectorAll("[aria-label], img, button")].slice(0, 25).map((e) => `${e.tagName.toLowerCase()}:${e.getAttribute("aria-label") || (e.innerText || "").trim().slice(0, 20) || e.getAttribute("alt") || ""}`);
      return items.join(" | ");
    });
  }

  async setOptions() { // Imagem, 3:4 (o mais próximo do 4:5 do Instagram) e uma imagem por geração
    const pg = this.page;
    await (await this.need(pg.getByLabel("Gatilho de configurações"), "o seletor de modelo e proporção")).click();
    await pg.waitForTimeout(500);
    for (const name of ["Imagem", "3:4", "x1"]) {
      const radio = pg.getByRole("radio", { name: new RegExp(name) });
      if (await radio.count()) { await radio.first().click(); await pg.waitForTimeout(250); }
    }
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(300);
  }

  imageIds() {
    return this.page.evaluate(() => {
      const out = {};
      for (const i of document.querySelectorAll("img")) {
        if (!i.offsetParent || i.naturalWidth <= 300 || !i.src.includes("flow-content")) continue;
        const m = i.src.match(/\/image\/([0-9a-f-]{36})/);
        if (m) out[m[1]] = [i.src, i.naturalWidth * i.naturalHeight];
      }
      return out;
    });
  }

  generating() {
    return this.page.evaluate(() => [...document.querySelectorAll("*")].some((e) => e.children.length === 0 && e.offsetParent && /^\d{1,3}%$/.test((e.innerText || "").trim())));
  }

  errorText() {
    return this.page.evaluate(() => {
      const n = document.querySelector("simple-snack-bar, [role=alert], .mat-mdc-snack-bar-label");
      return n && n.offsetParent !== null ? (n.innerText || "").trim().slice(0, 200) : "";
    });
  }

  async generate(prompt, files) {
    const pg = this.page;
    await this.clearPrompt();
    for (const f of files) await this.attach(f);
    await this.setOptions();
    const box = await this.need(pg.getByRole("textbox", { name: "O que você quer criar?" }), "a caixa de comando");
    await box.click();
    await pg.keyboard.insertText(prompt.slice(0, 4500));
    await pg.waitForTimeout(400);
    const known = new Set(Object.keys(await this.imageIds()));
    await (await this.need(pg.getByLabel("Iniciar geração"), "o botão de gerar")).click();

    const end = Date.now() + GENERATE_TIMEOUT_MS;
    let picked = null;
    while (Date.now() < end) {
      await pg.waitForTimeout(2500);
      const fresh = Object.entries(await this.imageIds()).filter(([k]) => !known.has(k));
      if (fresh.length && !(await this.generating())) { picked = fresh.sort((a, b) => b[1][1] - a[1][1])[0][1][0]; break; }
      const err = await this.errorText();
      if (err && !fresh.length) throw new Error(`O Flow recusou a geração: ${err}`);
    }
    if (!picked) throw new Error("O Flow não devolveu a imagem em 4 minutos (limite de uso, filtro de segurança ou falha). Veja a janela do Flow.");
    const res = await this.ctx.request.get(picked);
    if (res.status() !== 200) throw new Error(`Não consegui baixar a imagem do Flow (HTTP ${res.status()}).`);
    return Buffer.from(await res.body());
  }
}

// ---- servidor ----------------------------------------------------------------------------------------------------
function api(cfg, method, route, body) {
  return fetch(`${cfg.server}/api/carrosseis/flow/${route}`, {
    method, headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  const cfg = await loadConfig();
  log("CollabSuite · agente do Google Flow");
  log(`Servidor: ${cfg.server}`);
  await ensureBrowser(cfg.browser);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const flow = new Flow(browser);
  const projects = new Map();
  log("Pronto. Se for a primeira vez, faça o login do Google na janela do Flow que abriu. Aguardando pedidos…");

  for (;;) {
    let job;
    try {
      const res = await api(cfg, "GET", "next");
      if (res.status === 204) continue;
      if (res.status === 401) throw new Error("Código de conexão inválido ou expirado. Gere outro na CollabSuite e apague o config.json.");
      if (!res.ok) throw new Error(`servidor respondeu ${res.status}`);
      job = await res.json();
    } catch (e) {
      if (/inválido/.test(e.message)) { log(e.message); process.exit(1); }
      log(`Sem conexão com o servidor (${e.message}). Tentando de novo em 5 s…`);
      await sleep(5000);
      continue;
    }

    log(`Pedido ${job.id}: ${job.title}`);
    const ping = setInterval(() => api(cfg, "POST", "ping").catch(() => undefined), 10000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-refs-"));
    try {
      await ensureBrowser(cfg.browser);
      const files = job.refs.map((r) => { const f = path.join(dir, r.name); fs.writeFileSync(f, Buffer.from(r.data_base64, "base64")); return f; });
      const url = await flow.openProject(projects.get(job.project_key) || "", job.title);
      projects.set(job.project_key, url);
      const png = await flow.generate(job.prompt, files);
      const out = await api(cfg, "POST", `jobs/${job.id}/result`, { image_base64: png.toString("base64") });
      log(out.ok ? "Imagem enviada." : `Servidor recusou a imagem (${out.status}).`);
    } catch (e) {
      log(`Erro: ${e.message}`);
      await api(cfg, "POST", `jobs/${job.id}/error`, { message: e.message }).catch(() => undefined);
    } finally {
      clearInterval(ping);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
