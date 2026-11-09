// Service worker: pergunta ao servidor da CollabSuite se há imagem para gerar (long-poll) e entrega à aba do Flow.
const FLOW = "https://flow.google.com/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pending = new Map(); // jobId -> {resolve, reject}
let looping = false;

const getCfg = () => chrome.storage.local.get(["server", "token", "projects"]);
const setStatus = (status) => chrome.storage.local.set({ status, statusAt: Date.now() });

async function loop() {
  if (looping) return;
  looping = true;
  try {
    for (;;) {
      const cfg = await getCfg();
      if (!cfg.server || !cfg.token) { await setStatus("Não configurada"); return; }
      try {
        await setStatus("Conectada, aguardando pedidos"); // a consulta abaixo fica aberta ~25 s; sem isto o aviso antigo ficaria na tela
        const res = await fetch(`${cfg.server}/api/carrosseis/flow/next`, { headers: { Authorization: `Bearer ${cfg.token}` } });
        if (res.status === 401) { await setStatus("Código de conexão inválido ou expirado"); return; }
        if (res.status === 204) { await setStatus("Conectada, aguardando pedidos"); continue; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await handle(cfg, await res.json());
      } catch (e) {
        await setStatus(`Sem conexão com o servidor (${e.message || e}). Tentando de novo…`);
        await sleep(5000);
      }
    }
  } finally {
    looping = false;
  }
}

async function post(cfg, path, body) {
  const res = await fetch(`${cfg.server}/api/carrosseis/flow/jobs/${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`servidor respondeu ${res.status}`);
}

async function findFlowTab() {
  const tabs = await chrome.tabs.query({ url: `${FLOW}*` });
  return tabs[0] || null;
}

async function waitComplete(tabId) {
  for (let i = 0; i < 120; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return;
    await sleep(500);
  }
}

async function ensureTab(url) {
  let tab = await findFlowTab();
  if (!tab) tab = await chrome.tabs.create({ url: url || FLOW, active: true });
  else if (url && tab.url !== url) await chrome.tabs.update(tab.id, { url, active: true });
  else if (!url && !tab.url.includes("/project/")) await chrome.tabs.update(tab.id, { url: FLOW });
  await waitComplete(tab.id);
  for (let i = 0; i < 40; i++) { // espera o content script responder
    try { const r = await chrome.tabs.sendMessage(tab.id, { cmd: "ping" }); if (r?.ok) return tab.id; } catch { /* ainda carregando */ }
    await sleep(500);
  }
  throw new Error("A aba do Flow não respondeu. Recarregue a página do Flow e tente de novo.");
}

async function handle(cfg, job) {
  await setStatus(`Gerando: ${job.title}`);
  // enquanto trabalha, não consulta o servidor: este aviso mantém a extensão marcada como conectada
  const ping = setInterval(() => fetch(`${cfg.server}/api/carrosseis/flow/ping`, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}` } }).catch(() => undefined), 10000);
  try {
    const known = (cfg.projects || {})[job.project_key];
    const tabId = await ensureTab(known || null);
    const result = new Promise((resolve, reject) => pending.set(job.id, { resolve, reject }));
    const start = await chrome.tabs.sendMessage(tabId, { cmd: "run", job });
    if (start?.error) throw new Error(start.error);
    const done = await result;
    // baixa a imagem aqui (com os cookies do Google) e entrega ao servidor em base64
    const img = await fetch(done.imageUrl, { credentials: "include" });
    if (!img.ok) throw new Error(`não consegui baixar a imagem do Flow (HTTP ${img.status})`);
    const bytes = new Uint8Array(await img.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await post(cfg, `${job.id}/result`, { image_base64: btoa(bin) });
    const projects = { ...(cfg.projects || {}), [job.project_key]: done.projectUrl };
    await chrome.storage.local.set({ projects });
  } catch (e) {
    pending.delete(job.id);
    clearInterval(ping);
    await post(cfg, `${job.id}/error`, { message: e.message || String(e) }).catch(() => undefined);
    await setStatus(`Erro: ${e.message || e}`);
  } finally {
    clearInterval(ping);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.cmd === "hb") { setStatus(msg.stage || "Gerando"); return; }
  const p = pending.get(msg.jobId);
  if (!p) return;
  pending.delete(msg.jobId);
  if (msg.cmd === "done") p.resolve(msg);
  else if (msg.cmd === "failed") p.reject(new Error(msg.message));
  if (msg.cmd === "kick") loop();
});
chrome.runtime.onMessage.addListener((msg) => { if (msg.cmd === "kick") loop(); });

chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => loop());
chrome.runtime.onStartup.addListener(loop);
chrome.runtime.onInstalled.addListener(loop);
loop();
