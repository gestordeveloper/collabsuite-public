// Automação da tela do Google Flow (interface em português). Os seletores são os mesmos que o CarrosselX original usava.
// Se o Google mudar a tela, o erro devolvido diz qual elemento não foi encontrado.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (el) => !!el && el.offsetParent !== null;

async function waitFor(fn, what, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(250);
  }
  const labels = [...new Set([...document.querySelectorAll("[aria-label]")].filter(visible).map((e) => e.getAttribute("aria-label")))].slice(0, 30).join(" | ");
  throw new Error(`Não encontrei ${what} na tela do Flow. A interface pode ter mudado ou estar em outro idioma. Elementos visíveis com nome: ${labels || "(nenhum)"}`);
}

const byLabel = (label) => [...document.querySelectorAll("[aria-label]")].find((e) => e.getAttribute("aria-label") === label && visible(e));
const byLabelPart = (part) => [...document.querySelectorAll("[aria-label]")].find((e) => (e.getAttribute("aria-label") || "").includes(part) && visible(e));
const allByLabel = (label) => [...document.querySelectorAll(`[aria-label="${label}"]`)].filter(visible);
const byText = (re, selector = "button, [role=button], a, div, span") =>
  [...document.querySelectorAll(selector)].find((e) => visible(e) && re.test((e.innerText || e.textContent || "").trim()) && (e.innerText || "").trim().length < 60);
const promptBox = () => byLabelPart("O que você quer criar");

function setValue(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(key) {
  const opts = { key, code: key, bubbles: true };
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", opts));
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keyup", opts));
}

// ---- projeto ----------------------------------------------------------------------------------------------------
async function ensureProject(title) {
  if (location.pathname.includes("/project/")) {
    await waitFor(promptBox, "a caixa de comando do projeto", 30000);
    return;
  }
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (location.hostname.includes("accounts.google") || byText(/^(Fazer login|Sign in|Entrar)$/)) {
      throw new Error("Você não está logado no Google nesta aba do Flow. Faça o login e tente gerar de novo.");
    }
    if (byText(/Novo projeto/)) break;
    await sleep(500);
  }
  (await waitFor(() => byText(/Novo projeto/), 'o botão "Novo projeto"', 30000)).click();
  await waitFor(() => location.pathname.includes("/project/"), "o novo projeto", 30000);
  await waitFor(promptBox, "a caixa de comando do projeto", 30000);
  try { // nome do projeto = série + episódio (não é essencial)
    const name = byLabel("Texto editável");
    if (name) { name.focus(); setValue(name, title); press("Enter"); }
  } catch { /* ignora */ }
}

// ---- comando ----------------------------------------------------------------------------------------------------
async function clearPrompt() {
  for (let i = 0; i < 12; i++) {
    const chip = allByLabel("Elemento")[0];
    if (!chip) break;
    chip.click();
    await sleep(250);
  }
  const clear = byLabel("Apagar comando");
  if (clear) { clear.click(); await sleep(300); }
}

async function attach(ref) {
  const title = ref.name;
  (await waitFor(() => byLabel("Adicionar elementos à caixa de comando"), 'o botão "+" do comando')).click();
  const search = await waitFor(() => byLabel("Pesquisar recursos"), "o campo de busca de recursos");
  const option = () => [...document.querySelectorAll("button.asset-item")].find((b) => visible(b) && (b.innerText || "").includes(title));
  search.focus();
  setValue(search, title);
  await sleep(900);
  if (!option()) { // ainda não foi enviada a este projeto
    const btn = await waitFor(() => byText(/^Enviar mídia$/), 'o botão "Enviar mídia"');
    // avisa a página quais arquivos entregar ANTES de clicar: o seletor de arquivos do Flow é interceptado
    window.dispatchEvent(new CustomEvent("fb-files", { detail: { files: [{ name: title, mime: ref.mime || "image/jpeg", b64: ref.data_base64 }] } }));
    const state = new Promise((resolve) => window.addEventListener("fb-state", (e) => resolve(e.detail.consumed), { once: true }));
    btn.click();
    await sleep(1200);
    window.dispatchEvent(new CustomEvent("fb-fallback"));
    if (!(await Promise.race([state, sleep(2000).then(() => false)]))) {
      throw new Error("Não consegui entregar a imagem de referência ao Flow (ele abriu a seleção de arquivos do sistema). Feche a janela de seleção e me avise para ajustar a extensão.");
    }
    setValue(search, "");
    setValue(search, title);
    const end = Date.now() + 120000;
    while (Date.now() < end && !option()) await sleep(1000);
    if (!option()) throw new Error(`O Flow não confirmou o envio de ${title} em 2 minutos.`);
  }
  const before = allByLabel("Elemento").length;
  option().click();
  await sleep(900);
  const include = byText(/^Incluir no comando$/);
  if (include) include.click(); // às vezes o clique já inclui direto
  const end = Date.now() + 8000;
  while (Date.now() < end && allByLabel("Elemento").length <= before) await sleep(300);
  if (allByLabel("Elemento").length <= before) throw new Error(`Não consegui incluir ${title} no comando do Flow.`);
  await sleep(400);
}

