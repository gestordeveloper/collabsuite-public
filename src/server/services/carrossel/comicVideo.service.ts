/**
 * Mini-novela HQ em vídeo narrado: as imagens da história (sem balões) + uma locução, montadas em MP4.
 *
 * A locução vem de duas fontes:
 *   - ElevenLabs: o app gera um mp3 por slide a partir do texto de narração. A duração de cada slide é a do seu áudio,
 *     então imagem e voz ficam sincronizadas.
 *   - Áudio enviado (gravação sua ou de outra pessoa): um arquivo único. O tempo de cada slide é proporcional ao tamanho
 *     do texto de narração, que serve de roteiro para a leitura.
 * O ffmpeg faz o vídeo (zoom lento nas imagens, legendas opcionais).
 */
import { createHash } from "crypto";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { fetchStoredFileBytes } from "../../lib/fileStorage";
import { ffmpegBinary, probeDurationSeconds, runFfmpeg } from "../../lib/ffmpeg";
import { storeBuffer } from "../../controllers/upload.controller";
import { report, type ProgressFn } from "./aiClient";
import type { Actor } from "./ai.service";
import * as comic from "./comic.service";
import * as eleven from "./eleven.service";
import { VideoError } from "./eleven.service";
import { htmlToPng } from "./render.service";
import { speak } from "./ptNumbers";
import { COMING_SOON_DATA_URI } from "./comicFont";

export { VideoError };

