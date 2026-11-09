/* StudioX panel for Premiere Pro (UXP).
 * Sends a video to the StudioX app running on this computer (cuts, silences, AI review, captions) and builds the
 * result in Premiere: a sequence already cut (imported from the XML the app writes) plus the captions (SRT). */
const ppro = require("premierepro");
const { storage } = require("uxp");
const fs = storage.localFileSystem;

const $ = (id) => document.getElementById(id);
const state = { path: null, base: null };

function log(text) {
  const el = $("log");
  el.textContent += (el.textContent ? "\n" : "") + text;
  el.scrollTop = el.scrollHeight;
}

function setProgress(pct, text) {
  $("progress").classList.remove("hidden");
  $("bar-fill").style.width = `${Math.max(0, Math.min(100, pct))}%`;
  $("status").textContent = text || "";
}

function setPath(p) {
  state.path = p;
  $("file").textContent = p || "Nenhum vídeo escolhido";
  $("btn-run").disabled = !p || !state.base;
}

// ---- connection --------------------------------------------------------------------------------------------
async function ping(base) {
  try {
    const res = await fetch(`${base}/api/premiere/ping`);
    return res.ok && (await res.json()).app === "StudioX";
  } catch (e) {
    return false;
  }
}

async function connect() {
  const typed = $("server").value.trim().replace(/\/$/, "");
  const candidates = [typed];
  for (let port = 8000; port <= 8010; port++) candidates.push(`http://127.0.0.1:${port}`);
  for (const base of new Set(candidates)) {
    if (await ping(base)) {
      state.base = base;
      $("server").value = base;
      $("conn").className = "dot on";
      $("btn-run").disabled = !state.path;
      return true;
    }
  }
  state.base = null;
  $("conn").className = "dot off";
  $("btn-run").disabled = true;
  return false;
}

async function api(path, options) {
  const res = await fetch(`${state.base}${path}`, options);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (e) { /* not JSON */ }
    throw new Error(String(detail));
  }
  return res;
}

// ---- picking the video -------------------------------------------------------------------------------------
async function pickFile() {
  const file = await fs.getFileForOpening({ types: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mxf"] });
  if (file) setPath(file.nativePath);
}

async function pickSelected() {
  try {
    const project = await ppro.Project.getActiveProject();
    const sequence = project && (await project.getActiveSequence());
    if (!sequence) throw new Error("Abra uma sequência e selecione um clipe nela.");
    const selection = await sequence.getSelection();
    const items = await selection.getTrackItems();
    if (!items || !items.length) throw new Error("Selecione um clipe na timeline.");
    const projectItem = await items[0].getProjectItem();
    const clipItem = ppro.ClipProjectItem.cast(projectItem);
    const path = await clipItem.getMediaFilePath();
    if (!path) throw new Error("Não consegui descobrir o arquivo desse clipe.");
    setPath(path);
  } catch (e) {
    log(`Clipe selecionado: ${e.message}`);
  }
}

// ---- running -----------------------------------------------------------------------------------------------
const STEP_LABEL = { analyze: "Lendo o vídeo", cuts: "Cortando silêncios", transcribe: "Transcrevendo",
  review: "Revisando", captions: "Montando legendas", done: "Pronto" };

async function run() {
  $("btn-run").disabled = true;
  $("log").textContent = "";
  try {
    setProgress(2, "Enviando…");
    const body = {
      path: state.path, language: $("language").value, review: $("review").value,
      auto_cut: $("autocut").checked, copy_text: $("copy").value,
    };
    const started = await (await api("/api/premiere/process", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })).json();

    let job, seen = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      job = await (await api(`/api/premiere/jobs/${started.job_id}`)).json();
      for (const line of job.logs.slice(seen)) log(line);
      seen = job.logs.length;
      setProgress(job.progress, STEP_LABEL[job.step] || job.message);
      if (job.status !== "running") break;
    }
    if (job.status !== "done") throw new Error(job.error || "Falha no processamento");

    const r = job.result;
    (r.warnings || []).forEach((w) => log(`Aviso: ${w}`));
    setProgress(95, "Montando no Premiere…");
    await buildInPremiere(r, $("captions").checked);
    setProgress(100, `Pronto: ${r.clips.length} corte(s), ${r.cues.length} legenda(s)`);
  } catch (e) {
    setProgress(0, "");
    log(`Erro: ${e.message}`);
  } finally {
    $("btn-run").disabled = !state.path;
  }
}

// ---- Premiere ----------------------------------------------------------------------------------------------
async function buildInPremiere(result, withCaptions) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Abra ou crie um projeto no Premiere primeiro.");
  const root = await project.getRootItem();

  // 1. The cut sequence: Premiere imports the XML as a sequence whose clips already are the cuts.
  log("Importando a sequência cortada…");
  const ok = await project.importFiles([result.files.xml], true, root, false);
  if (ok === false) throw new Error(`O Premiere não importou o XML (${result.files.xml}).`);

  // 2. The captions: import the SRT and put it on a caption track of the new sequence.
  if (withCaptions && result.files.srt) {
    log("Importando as legendas…");
    await project.importFiles([result.files.srt], true, root, false);
    try {
      await addCaptionTrack(project, root, result.files.srt);
    } catch (e) {
      log(`As legendas foram importadas para o projeto, mas não consegui colocá-las na timeline (${e.message}). `
        + "Arraste o arquivo .srt para a sequência.");
    }
  }
}

async function addCaptionTrack(project, root, srtPath) {
  const name = srtPath.split(/[\\/]/).pop();
  const items = await root.getItems();
  let captionItem = null;
  for (const it of items) if (it.name === name) captionItem = it;
  if (!captionItem) throw new Error("legenda não encontrada no projeto");
  const sequences = await project.getSequences();
  const sequence = sequences[sequences.length - 1];
  await project.setActiveSequence(sequence);
  await sequence.createCaptionTrack(captionItem, 0, ppro.Constants.CaptionFormat.SUBTITLE);
}

// ---- boot --------------------------------------------------------------------------------------------------
$("btn-pick").addEventListener("click", pickFile);
$("btn-selected").addEventListener("click", pickSelected);
$("btn-run").addEventListener("click", run);
$("btn-test").addEventListener("click", async () => {
  log((await connect()) ? `Conectado a ${state.base}` : "Não encontrei o StudioX. Abra o aplicativo e tente de novo.");
});
connect().then((ok) => { if (!ok) log("StudioX não encontrado. Abra o aplicativo StudioX e toque em Testar conexão."); });