async function setOptions() { // Imagem, 3:4 (o mais próximo do 4:5 do Instagram) e uma imagem por geração
  (await waitFor(() => byLabel("Gatilho de configurações"), "o seletor de modelo e proporção")).click();
  await sleep(500);
  for (const name of ["Imagem", "3:4", "x1"]) {
    const radio = [...document.querySelectorAll("[role=radio]")].find((r) => visible(r) && ((r.getAttribute("aria-label") || "") + (r.innerText || "")).includes(name));
    if (radio) { radio.click(); await sleep(250); }
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  await sleep(300);
}

function imageIds() {
  const out = {};
  for (const i of document.querySelectorAll("img")) {
    if (!i.offsetParent || i.naturalWidth <= 300 || !i.src.includes("flow-content")) continue;
    const m = i.src.match(/\/image\/([0-9a-f-]{36})/);
    if (m) out[m[1]] = [i.src, i.naturalWidth * i.naturalHeight];
  }
  return out;
}
const isGenerating = () => [...document.querySelectorAll("*")].some((e) => e.children.length === 0 && e.offsetParent && /^\d{1,3}%$/.test((e.innerText || "").trim()));
const errorText = () => {
  const n = document.querySelector("simple-snack-bar, [role=alert], .mat-mdc-snack-bar-label");
  return n && n.offsetParent !== null ? (n.innerText || "").trim().slice(0, 200) : "";
};

async function generate(job, heartbeat) {
  await ensureProject(job.title);
  await clearPrompt();
  for (const ref of job.refs) { heartbeat(`Anexando ${ref.name}`); await attach(ref); }
  await setOptions();
  const box = await waitFor(promptBox, "a caixa de comando");
  box.focus();
  document.execCommand("selectAll", false);
  document.execCommand("insertText", false, job.prompt.slice(0, 4500));
  await sleep(400);
  const known = new Set(Object.keys(imageIds()));
  (await waitFor(() => byLabel("Iniciar geração"), "o botão de gerar")).click();
  heartbeat("Gerando no Flow");

  const end = Date.now() + 240000;
  while (Date.now() < end) {
    await sleep(2500);
    heartbeat("Gerando no Flow");
    const fresh = Object.entries(imageIds()).filter(([k]) => !known.has(k));
    if (fresh.length && !isGenerating()) {
      fresh.sort((a, b) => b[1][1] - a[1][1]);
      return { imageUrl: fresh[0][1][0], projectUrl: location.href };
    }
    const err = errorText();
    if (err && !fresh.length) throw new Error(`O Flow recusou a geração: ${err}`);
  }
  throw new Error("O Flow não devolveu a imagem em 4 minutos (limite de uso, filtro de segurança ou falha). Veja a aba do Flow para o motivo.");
}

let busy = false;
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.cmd === "ping") { sendResponse({ ok: true, busy }); return; }
  if (msg.cmd !== "run") return;
  if (busy) { sendResponse({ error: "A aba do Flow já está gerando outra imagem." }); return; }
  busy = true;
  const heartbeat = (stage) => chrome.runtime.sendMessage({ cmd: "hb", stage }).catch(() => undefined);
  generate(msg.job, heartbeat)
    .then((res) => chrome.runtime.sendMessage({ cmd: "done", jobId: msg.job.id, ...res }))
    .catch((e) => chrome.runtime.sendMessage({ cmd: "failed", jobId: msg.job.id, message: e.message || String(e) }))
    .finally(() => { busy = false; });
  sendResponse({ started: true });
});