const FPS = 30;
const MIN_SLIDE_SEC = 2.0;
const TAIL_SEC = 0.45; // respiro depois de cada fala (modo ElevenLabs)
const SIZES: Record<string, [number, number]> = { reels: [1080, 1920], feed: [1080, 1350] };
const INTRO_MIN_SEC = 4.2;
const INTRO_VOICE_DELAY = 0.9; // a voz entra depois do título aparecer
const AUDIO_EXTS = ["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "webm", "opus"];
const MAX_AUDIO_BYTES = 120 * 1024 * 1024;

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function ffmpeg(args: string[], what: string): Promise<void> {
  try {
    await runFfmpeg(["-y", ...args]);
  } catch (e) {
    const msg = ((e as Error).message || "").split("\n").slice(-4).join(" | ").slice(0, 400);
    throw new VideoError(`Falha ao ${what} com o ffmpeg: ${msg}`, 500);
  }
}

async function download(url: string, dest: string): Promise<string> {
  await fsp.writeFile(dest, await fetchStoredFileBytes(url));
  return dest;
}

// ====================================================================================================================
// Narração (ElevenLabs)
// ====================================================================================================================
function narratorVoice(series: comic.Series, ep: comic.Episode, defaultVoice: string): string {
  const voice = (ep.voice_id || series.narrator_voice_id || defaultVoice || "").trim();
  if (!voice) throw new VideoError("Escolha a voz do narrador (na série ou no episódio) ou uma voz padrão em \"Prompts e estilos\".", 400);
  return voice;
}

/** Quem fala o quê neste slide: [(voice_id, texto, é_personagem)]. O narrador abre e depois cada personagem usa a própria voz. */
function slideSegments(series: comic.Series, s: comic.ComicSlide, narr: string): [string, string, boolean][] {
  const text = s.voice_text.trim();
  if (text && text !== (s.voice_auto || "").trim()) return [[narr, text, false]]; // editado à mão: lido inteiro pela voz do narrador
  const segs: [string, string, boolean][] = [];
  if (s.narrator.trim()) segs.push([narr, s.narrator.trim(), false]);
  for (const d of s.dialogues) {
    if (d.text.trim()) {
      const c = comic.matchCharacter(d.character, series.characters);
      segs.push([c?.voice_id || narr, d.text.trim(), true]);
    }
  }
  return segs.length ? segs : text ? [[narr, text, false]] : [];
}

async function concatAudio(files: string[], out: string, gap = 0.2): Promise<void> {
  const inputs = files.flatMap((f) => ["-i", f]);
  const parts = files.map((_, i) => `[${i}:a]aresample=44100${i < files.length - 1 ? `,apad=pad_dur=${gap}` : ""}[a${i}]`);
  const chain = `${parts.join(";")};${files.map((_, i) => `[a${i}]`).join("")}concat=n=${files.length}:v=0:a=1[a]`;
  await ffmpeg([...inputs, "-filter_complex", chain, "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "128k", out], "juntar as vozes");
}

/** Gera (ou reaproveita) o áudio de cada slide, com a voz do narrador e a de cada personagem. */
export async function generateNarration(actor: Actor, series: comic.Series, ep: comic.Episode, progress?: ProgressFn): Promise<comic.Episode> {
  const settings = await eleven.getSettings(actor.userId);
  const narr = narratorVoice(series, ep, settings.voice_id);
  const model = settings.model;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hq-voice-"));
  try {
    const plan: { slide: comic.ComicSlide; items: { voice: string; plain: string; directed: string; st: eleven.VoiceStyle }[] }[] = [];
    for (const s of ep.slides) {
      const segs = slideSegments(series, s, narr);
      if (!segs.length) continue;
      const stN = eleven.styleFor(s.element, ep.narration_style);
      const stD = eleven.dialogueStyle(stN);
      plan.push({
        slide: s,
        items: segs.map(([voice, text, isChar]) => {
          const st = isChar ? stD : stN;
          const plain = speak(text); // números e valores por extenso só na voz; a legenda mantém o original
          return { voice, plain, directed: eleven.directText(plain, st, model), st };
        }),
      });
    }
    if (!plan.length) throw new VideoError("Nenhum slide tem texto de narração.", 400);

    const flat = plan.flatMap((p) => p.items);
    flat.forEach((it, k) => Object.assign(it, { prev: k ? flat[k - 1].plain : "", next: k + 1 < flat.length ? flat[k + 1].plain : "", fp: sha(`${it.voice}|${model}|${JSON.stringify(it.st)}|${it.directed}`) }));

    for (let i = 0; i < plan.length; i++) {
      const { slide: s, items } = plan[i];
      report(progress, `Gerando as vozes do slide ${s.n} de ${ep.slides.length}`, 5 + Math.floor((45 * i) / plan.length));
      const slideFp = sha(items.map((it: any) => it.fp).join("|"));
      if (s.audio && s.audio_text === slideFp) continue;
      const files: string[] = [];
      for (let k = 0; k < items.length; k++) {
        const it: any = items[k];
        const f = path.join(dir, `seg_${i}_${k}.mp3`);
        await fsp.writeFile(f, await eleven.synthesize(actor.userId, it.directed, it.voice, it.st, { previous: it.prev, following: it.next }));
        files.push(f);
      }
      let out = files[0];
      if (files.length > 1) { out = path.join(dir, `voz_${i}.mp3`); await concatAudio(files, out); }
      s.audio = await storeBuffer(await fsp.readFile(out), "mp3", "audio/mpeg");
      s.audio_text = slideFp;
      s.audio_voice = [...new Set(items.map((it) => it.voice))].join(",");
      s.audio_sec = (await probeDurationSeconds(out)) || 0;
      await comic.saveEpisode(actor.userId, ep); // salva a cada slide (já gastou crédito); mantém os mesmos objetos de `plan`
    }
    return ep;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ====================================================================================================================
// Áudio enviado
// ====================================================================================================================
export async function saveUploadedAudio(actor: Actor, seriesId: string, episodeId: string, file: { buffer: Buffer; originalname: string }): Promise<comic.Episode> {
  const ep = await comic.getEpisode(seriesId, episodeId, actor.userId);
  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  if (!AUDIO_EXTS.includes(ext)) throw new Error("Formato não suportado. Use MP3, WAV, M4A, AAC, OGG ou FLAC.");
  if (file.buffer.length > MAX_AUDIO_BYTES) throw new Error("Áudio grande demais (máx. 120 MB).");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hq-upload-"));
  try {
    const f = path.join(dir, `a.${ext}`);
    await fsp.writeFile(f, file.buffer);
    if (!(await probeDurationSeconds(f))) throw new Error("Não consegui ler esse áudio. Tente exportá-lo como MP3 ou WAV.");
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  ep.audio_file = await storeBuffer(file.buffer, ext, ext === "mp3" ? "audio/mpeg" : `audio/${ext}`);
  ep.audio_name = file.originalname.slice(0, 120);
  ep.narration_mode = "upload";
  return comic.saveEpisode(actor.userId, ep);
}

export async function removeUploadedAudio(actor: Actor, seriesId: string, episodeId: string): Promise<comic.Episode> {
  const ep = await comic.getEpisode(seriesId, episodeId, actor.userId);
  ep.audio_file = "";
  ep.audio_name = "";
  return comic.saveEpisode(actor.userId, ep);
}

// ====================================================================================================================
// Vídeo
// ====================================================================================================================
/** Duração de cada slide, em segundos, e o áudio único (modo upload) ou null (modo ElevenLabs). */
async function planDurations(ep: comic.Episode, dir: string): Promise<{ durs: number[]; fullAudio: string | null }> {
  if (ep.narration_mode === "upload") {
    if (!ep.audio_file) throw new VideoError("Anexe o áudio da narração antes de gerar o vídeo.", 400);
    const audio = await download(ep.audio_file, path.join(dir, `full.${(ep.audio_file.split("?")[0].split(".").pop() || "mp3").toLowerCase()}`));
    const total = await probeDurationSeconds(audio);
    if (!total) throw new VideoError("Não consegui medir a duração do áudio enviado.", 400);
    const weights = ep.slides.map((s) => Math.max(s.voice_text.trim().length, 40));
    const sum = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    const bounds = weights.map((w) => { acc += (total * w) / sum; return Math.round(acc * FPS) / FPS; }); // fronteiras em quadros: o vídeo termina junto com o áudio
    return { durs: bounds.map((b, i) => b - (i ? bounds[i - 1] : 0)), fullAudio: audio };
  }
  const durs = ep.slides.map((s) => {
    if (!s.voice_text.trim()) return MIN_SLIDE_SEC;
    if (!s.audio) throw new VideoError(`O slide ${s.n} ainda não tem a voz gerada.`, 400);
    return Math.max(MIN_SLIDE_SEC, s.audio_sec + TAIL_SEC);
  });
  return { durs, fullAudio: null };
}

async function captionPngs(ep: comic.Episode, dir: string, size: [number, number]): Promise<Map<number, string>> {
  const [w, h] = size;
  const bottom = h > 1500 ? 210 : 70;
  const css = `*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent}body{width:${w}px;height:${h}px;position:relative;font-family:'Segoe UI',Arial,sans-serif}` +
    `.c{position:absolute;left:60px;right:60px;bottom:${bottom}px;text-align:center;color:#fff;font-weight:800;font-size:46px;line-height:1.28;background:rgba(5,9,18,.72);border-radius:22px;padding:22px 30px;text-shadow:0 2px 6px #000}`;
  const out = new Map<number, string>();
  for (const s of ep.slides) {
    const text = s.voice_text.trim();
    if (!text) continue;
    const f = path.join(dir, `cap_${String(s.n).padStart(2, "0")}.png`);
    await fsp.writeFile(f, await htmlToPng(`<!doctype html><html><head><meta charset='utf-8'><style>${css}</style></head><body><div class='c'>${esc(text)}</div></body></html>`, { width: w, height: h }, { transparent: true }));
    out.set(s.n, f);
  }
  return out;
}

/** Filtro que entrega [v0]: a arte 4:5 com zoom lento (no 9:16, centralizada sobre ela mesma desfocada). */
function baseChain(w: number, h: number, frames: number, zoomIn: boolean): string {
  const z = zoomIn ? `1+0.10*on/${frames}` : `1.10-0.10*on/${frames}`;
  const fgH = h > 1500 ? 1350 : h;
  const kb = `scale=2160:2700:force_original_aspect_ratio=increase,crop=2160:2700,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${fgH}:fps=${FPS}`;
  if (h > 1500) {
    return `[0:v]split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:6,eq=brightness=-0.15[bg];[b]${kb}[fg];[bg][fg]overlay=0:(H-h)/2[v0]`;
  }
  return `[0:v]${kb}[v0]`;
}

/** Três camadas transparentes da abertura (universo, nome da série, episódio + título), reveladas em sequência. */
async function introLayers(series: comic.Series, ep: comic.Episode, dir: string, size: [number, number]): Promise<string[]> {
  const [w, h] = size;
  const pal = series.palette;
  const title = ep.title || `Episódio ${ep.number}`;
  const big = series.name.length <= 14 ? 150 : series.name.length <= 26 ? 118 : 92;
  const css = `
@font-face{font-family:'Coming Soon';src:url('${COMING_SOON_DATA_URI}');}
*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent}
body{width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;font-family:'Coming Soon',cursive;text-align:center;padding:0 70px;color:#fff}
.uni{font-size:36px;letter-spacing:8px;text-transform:uppercase;color:${pal.accent};text-shadow:0 3px 12px #000}
.name{font-size:${big}px;font-weight:700;line-height:1.02;text-transform:uppercase;text-shadow:5px 5px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,0 0 30px ${pal.accent}}
.ep{display:inline-block;font-size:46px;letter-spacing:4px;padding:10px 34px;border:4px solid ${pal.accent};border-radius:14px;background:rgba(5,9,18,.78);color:${pal.accent}}
.ttl{font-size:64px;line-height:1.12;margin-top:6px;text-shadow:4px 4px 0 #000,0 0 20px #000}`;
  const body = `<div class='uni L1'>${esc(series.universe || "")}</div><div class='name L2'>${esc(series.name)}</div>` +
    `<div class='L3'><div class='ep'>EPISÓDIO ${String(ep.number).padStart(2, "0")}</div><div class='ttl'>${esc(title)}</div></div>`;
  const out: string[] = [];
  for (const k of [1, 2, 3]) {
    const hide = [1, 2, 3].filter((j) => j !== k).map((j) => `.L${j}{visibility:hidden}`).join("");
    const f = path.join(dir, `intro_${k}.png`);
    await fsp.writeFile(f, await htmlToPng(`<!doctype html><html><head><meta charset='utf-8'><style>${css}${hide}</style></head><body>${body}</body></html>`, { width: w, height: h }, { transparent: true }));
    out.push(f);
  }
  return out;
}

/** O narrador anuncia a série e o episódio, como na abertura de um desenho animado. */
async function introAnnouncement(actor: Actor, series: comic.Series, ep: comic.Episode, dir: string): Promise<string> {
  const settings = await eleven.getSettings(actor.userId);
  const narr = narratorVoice(series, ep, settings.voice_id);
  const st = eleven.styleFor("GANCHO", ep.narration_style);
  const text = speak(`${`${series.name}. Episódio ${ep.number}. ${ep.title}`.trim().replace(/\.$/, "")}.`);
  const f = path.join(dir, "intro_voice.mp3");
  await fsp.writeFile(f, await eleven.synthesize(actor.userId, eleven.directText(text, st, settings.model), narr, st));
  return f;
}

async function buildIntro(
  dir: string, artFile: string, layers: string[], size: [number, number], withAudio: boolean, announce: string | null,
): Promise<{ file: string; sec: number }> {
  const [w, h] = size;
  let dur = INTRO_MIN_SEC;
  if (announce) dur = Math.max(dur, ((await probeDurationSeconds(announce)) || 0) + INTRO_VOICE_DELAY + 1.0);
  const frames = Math.max(1, Math.round(dur * FPS));
  const args = ["-loop", "1", "-framerate", String(FPS), "-i", artFile, ...layers.flatMap((l) => ["-loop", "1", "-framerate", String(FPS), "-i", l])];
  let chain = `${baseChain(w, h, frames, true)};[v0]eq=brightness=-0.22:saturation=1.1[b]`;
  [0.5, 1.2, 1.9].forEach((t, i) => { chain += `;[${i + 1}:v]format=rgba,fade=t=in:st=${t}:d=0.5:alpha=1[l${i + 1}]`; });
  chain += ";[b][l1]overlay=0:0[o1];[o1][l2]overlay=0:0[o2];[o2][l3]overlay=0:0[o3];[o3]fade=t=in:st=0:d=0.5[v]";
  let aArgs: string[] = [];
  if (withAudio) {
    if (announce) {
      args.push("-i", announce);
      aArgs = ["-map", "4:a", "-af", `aresample=44100,adelay=${Math.round(INTRO_VOICE_DELAY * 1000)}:all=1,apad=whole_dur=${(frames / FPS).toFixed(3)}`];
    } else {
      args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
      aArgs = ["-map", "4:a"];
    }
    aArgs.push("-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "160k");
  }
  const file = path.join(dir, "clip_00.mp4");
  await ffmpeg([...args, "-filter_complex", chain, "-map", "[v]", ...aArgs, "-frames:v", String(frames), "-t", (frames / FPS).toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), file], "montar a abertura");
  return { file, sec: frames / FPS };
}

export async function buildVideo(actor: Actor, series: comic.Series, ep: comic.Episode, progress?: ProgressFn): Promise<comic.Episode> {
  if (!ep.slides.length) throw new VideoError("Gere o roteiro primeiro.", 400);
  const missing = ep.slides.filter((s) => !s.art).map((s) => s.n);
  if (missing.length) throw new VideoError(`Faltam as imagens dos slides ${missing.join(", ")}. Gere as imagens primeiro.`, 400);
  try {
    await runFfmpeg(["-version"]);
  } catch (e) {
    throw new VideoError((e as Error).message, 400);
  }

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hq-video-"));
  try {
    let announce: string | null = null;
    if (ep.narration_mode !== "upload") {
      Object.assign(ep, await generateNarration(actor, series, ep, progress));
      if (ep.intro) {
        report(progress, "Gravando a apresentação do episódio", 51);
        announce = await introAnnouncement(actor, series, ep, dir);
      }
    }
    const { durs, fullAudio } = await planDurations(ep, dir);
    const size = SIZES[ep.video_format] || SIZES.reels;
    const [w, h] = size;

    report(progress, "Baixando as imagens", 52);
    const arts = new Map<number, string>();
    for (const s of ep.slides) arts.set(s.n, await download(s.art!, path.join(dir, `art_${s.n}.${(s.art!.split("?")[0].split(".").pop() || "png").toLowerCase()}`)));

    let caps = new Map<number, string>();
    if (ep.captions) { report(progress, "Preparando as legendas", 53); caps = await captionPngs(ep, dir, size); }

    const clips: string[] = [];
    let introSec = 0;
    if (ep.intro) {
      report(progress, "Montando a abertura do episódio", 54);
      const intro = await buildIntro(dir, arts.get(ep.slides[0].n)!, await introLayers(series, ep, dir, size), size, fullAudio === null, announce);
      clips.push(intro.file);
      introSec = intro.sec;
    }

    const total = ep.slides.length;
    for (let i = 0; i < total; i++) {
      const s = ep.slides[i];
      report(progress, `Montando o slide ${s.n} de ${total} no vídeo`, 55 + Math.floor((38 * i) / total));
      const frames = Math.max(1, Math.round(durs[i] * FPS));
      let chain = baseChain(w, h, frames, i % 2 === 0); // alterna aproximação e afastamento para dar ritmo
      const args = ["-loop", "1", "-framerate", String(FPS), "-i", arts.get(s.n)!];
      let nIn = 1;
      const cap = caps.get(s.n);
      if (cap) { args.push("-i", cap); chain += `;[v0][${nIn}:v]overlay=0:0[v]`; nIn++; } else chain += ";[v0]null[v]";
      let aIdx: number | null = null;
      if (fullAudio === null) { // modo ElevenLabs: o áudio do slide vai dentro do clipe (slide mudo recebe silêncio)
        if (s.audio && s.voice_text.trim()) args.push("-i", await download(s.audio, path.join(dir, `voz_${s.n}.mp3`)));
        else args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
        aIdx = nIn;
      }
      const out = path.join(dir, `clip_${String(s.n).padStart(2, "0")}.mp4`);
      const aArgs = aIdx !== null
        ? ["-map", `${aIdx}:a`, "-af", `aresample=44100,apad=whole_dur=${(frames / FPS).toFixed(3)}`, "-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "160k"] : [];
      await ffmpeg([...args, "-filter_complex", chain, "-map", "[v]", ...aArgs, "-frames:v", String(frames), "-t", (frames / FPS).toFixed(3),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), out], `montar o slide ${s.n}`);
      clips.push(out);
    }

    report(progress, "Juntando tudo no vídeo final", 95);
    const list = path.join(dir, "list.txt");
    await fsp.writeFile(list, clips.map((c) => `file '${c.replace(/\\/g, "/")}'\n`).join(""));
    const final = path.join(dir, "final.mp4");
    if (fullAudio === null) await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final], "juntar os slides");
    else {
      const joined = path.join(dir, "joined.mp4");
      await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined], "juntar os slides");
      await ffmpeg(["-i", joined, "-i", fullAudio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        ...(introSec ? ["-af", `adelay=${Math.round(introSec * 1000)}:all=1`] : []), "-shortest", "-movflags", "+faststart", final], "juntar o áudio ao vídeo");
    }
    ep.video = await storeBuffer(await fsp.readFile(final), "mp4", "video/mp4");
    return comic.saveEpisode(actor.userId, ep);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

void ffmpegBinary;
