/**
 * Mini-novela HQ: séries com personagens (character sheets), episódios de até 15 slides em graphic novel.
 *
 * Fluxo de um episódio:
 *   1. roteiro   — a IA de texto escreve o episódio (narrador + falas) seguindo comic_script.md;
 *   2. prompts   — a IA de texto vira diretora de arte (comic_art.md) e devolve um prompt de imagem por slide, já com o
 *                  layout do texto (onde fica a caixa do narrador e os balões);
 *   3. imagens   — o Nano Banana desenha cada slide SEM texto, usando os character sheets como referência;
 *   4. montagem  — o app sobrepõe caixas de narração, balões e a capa (fonte Coming Soon) e exporta PNG 1080x1350.
 */
import { randomBytes, randomUUID } from "crypto";
import JSZip from "jszip";
import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../access.service";
import { fetchStoredFileBytes } from "../../lib/fileStorage";
import { getAdapter } from "../../lib/ai-providers/registry";
import { resolveApiKey } from "../ai-credential.service";
import { storeBuffer } from "../../controllers/upload.controller";
import { AIGenerationError, chat, parseJsonResponse, report, requireCfg, type ProgressFn } from "./aiClient";
import * as mediaGen from "./mediaGen.service";
import { htmlToPng } from "./render.service";
import { NO_TEXT, NO_TEXT_NEG, DEFAULT_STYLE, artDirectorSystem, getStyle } from "./comicStyles";
import prompts from "./comicPrompts.json";
import { COMING_SOON_DATA_URI } from "./comicFont";
import type { Actor } from "./ai.service";

export const MAX_SHEETS = 4;
export const MAX_SLIDES = 15;
const PROMPT_BATCH = 5;
export const MAX_SEASON_EPISODES = 12;
const STORY_LIMIT = 12000;
const MAX_REFS = 8; // imagens de referência por geração (o Nano Banana aceita bem até ~8-10)
const MAX_REFS_PER_CHAR = 2;

export class ComicError extends AIGenerationError {}

// ====================================================================================================================
// Modelos
// ====================================================================================================================
export interface Character {
  id: string;
  name: string;
  role: string;
  description: string; // aparência desenhada: idade, rosto, cabelo, roupa, traços marcantes
  voice: string; // jeito de falar: ritmo, vocabulário, muletas de linguagem
  sheets: string[]; // character sheets (URLs)
  look: string; // identidade visual fixa lida do character sheet por IA de visão (automático)
  voice_id: string; // voz do ElevenLabs deste personagem no vídeo narrado (vazio = voz do narrador)
}

export interface Palette { base: string; secondary: string; accent: string }

export interface Series {
  id: string;
  project_id: number | null;
  name: string;
  universe: string; // exibido pequeno acima do título na capa
  premise: string;
  style_notes: string;
  art_style: string;
  palette: Palette;
  characters: Character[];
  narrator_voice_id: string;
  story: string; // história real ou contexto base da temporada
  analysis: string; // análise do tema (gerada por IA)
  created: string;
}

export interface Dialogue { character: string; text: string; x: "left" | "center" | "right" }

export interface ComicSlide {
  n: number;
  title: string;
  element: string;
  visual_tone: string;
  narrator: string;
  dialogues: Dialogue[];
  action: string;
  characters_present: string[];
  image_prompt: string;
  narrator_pos: "top" | "bottom";
  voice_text: string;
  voice_auto: string;
  audio: string | null;
  audio_text: string;
  audio_voice: string;
  audio_sec: number;
  art: string | null;
  final: string | null;
}

export interface Episode {
  id: string;
  series_id: string;
  number: number;
  title: string;
  theme: string;
  context: string;
  slide_count: number;
  internal_title: string;
  synopsis: string;
  profiles: string;
  viral: string;
  caption: string;
  publish_date: string;
  narration_mode: "eleven" | "upload";
  voice_id: string;
  narration_style: "historiador" | "suspense" | "neutro";
  audio_file: string;
  audio_name: string;
  video_format: "reels" | "feed";
  captions: boolean;
  intro: boolean;
  video: string | null;
  slides: ComicSlide[];
  created: string;
}

const s_ = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

export function blankSlide(n: number): ComicSlide {
  return {
    n, title: "", element: "", visual_tone: "", narrator: "", dialogues: [], action: "", characters_present: [], image_prompt: "",
    narrator_pos: "top", voice_text: "", voice_auto: "", audio: null, audio_text: "", audio_voice: "", audio_sec: 0, art: null, final: null,
  };
}

function normalizeSlide(raw: any, n: number): ComicSlide {
  const b = blankSlide(n);
  return {
    ...b, ...raw, n,
    dialogues: Array.isArray(raw?.dialogues) ? raw.dialogues.map((d: any) => ({ character: String(d.character || ""), text: String(d.text || ""), x: ["left", "center", "right"].includes(d.x) ? d.x : "left" })) : [],
    characters_present: Array.isArray(raw?.characters_present) ? raw.characters_present.map(String) : [],
    narrator_pos: raw?.narrator_pos === "bottom" ? "bottom" : "top",
    audio_sec: Number(raw?.audio_sec) || 0,
  };
}

export function normalizeEpisode(raw: any): Episode {
  return {
    id: raw.id || "", series_id: raw.series_id || "", number: Number(raw.number) || 1, title: raw.title || "", theme: raw.theme || "",
    context: raw.context || "", slide_count: Number(raw.slide_count) || MAX_SLIDES, internal_title: raw.internal_title || "",
    synopsis: raw.synopsis || "", profiles: raw.profiles || "", viral: raw.viral || "", caption: raw.caption || "",
    publish_date: raw.publish_date || "", narration_mode: raw.narration_mode === "upload" ? "upload" : "eleven", voice_id: raw.voice_id || "",
    narration_style: ["suspense", "neutro"].includes(raw.narration_style) ? raw.narration_style : "historiador",
    audio_file: raw.audio_file || "", audio_name: raw.audio_name || "", video_format: raw.video_format === "feed" ? "feed" : "reels",
    captions: raw.captions !== false, intro: raw.intro !== false, video: raw.video || null,
    slides: (Array.isArray(raw.slides) ? raw.slides : []).map((s: any, i: number) => normalizeSlide(s, i + 1)), created: raw.created || "",
  };
}

export function normalizeSeries(raw: any): Series {
  return {
    id: raw.id || "", project_id: raw.project_id ?? null, name: raw.name || "", universe: raw.universe || "", premise: raw.premise || "",
    style_notes: raw.style_notes || "", art_style: raw.art_style || DEFAULT_STYLE,
    palette: { base: "#0B1A2B", secondary: "#2E5E7E", accent: "#E8A33D", ...(raw.palette || {}) },
    characters: (Array.isArray(raw.characters) ? raw.characters : []).map((c: any) => ({
      id: c.id || "", name: c.name || "", role: c.role || "", description: c.description || "", voice: c.voice || "",
      sheets: Array.isArray(c.sheets) ? c.sheets : [], look: c.look || "", voice_id: c.voice_id || "",
    })),
    narrator_voice_id: raw.narrator_voice_id || "", story: raw.story || "", analysis: raw.analysis || "", created: raw.created || "",
  };
}

// ====================================================================================================================
// Armazenamento
// ====================================================================================================================
function accessWhere(userId: number) {
  return {
    OR: [
      { user_id: userId },
      { project: { OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] } },
    ],
  };
}

const seriesPack = (s: Series) => { const { id, project_id, ...rest } = s; void id; void project_id; return JSON.stringify(rest); };
const episodePack = (e: Episode) => { const { id, series_id, ...rest } = e; void id; void series_id; return JSON.stringify(rest); };

export async function listSeries(userId: number): Promise<Series[]> {
  const rows = await prisma.comicSeries.findMany({ where: accessWhere(userId), orderBy: { updated_at: "desc" } });
  return rows.map((r) => normalizeSeries({ ...JSON.parse(r.data), id: r.id, name: r.title, project_id: r.project_id }));
}

export async function getSeries(id: string, userId: number): Promise<Series> {
  const r = await prisma.comicSeries.findFirst({ where: { id, ...accessWhere(userId) } });
  if (!r) throw new NotFoundError("Série não encontrada ou sem permissão de acesso.");
  return normalizeSeries({ ...JSON.parse(r.data), id: r.id, name: r.title, project_id: r.project_id });
}

async function assertProjectAccess(projectId: number, userId: number) {
  const p = await prisma.project.findFirst({ where: { id: projectId, OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] }, select: { id: true } });
  if (!p) throw new NotFoundError("Projeto não encontrado ou sem permissão de acesso.");
}

export async function saveSeries(userId: number, input: Partial<Series>, keepSheets = true): Promise<Series> {
  if (!input.name?.trim()) throw new Error("Dê um nome à série.");
  const series = normalizeSeries(input);
  const existing = series.id ? await getSeries(series.id, userId).catch(() => null) : null;
  if (series.project_id && series.project_id !== existing?.project_id) await assertProjectAccess(series.project_id, userId);
  if (!existing) {
    series.id = newId("serie");
    series.created = new Date().toISOString();
  }
  for (const c of series.characters) {
    if (!c.name.trim()) throw new Error("Todo personagem precisa de um nome.");
    if (!c.id) c.id = newId("pers");
  }
  if (existing && keepSheets) { // as folhas só mudam pelos endpoints de upload; o salvar do formulário preserva as existentes
    const old = new Map<string, Character>(existing.characters.map((c) => [c.id, c] as [string, Character]));
    for (const c of series.characters) {
      const o = old.get(c.id);
      if (o) { c.sheets = o.sheets; c.look = o.look; }
    }
    series.created = existing.created;
  }
  const data = seriesPack(series);
  if (existing) await prisma.comicSeries.update({ where: { id: series.id }, data: { title: series.name, project_id: series.project_id, data } });
  else await prisma.comicSeries.create({ data: { id: series.id, user_id: userId, project_id: series.project_id, title: series.name, data } });
  return series;
}

export async function deleteSeries(id: string, userId: number): Promise<boolean> {
  const r = await prisma.comicSeries.findFirst({ where: { id, user_id: userId } });
  if (!r) return false;
  await prisma.comicSeries.delete({ where: { id } });
  return true;
}

export async function addSheet(seriesId: string, charId: string, userId: number, file: { buffer: Buffer; mimetype: string }): Promise<Series> {
  const series = await getSeries(seriesId, userId);
  const ch = series.characters.find((c) => c.id === charId);
  if (!ch) throw new Error("Personagem não encontrado. Salve a série antes de enviar o character sheet.");
  const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[file.mimetype];
  if (!ext) throw new Error("Formato não suportado. Use PNG, JPG ou WEBP.");
  if (ch.sheets.length >= MAX_SHEETS) throw new Error(`Máximo de ${MAX_SHEETS} imagens por personagem.`);
  if (file.buffer.length > 12 * 1024 * 1024) throw new Error("Imagem grande demais (máx. 12 MB).");
  ch.sheets.push(await storeBuffer(file.buffer, ext, file.mimetype));
  ch.look = ""; // a leitura automática precisa ser refeita com a nova imagem
  return saveSeries(userId, series, false);
}

export async function removeSheet(seriesId: string, charId: string, userId: number, url: string): Promise<Series> {
  const series = await getSeries(seriesId, userId);
  const ch = series.characters.find((c) => c.id === charId);
  if (!ch || !ch.sheets.includes(url)) throw new Error("Imagem não encontrada.");
  ch.sheets = ch.sheets.filter((u) => u !== url);
  ch.look = "";
  return saveSeries(userId, series, false);
}

type EpisodeRow = { id: string; series_id: string; title: string; data: string; created_at: Date };
const toEpisode = (r: EpisodeRow) => normalizeEpisode({ ...JSON.parse(r.data), id: r.id, series_id: r.series_id, title: r.title });

export async function listEpisodes(seriesId: string, userId: number): Promise<Episode[]> {
  await getSeries(seriesId, userId);
  const rows = await prisma.comicEpisode.findMany({ where: { series_id: seriesId } });
  return rows.map(toEpisode).sort((a, b) => a.number - b.number || a.created.localeCompare(b.created));
}

export async function getEpisode(seriesId: string, episodeId: string, userId: number): Promise<Episode> {
  await getSeries(seriesId, userId);
  const r = await prisma.comicEpisode.findFirst({ where: { id: episodeId, series_id: seriesId } });
  if (!r) throw new NotFoundError("Episódio não encontrado.");
  return toEpisode(r);
}

export const defaultVoiceText = (s: ComicSlide) =>
  [s.narrator, ...s.dialogues.map((d) => d.text)].filter((p) => p && p.trim()).map((p) => p.trim()).join(" ");

export async function saveEpisode(userId: number, input: Partial<Episode>): Promise<Episode> {
  if (!input.series_id) throw new Error("Série não encontrada.");
  await getSeries(input.series_id, userId);
  const ep = normalizeEpisode(input);
  for (const s of ep.slides) { // texto não editado acompanha o roteiro; texto editado à mão fica como está
    const auto = defaultVoiceText(s);
    const vt = s.voice_text.trim();
    if (!vt || vt === (s.voice_auto || "").trim() || vt === auto) { s.voice_text = auto; s.voice_auto = auto; }
  }
  const existing = ep.id ? await prisma.comicEpisode.findFirst({ where: { id: ep.id, series_id: ep.series_id } }) : null;
  if (!existing) {
    ep.id = newId("ep");
    ep.created = new Date().toISOString();
    if (ep.number <= 1) ep.number = Math.max(0, ...(await listEpisodes(ep.series_id, userId)).map((e) => e.number)) + 1;
  } else ep.created = ep.created || existing.created_at.toISOString();
  ep.slide_count = Math.max(3, Math.min(Math.floor(ep.slide_count || MAX_SLIDES), MAX_SLIDES));
  const data = episodePack(ep);
  if (existing) await prisma.comicEpisode.update({ where: { id: ep.id }, data: { title: ep.title || `Episódio ${ep.number}`, data } });
  else await prisma.comicEpisode.create({ data: { id: ep.id, series_id: ep.series_id, user_id: userId, title: ep.title || `Episódio ${ep.number}`, data } });
  await prisma.comicSeries.update({ where: { id: ep.series_id }, data: { updated_at: new Date() } }).catch(() => undefined);
  return ep;
}

export async function deleteEpisode(seriesId: string, episodeId: string, userId: number): Promise<boolean> {
  await getSeries(seriesId, userId);
  return (await prisma.comicEpisode.deleteMany({ where: { id: episodeId, series_id: seriesId } })).count > 0;
}

// ─── Aprovação do cliente por link público ────────────────────────────────────────────────────────────────────────────

export async function getEpisodeShare(seriesId: string, episodeId: string, userId: number) {
  await getSeries(seriesId, userId);
  const r = await prisma.comicEpisode.findFirst({ where: { id: episodeId, series_id: seriesId }, select: { share_token: true, approved_at: true, approved_by: true } });
  if (!r) throw new NotFoundError("Episódio não encontrado.");
  return r;
}

/** Liga/desliga o link. Desligar apaga o token (o link antigo para de funcionar) e a aprovação. */
export async function setEpisodeSharing(seriesId: string, episodeId: string, userId: number, enabled: boolean) {
  const current = await getEpisodeShare(seriesId, episodeId, userId);
  const data = enabled
    ? { share_token: current.share_token ?? randomBytes(24).toString("base64url") }
    : { share_token: null, approved_at: null, approved_by: null };
  return prisma.comicEpisode.update({ where: { id: episodeId }, data, select: { share_token: true, approved_at: true, approved_by: true } });
}

/** Só imagens, na ordem: o cliente aprova o que vê, sem roteiro nem prompts. */
export async function getPublicEpisode(token: string) {
  const r = await prisma.comicEpisode.findUnique({ where: { share_token: token }, include: { series: { select: { title: true } } } });
  if (!r) throw new NotFoundError("Link inválido ou desativado.");
  const ep = toEpisode(r);
  return {
    series_name: r.series.title,
    number: ep.number,
    title: ep.title,
    slides: ep.slides.map((s) => ({ n: s.n, image: s.final || s.art || null })).filter((s) => s.image),
    approved_at: r.approved_at,
    approved_by: r.approved_by,
  };
}

export async function setPublicApproval(token: string, approved: boolean) {
  const r = await prisma.comicEpisode.findUnique({ where: { share_token: token }, select: { id: true } });
  if (!r) throw new NotFoundError("Link inválido ou desativado.");
  await prisma.comicEpisode.update({
    where: { id: r.id },
    data: approved ? { approved_at: new Date(), approved_by: "Cliente" } : { approved_at: null, approved_by: null },
  });
  return getPublicEpisode(token);
}

// ====================================================================================================================
// IA (texto)
// ====================================================================================================================
export const SCRIPT_FORMAT = `
## FORMATO DE RESPOSTA (obrigatório)

Responda APENAS com JSON válido, sem texto antes ou depois, neste formato:
{
  "title": "Título do episódio, curto e forte, para a capa",
  "internal_title": "título interno da mini-novela",
  "synopsis": "sinopse em 2 linhas",
  "profiles": "perfil rápido de cada personagem, 1 frase por pessoa",
  "viral": "por que tem potencial viral, 3 linhas",
  "caption": "legenda curta do post, que complementa sem entregar a história",
  "slides": [
    {
      "title": "título interno do slide",
      "element": "GANCHO | APRESENTAÇÃO | ESCALADA | VIRADA | CLÍMAX | CTA",
      "visual_tone": "enquadramento, ambiente e clima da imagem, em 1 frase",
      "narrator": "fala do narrador ou string vazia",
      "dialogues": [{"character": "NOME exato do personagem", "text": "fala"}],
      "action": "ação visual entre colchetes, o que se vê na cena",
      "characters_present": ["nomes dos personagens que APARECEM desenhados no slide"]
    }
  ]
}
Regras: use exatamente o número de slides pedido; textos curtos (cabem em um quadro de HQ: narrador até ~140 caracteres,
cada fala até ~90, no máximo 2 falas por slide); use SOMENTE os nomes dos personagens cadastrados; o slide 1 é a capa
(a frase de gancho do narrador); o último slide fecha o episódio com gancho para o próximo.`;

function seriesBible(series: Series, forArt = false): string {
  const lines = [
    `SÉRIE: ${series.name}`, series.universe ? `UNIVERSO: ${series.universe}` : "",
    series.premise ? `PREMISSA E TOM: ${series.premise}` : "", series.style_notes ? `ESTILO EXTRA: ${series.style_notes}` : "",
  ];
  if (!forArt) { // a história base serve ao roteiro; a direção de arte só precisa da sinopse de cada episódio
    if (series.analysis) lines.push(`ANÁLISE DO TEMA:\n${series.analysis}`);
    if (series.story) lines.push(`HISTÓRIA BASE (fatos e contexto a respeitar):\n${series.story.slice(0, STORY_LIMIT)}`);
  }
  lines.push("PERSONAGENS CADASTRADOS:");
  for (const c of series.characters) {
    if (forArt) {
      let look = c.description || (c.sheets.length
        ? "definida pelo character sheet anexado. NÃO descreva rosto, cabelo, barba, óculos, cor de pele, idade, corpo nem roupa: escreva só o NOME do personagem" : "—");
      if (c.look) look += ` (referência, não repita no prompt: ${c.look})`;
      lines.push(`- ${c.name} (${c.role || "personagem"}). Aparência: ${look}.`);
    } else lines.push(`- ${c.name} (${c.role || "personagem"}). Aparência: ${c.description || "—"}. Fala: ${c.voice || "—"}.`);
  }
  return lines.filter(Boolean).join("\n");
}

export interface LlmOverride { provider?: string | null; model?: string | null }

async function llmJson(actor: Actor, over: LlmOverride, system: string, user: string, maxTokens: number): Promise<any> {
  const cfg = await requireCfg(actor.userId, actor.companyId, over.provider, over.model);
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: user }];
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await chat(cfg, system, messages, maxTokens, { json: true });
    try {
      return parseJsonResponse(text);
    } catch (e) {
      last = e;
      messages.push({ role: "assistant", content: text }, { role: "user", content: "Sua resposta não era JSON válido. Responda de novo, APENAS com o JSON completo." });
    }
  }
  throw new ComicError(`A IA não devolveu um JSON válido: ${(last as Error)?.message}`, 502);
}

const normTokens = (name: string) =>
  new Set(String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) || []);

const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));

/** Acha o personagem cadastrado a que um nome escrito pela IA se refere ("Marta Souza", "dona Marta" -> Marta). */
export function matchCharacter(raw: string, characters: Character[]): Character | null {
  const want = normTokens(raw);
  if (!want.size) return null;
  for (const c of characters) {
    const have = normTokens(c.name);
    if (have.size === want.size && subset(have, want)) return c;
  }
  for (const c of characters) {
    const have = normTokens(c.name);
    if (have.size && (subset(have, want) || subset(want, have))) return c;
  }
  return null;
}

export async function generateScript(actor: Actor, series: Series, ep: Episode, over: LlmOverride, progress?: ProgressFn): Promise<Episode> {
  const n = Math.max(3, Math.min(ep.slide_count || MAX_SLIDES, MAX_SLIDES));
  if (!series.characters.length) throw new ComicError("Cadastre ao menos um personagem na série antes de gerar o roteiro.", 400);
  report(progress, "Escrevendo o roteiro", 10);

  const previous = (await listEpisodes(series.id, actor.userId)).filter((e) => e.number < ep.number && e.synopsis);
  const recap = previous.length
    ? "\n\nEPISÓDIOS ANTERIORES (mantenha a continuidade):\n" + previous.slice(-4).map((e) => `- Ep. ${e.number} «${e.title}»: ${e.synopsis}`).join("\n") : "";
  const system = `${prompts.script}\n\n---\n\n${seriesBible(series)}${recap}\n${SCRIPT_FORMAT}`;
  const user = `Escreva o EPISÓDIO ${ep.number} com exatamente ${n} slides.\nTEMA / PREMISSA DO EPISÓDIO: ${ep.theme || "(livre, seguindo a premissa da série)"}\n` +
    (ep.context.trim() ? `CONTEXTO E ANOTAÇÕES:\n${ep.context}\n` : "");
  const data = await llmJson(actor, over, system, user, 9000);
  report(progress, "Organizando os slides", 85);

  const canon = (raw: string) => matchCharacter(raw, series.characters)?.name ?? raw;
  const slides: ComicSlide[] = [];
  for (const raw of (Array.isArray(data.slides) ? data.slides : []).slice(0, n)) {
    if (!raw || typeof raw !== "object") continue;
    const dialogues: Dialogue[] = [];
    for (const d of (Array.isArray(raw.dialogues) ? raw.dialogues : []).slice(0, 3)) {
      if (d && typeof d === "object" && s_(d.text)) dialogues.push({ character: canon(s_(d.character)), text: s_(d.text), x: "left" });
    }
    const present: string[] = (Array.isArray(raw.characters_present) ? raw.characters_present : []).map(s_).filter(Boolean).map(canon);
    for (const d of dialogues) if (d.character && !present.includes(d.character)) present.push(d.character); // quem fala aparece no quadro
    slides.push({
      ...blankSlide(slides.length + 1), title: s_(raw.title), element: s_(raw.element), visual_tone: s_(raw.visual_tone),
      narrator: s_(raw.narrator), dialogues, action: s_(raw.action), characters_present: present,
    });
  }
  if (slides.length < 3) throw new ComicError("A IA devolveu um roteiro incompleto. Tente gerar de novo.", 502);

  ep.title = s_(data.title) || ep.title || `Episódio ${ep.number}`;
  ep.internal_title = s_(data.internal_title);
  ep.synopsis = s_(data.synopsis);
  ep.profiles = s_(data.profiles);
  ep.viral = s_(data.viral);
  ep.caption = String(data.caption || "").trim();
  ep.slides = slides;
  ep.slide_count = slides.length;
  return saveEpisode(actor.userId, ep);
}

// ---- temporada a partir de uma história ----------------------------------------------------------------------------
const SEASON_SYSTEM = `Você é um editor-chefe de mini-novelas em quadrinhos para redes sociais. Recebe uma HISTÓRIA REAL (ou um contexto) e transforma em uma temporada de episódios em carrossel: primeiro ANALISA o tema, depois DIVIDE a história em episódios, cada um com começo, meio e gancho próprios.

## O que fazer
1. Analise o tema: do que a história realmente trata, o tom certo, o conflito central, a emoção dominante e o que a torna compartilhável.
2. Defina o arco da temporada: o que o leitor sente no episódio 1 e onde chega no último.
3. Distribua a história pelos episódios pedidos, sem pressa e sem enrolação: cada episódio avança a trama, termina em gancho (exceto o último, que fecha com um desfecho) e cabe no número de slides pedido.
4. Se a história for real, preserve os fatos centrais e a ordem dos acontecimentos. Não invente crimes, acusações nem detalhes que desmintam os fatos. Quando o texto não trouxer nomes, use nomes fictícios.

## FORMATO DE RESPOSTA (obrigatório)
Responda APENAS com JSON válido:
{
  "theme": "tema central em 1 frase",
  "tone": "tom e clima em 1 frase",
  "conflict": "conflito central em 1-2 frases",
  "arc": "arco da temporada em 3-4 frases",
  "universe": "nome curto do universo, exibido na capa (ex.: HISTÓRIAS REAIS)",
  "premise": "premissa da série em 2-3 frases: mundo, conflito e tom",
  "characters": [{"name": "primeiro nome", "role": "papel", "description": "aparência desenhada, em 1-2 frases", "voice": "jeito de falar"}],
  "episodes": [{"title": "título curto e forte", "theme": "o que acontece neste episódio, em 2-3 frases", "context": "pontos da história que este episódio precisa cobrir, e como termina (gancho ou desfecho)"}]
}
Regras: devolva exatamente o número de episódios pedido; "characters" só quando a série ainda não tem personagens cadastrados (2 a 6, com primeiro nome); caso contrário devolva [] e use SOMENTE os personagens cadastrados.`;

/** Analisa a história, planeja `nEpisodes` episódios e já escreve o roteiro de cada um (`slidesPerEp` slides). */
export async function generateSeason(
  actor: Actor, series: Series, story: string, nEpisodes: number, slidesPerEp: number, over: LlmOverride, progress?: ProgressFn,
): Promise<Episode[]> {
  story = (story || "").trim();
  if (story.length < 40) throw new ComicError("Conte a história com um pouco mais de detalhe (pelo menos algumas frases).", 400);
  nEpisodes = Math.max(1, Math.min(Math.floor(nEpisodes || 1), MAX_SEASON_EPISODES));
  slidesPerEp = Math.max(3, Math.min(Math.floor(slidesPerEp || MAX_SLIDES), MAX_SLIDES));

  report(progress, "Analisando o tema da história", 4);
  const lines = [`SÉRIE: ${series.name}`, series.premise ? `PREMISSA ATUAL: ${series.premise}` : ""];
  lines.push(series.characters.length
    ? "PERSONAGENS CADASTRADOS (use só eles):\n" + series.characters.map((c) => `- ${c.name} (${c.role || "personagem"}): ${c.description || "—"}`).join("\n")
    : 'A série ainda NÃO tem personagens cadastrados: crie-os em "characters".');
  const user = `${lines.filter(Boolean).join("\n")}\n\nNÚMERO DE EPISÓDIOS: ${nEpisodes}\nSLIDES POR EPISÓDIO: ${slidesPerEp}\n\nHISTÓRIA / CONTEXTO:\n${story.slice(0, STORY_LIMIT)}`;
  const data = await llmJson(actor, over, SEASON_SYSTEM, user, 8000);
  const plan = (Array.isArray(data.episodes) ? data.episodes : []).filter((p: any) => p && typeof p === "object").slice(0, nEpisodes);
  if (!plan.length) throw new ComicError("A IA não devolveu o plano dos episódios. Tente de novo.", 502);

  series.story = story;
  series.analysis = ([["Tema", "theme"], ["Tom", "tone"], ["Conflito central", "conflict"], ["Arco da temporada", "arc"]] as const)
    .filter(([, k]) => s_(data[k])).map(([label, k]) => `${label}: ${s_(data[k])}`).join("\n");
  if (!series.premise.trim() && s_(data.premise)) series.premise = s_(data.premise);
  if (!series.universe.trim() && s_(data.universe)) series.universe = s_(data.universe);
  if (!series.characters.length) {
    for (const c of (Array.isArray(data.characters) ? data.characters : []).slice(0, 6)) {
      if (c && s_(c.name)) series.characters.push({ id: newId("pers"), name: s_(c.name), role: s_(c.role), description: s_(c.description), voice: s_(c.voice), sheets: [], look: "", voice_id: "" });
    }
  }
  if (!series.characters.length) throw new ComicError("A IA não definiu personagens para a história. Tente de novo ou cadastre-os na série.", 502);
  const saved = await saveSeries(actor.userId, series);
  Object.assign(series, saved);

  const done: Episode[] = [];
  const total = plan.length;
  for (let i = 0; i < total; i++) {
    const base = 12 + Math.floor((86 * i) / total);
    const span = Math.floor(86 / total);
    report(progress, `Escrevendo o roteiro do episódio ${i + 1} de ${total}`, base);
    let ep = await saveEpisode(actor.userId, {
      series_id: series.id, number: 0, title: s_(plan[i].title), theme: s_(plan[i].theme), context: s_(plan[i].context), slide_count: slidesPerEp,
    });
    try {
      ep = await generateScript(actor, series, ep, over, (stage, pct) => report(progress, `Episódio ${i + 1} de ${total}: ${stage}`, base + Math.floor((span * Math.min(pct, 100)) / 100)));
    } catch (e) {
      await deleteEpisode(series.id, ep.id, actor.userId); // não deixa um episódio vazio para trás; os anteriores ficam salvos
      throw e;
    }
    done.push(ep);
  }
  return done;
}

// ---- prompts de imagem ---------------------------------------------------------------------------------------------
const ART_OVERRIDE = `
## AJUSTES DESTE APP (têm prioridade sobre o que foi dito acima)

- O TEXTO (caixas do narrador, balões de fala, título da capa) é sobreposto depois pelo app. Portanto a IMAGEM NÃO
  PODE conter nenhum texto, letra, balão, legenda ou onomatopeia. Ignore as instruções de tipografia e de texto no quadrinho.
- Para cada slide escolha "narrator_pos": "top" ou "bottom" (onde fica a caixa do narrador). Os balões de fala ocupam
  a faixa OPOSTA. As duas faixas (cada uma ~22% da altura) precisam ficar livres de rostos e de detalhes importantes:
  descreva-as no prompt como áreas de sombra, céu, parede ou fundo de baixo detalhe. Rostos no terço central.
- Se o slide tem falas, indique em "speakers" o lado do quadro em que cada falante aparece desenhado
  ("left", "center" ou "right"), para a cauda do balão apontar para ele.
- Na capa (slide 1), deixe o topo livre (nome da série e episódio) e a base livre (título). narrator_pos = "bottom".
- PERSONAGENS CADASTRADOS: no "image_prompt" refira-se a eles SÓ PELO NOME (ex.: "Marta, de costas") e descreva apenas
  pose, expressão, ação e posição no quadro. É PROIBIDO descrever rosto, cabelo, barba, óculos, cor de pele, idade, corpo
  ou roupa deles: o app anexa o character sheet e qualquer descrição sua faria a imagem divergir da referência.
  Só descreva a aparência de figurantes e personagens que NÃO estão cadastrados.
- O "image_prompt" é em inglês, termina com as palavras-chave de estilo e NÃO inclui o negative prompt (o app acrescenta).

## FORMATO DE RESPOSTA (obrigatório)
Responda APENAS com JSON válido:
{"slides": [{"n": 1, "image_prompt": "...", "narrator_pos": "top|bottom", "speakers": [{"character": "NOME", "x": "left|center|right"}]}]}
`;

/**
 * Personagens cadastrados depois do roteiro não constam em `characters_present`: inclui os que são citados no texto
 * do quadro (narrador, cena e falas), para o prompt e as referências do desenho refletirem a lista atual da série.
 */
function addMentionedCharacters(series: Series, slide: ComicSlide) {
  const text = normTokens([slide.narrator, slide.action, ...slide.dialogues.flatMap((d) => [d.character, d.text])].join(" "));
  for (const c of series.characters) {
    const have = normTokens(c.name);
    if (!have.size || !subset(have, text) || matchCharacter(c.name, slide.characters_present.map((n) => ({ name: n } as Character)))) continue;
    slide.characters_present.push(c.name);
  }
}

export async function generateArtPrompts(
  actor: Actor, series: Series, ep: Episode, over: LlmOverride, progress?: ProgressFn, onlyMissing = false, only?: number[] | null,
): Promise<Episode> {
  if (!ep.slides.length) throw new ComicError("Gere o roteiro antes dos prompts de imagem.", 400);
  const pal = series.palette;
  const system = `${artDirectorSystem(series.art_style, prompts.art)}\n\n---\n\n${seriesBible(series, true)}\n\nPALETA MESTRA: base ${pal.base}, secundária ${pal.secondary}, acento ${pal.accent}.\n${ART_OVERRIDE}`;
  const todo = ep.slides.filter((x) => !(onlyMissing && x.image_prompt) && (!only?.length || only.includes(x.n))); // só_faltantes preserva prompts já editados
  if (!todo.length) throw new ComicError("Quadro não encontrado neste episódio.", 400);
  for (const s of todo) addMentionedCharacters(series, s);
  const batches: ComicSlide[][] = [];
  for (let i = 0; i < todo.length; i += PROMPT_BATCH) batches.push(todo.slice(i, i + PROMPT_BATCH));
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    report(progress, `Criando prompts de imagem (${batch[0].n}–${batch[batch.length - 1].n})`, 8 + Math.floor((85 * bi) / batches.length));
    const lines = [`EPISÓDIO ${ep.number} «${ep.title}» — contexto geral: ${ep.synopsis}`, "", "Crie o prompt de imagem dos slides abaixo (mesmos números na resposta):"];
    for (const s of batch) {
      lines.push(`\nSLIDE ${s.n} [${s.element}] ${s.title}\nCena: ${s.action}\nClima: ${s.visual_tone}\nPersonagens no quadro: ${s.characters_present.join(", ") || "nenhum"}\nNarrador: ${s.narrator || "—"}\n` +
        s.dialogues.map((d) => `${d.character}: ${d.text}`).join("\n"));
    }
    const data = await llmJson(actor, over, system, lines.join("\n"), 6000);
    const byN = new Map<number, any>();
    for (const x of Array.isArray(data.slides) ? data.slides : []) if (x && /^\d+$/.test(String(x.n))) byN.set(Number(x.n), x);
    for (const s of batch) {
      const item = byN.get(s.n);
      if (!item || !s_(item.image_prompt)) throw new ComicError(`A IA não devolveu o prompt do slide ${s.n}. Tente gerar de novo.`, 502);
      s.image_prompt = s_(item.image_prompt);
      s.narrator_pos = s.n === 1 || String(item.narrator_pos).toLowerCase() === "bottom" ? "bottom" : "top";
      const sides = new Map<string, Dialogue["x"]>();
      for (const sp of Array.isArray(item.speakers) ? item.speakers : []) {
        if (sp && typeof sp === "object") sides.set(s_(sp.character).toLowerCase(), ["left", "center", "right"].includes(sp.x) ? sp.x : "left");
      }
      s.dialogues.forEach((d, k) => { d.x = sides.get(d.character.toLowerCase()) ?? (k % 2 === 0 ? "left" : "right"); });
    }
  }
  return saveEpisode(actor.userId, ep);
}

// ====================================================================================================================
// Imagens (Nano Banana)
// ====================================================================================================================
const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Reduz a referência (lado maior 1280 px, JPEG) para o envio não ficar pesado. */
async function prepRef(url: string, label: string): Promise<mediaGen.ImageRef> {
  const bytes = await fetchStoredFileBytes(url);
  try {
    const sharp = (await import("sharp")).default;
    const data = await sharp(bytes).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    return { label, data, mime: "image/jpeg" };
  } catch {
    const ext = (url.split("?")[0].split(".").pop() || "png").toLowerCase();
    return { label, data: bytes, mime: MIME_BY_EXT[ext] || "image/png" };
  }
}

const VISION_MODEL = "google/gemini-2.5-flash";
const LOOK_PROMPT =
  "This is a character reference sheet. In ONE English paragraph of at most 70 words, describe only the character's FIXED " +
  "physical identity: apparent age and body build, skin tone, hair (style, color, length), facial hair, glasses, face shape, " +
  "accessories (headband, jewelry, etc.) and the exact outfit with colors. No poses, no background, no art-style words.";

/** Lê o character sheet de cada personagem com IA de visão e guarda a identidade fixa em `look`. Falhas são silenciosas. */
export async function describeLooks(actor: Actor, series: Series): Promise<Series> {
  let key: string;
  try { key = await resolveApiKey("openrouter", actor.userId, actor.companyId); } catch { return series; }
  let changed = false;
  for (const c of series.characters) {
    if (c.look || !c.sheets.length) continue;
    try {
      const ref = await prepRef(c.sheets[0], c.name);
      const res = await getAdapter("openrouter").chat({
        apiKey: key, model: VISION_MODEL, maxTokens: 300, temperature: 0.2,
        messages: [{ role: "user", content: [{ type: "text", text: LOOK_PROMPT }, { type: "image", mimeType: ref.mime as "image/jpeg", base64: ref.data.toString("base64") }] }],
      });
      c.look = s_(res.text).slice(0, 600);
      changed = true;
    } catch (e) {
      console.error(`[comic] leitura do sheet de ${c.name} falhou:`, (e as Error).message);
    }
  }
  if (changed) Object.assign(series, await saveSeries(actor.userId, series, false));
  return series;
}

/** Referências de TODOS os personagens da série (os da cena primeiro), para o Nano Banana manter cada rosto igual. */
async function references(series: Series, slide: ComicSlide, perChar = MAX_REFS_PER_CHAR) {
  const present = new Set(slide.characters_present.map((n) => matchCharacter(n, series.characters)?.id).filter(Boolean) as string[]);
  const ordered = [...series.characters].sort((a, b) => Number(!present.has(a.id)) - Number(!present.has(b.id)) || series.characters.indexOf(a) - series.characters.indexOf(b));
  const refs: mediaGen.ImageRef[] = [];
  const notes: string[] = [];
  for (const c of ordered) {
    const label = present.has(c.id) ? "appears in this scene" : !present.size ? "may appear in this scene" : "NOT in this scene: reference only, do not draw unless the scene needs them";
    for (const url of c.sheets.slice(0, perChar)) {
      if (refs.length >= MAX_REFS) break;
      try {
        refs.push(await prepRef(url, `${c.name} — ${label}`));
        const ident = [c.look, c.description].filter(Boolean).join(" ");
        notes.push(`Image ${refs.length} is the character reference of ${c.name} (${label}). Fixed identity: ${ident}`.trim());
      } catch { /* sheet indisponível: segue sem ela */ }
    }
  }
  return { refs, notes };
}

export function buildImagePrompt(series: Series, slide: ComicSlide, notes: string[]): string {
  const pal = series.palette;
  const st = getStyle(series.art_style);
  const parts: string[] = [];
  if (notes.length) {
    parts.push(
      "CHARACTER FIDELITY (highest priority): the attached images are the official character sheets, each labelled with " +
      "the character's name. Every character drawn MUST be the SAME person as in their sheet: same face shape, hair, " +
      "beard, glasses, skin tone, body build and the same outfit and accessories. Keep the outfit exactly as in the " +
      "sheet unless the scene text explicitly changes it. If the scene text below describes a character's face, hair, " +
      "clothes or age differently from the sheet, IGNORE that description and follow the sheet. Redraw them in the " +
      "art style described below, but do not change who they are. The sheets define IDENTITY ONLY: do NOT copy the " +
      "sheets' own drawing style, line quality, shading or rendering. Render everyone in this style instead: " +
      `${st.suffix} Each named character appears EXACTLY ONCE in the frame: never duplicate, clone or mirror a character.\n${notes.join("\n")}`,
    );
  }
  parts.push(slide.image_prompt);
  const zone = slide.narrator_pos === "top" ? "bottom" : "top";
  parts.push(
    `Composition: full-bleed illustration that fills the ENTIRE frame edge to edge, with no panel border, no letterbox bars and no empty bands. ` +
    `Keep roughly the ${slide.narrator_pos} 18% and the ${zone} 18% of the frame uncluttered and free of faces, but still filled by the scene itself ` +
    `(ceiling, floor, wall, sky, deep shadow), never a flat colored bar. Faces in the central part. Vertical 4:5 ${st.frame}.`,
  );
  parts.push(st.palette.replace("{base}", pal.base).replace("{secondary}", pal.secondary).replace("{accent}", pal.accent));
  if (series.style_notes) parts.push(series.style_notes);
  parts.push(`${st.suffix} ${NO_TEXT}`);
  parts.push(`Avoid: ${st.negative}, ${NO_TEXT_NEG}`);
  return parts.join("\n\n");
}

export async function generateSlideArt(actor: Actor, series: Series, slide: ComicSlide, provider?: mediaGen.ImageProvider | null, flowKey?: { project_key: string; title: string }): Promise<void> {
  if (!slide.image_prompt) throw new ComicError(`O slide ${slide.n} ainda não tem prompt de imagem.`, 400);
  const { refs, notes } = await references(series, slide, provider === "flow" ? 1 : MAX_REFS_PER_CHAR);
  const prompt = buildImagePrompt(series, slide, notes);
  let png: Buffer | null = null;
  let last: unknown;
  for (let attempt = 0; attempt < 2 && !png; attempt++) {
    try {
      png = await mediaGen.generateImage(actor, prompt, { references: refs, aspect: "4:5", provider: provider ?? "openrouter", flow: flowKey });
    } catch (e) {
      last = e;
      if (e instanceof AIGenerationError && [400, 401, 402, 429].includes(e.status)) throw e;
    }
  }
  if (!png) throw last;
  slide.art = await storeBuffer(png, "png", "image/png");
}

export async function generateImages(
  actor: Actor, series: Series, ep: Episode, only?: number[] | null, progress?: ProgressFn, provider?: mediaGen.ImageProvider | null,
): Promise<Episode> {
  const targets = ep.slides.filter((s) => !only?.length || only.includes(s.n));
  if (!targets.length) throw new ComicError("Nada para gerar.", 400);
  if (series.characters.some((c) => c.sheets.length && !c.look)) {
    report(progress, "Lendo os character sheets", 3);
    await describeLooks(actor, series);
  }
  const errors: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i];
    report(progress, `Desenhando slide ${s.n} de ${ep.slides.length}`, 10 + Math.floor((82 * i) / targets.length));
    try {
      await generateSlideArt(actor, series, s, provider, { project_key: `${series.id}:${ep.id}`, title: `${series.name} - Ep ${String(ep.number).padStart(2, "0")}` });
    } catch (e) {
      if (e instanceof AIGenerationError && [400, 401, 402, 429].includes(e.status)) { // erro de configuração/limite: vale parar e salvar o que já saiu
        await saveEpisode(actor.userId, ep);
        throw e;
      }
      errors.push(`slide ${s.n}: ${(e as Error).message}`);
    }
    // salva a cada slide (uma falha não perde o que já foi desenhado). Não troca os objetos de `ep`: `targets` aponta para eles
    await saveEpisode(actor.userId, ep);
  }
  if (errors.length) throw new ComicError(`Alguns slides falharam e podem ser regerados um a um — ${errors.join("; ")}`, 502);
  return ep;
}

// ====================================================================================================================
// Montagem (texto sobre a arte)
// ====================================================================================================================
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fontSize = (text: string, big: number, mid: number, small: number) => (text.length <= 60 ? big : text.length <= 110 ? mid : small);

export function overlayHtml(series: Series, ep: Episode, slide: ComicSlide, artUri: string): string {
  const pal = series.palette;
  const css = `
@font-face{font-family:'Coming Soon';src:url('${COMING_SOON_DATA_URI}');}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;height:1350px;position:relative;overflow:hidden;background:${pal.base};font-family:'Coming Soon',cursive}
.art{position:absolute;inset:0;width:1080px;height:1350px;object-fit:cover}
.zone{position:absolute;left:44px;right:44px;display:flex;flex-direction:column;gap:30px}
.zone.top{top:44px} .zone.bottom{bottom:44px;justify-content:flex-end}
.narr{background:rgba(7,12,24,.92);border:3px solid ${pal.accent};border-radius:12px;padding:24px 30px;color:#fff;line-height:1.3}
.bubble{position:relative;max-width:760px;background:#f4f1e8;color:#111;border:5px solid #111;border-radius:46px / 40px;padding:24px 34px;line-height:1.25;text-align:center}
.bubble.left{align-self:flex-start;margin-left:20px} .bubble.right{align-self:flex-end;margin-right:20px} .bubble.center{align-self:center}
.bubble::after{content:'';position:absolute;width:38px;height:38px;background:#f4f1e8;transform:rotate(45deg)}
.zone.top .bubble::after{bottom:-22px;border-right:5px solid #111;border-bottom:5px solid #111}
.zone.bottom .bubble::after{top:-22px;border-left:5px solid #111;border-top:5px solid #111}
.bubble.left::after{left:22%} .bubble.right::after{right:22%} .bubble.center::after{left:calc(50% - 19px)}
.who{display:block;font-size:20px;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:6px}
.cover-top{position:absolute;top:70px;left:0;right:0;text-align:center;color:${pal.accent};text-shadow:0 3px 10px #000}
.cover-top .uni{font-size:30px;letter-spacing:6px;text-transform:uppercase} .cover-top .epn{font-size:44px;margin-top:10px;color:#fff}
.cover-bottom{position:absolute;left:50px;right:50px;bottom:90px;text-align:center;color:#fff;font-weight:700;line-height:1.05;
 text-shadow:5px 5px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,0 0 28px ${pal.accent}}
.shade-top{position:absolute;left:0;right:0;top:0;height:380px;background:linear-gradient(#000c,#0000)}
.shade-bottom{position:absolute;left:0;right:0;bottom:0;height:520px;background:linear-gradient(#0000,#000d)}
`;
  const body: string[] = [artUri ? `<img class="art" src="${artUri}">` : ""];
  if (slide.n === 1) {
    const title = ep.title || series.name;
    const size = title.length <= 14 ? 150 : title.length <= 24 ? 120 : 92;
    body.push('<div class="shade-top"></div><div class="shade-bottom"></div>');
    body.push(`<div class="cover-top"><div class="uni">${esc(series.universe || series.name)}</div><div class="epn">EPISÓDIO ${String(ep.number).padStart(2, "0")}</div></div>`);
    const lift = slide.narrator ? 170 : 90; // com a frase de gancho embaixo, o título sobe para não colidir
    body.push(`<div class="cover-bottom" style="font-size:${size}px; bottom:${lift}px">${esc(title.toUpperCase())}</div>`);
    if (slide.narrator) body.push(`<div class="zone bottom" style="bottom:20px"><div class="narr" style="font-size:28px;padding:12px 24px">${esc(slide.narrator)}</div></div>`);
  } else {
    const pos = slide.narrator_pos === "bottom" ? "bottom" : "top";
    const other = pos === "bottom" ? "top" : "bottom";
    if (slide.narrator) body.push(`<div class="zone ${pos}"><div class="narr" style="font-size:${fontSize(slide.narrator, 44, 38, 32)}px">${esc(slide.narrator)}</div></div>`);
    if (slide.dialogues.length) {
      const items = slide.dialogues.map((d) => {
        const x = ["left", "center", "right"].includes(d.x) ? d.x : "left";
        return `<div class="bubble ${x}" style="font-size:${fontSize(d.text, 44, 38, 33)}px"><span class="who">${esc(d.character)}</span>${esc(d.text)}</div>`;
      });
      body.push(`<div class="zone ${other}">${items.join("")}</div>`);
    }
  }
  return `<!doctype html><html><head><meta charset='utf-8'><style>${css}</style></head><body>${body.join("")}</body></html>`;
}

async function toDataUri(url: string): Promise<string> {
  const bytes = await fetchStoredFileBytes(url);
  const ext = (url.split("?")[0].split(".").pop() || "png").toLowerCase();
  return `data:${MIME_BY_EXT[ext] || "image/png"};base64,${bytes.toString("base64")}`;
}

export async function composeSlides(actor: Actor, series: Series, ep: Episode, only?: number[] | null, progress?: ProgressFn): Promise<Episode> {
  const targets = ep.slides.filter((s) => !only?.length || only.includes(s.n));
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i];
    report(progress, `Montando slide ${s.n}`, 5 + Math.floor((90 * i) / Math.max(1, targets.length)));
    const artUri = s.art ? await toDataUri(s.art).catch(() => "") : "";
    const png = await htmlToPng(overlayHtml(series, ep, s, artUri));
    s.final = await storeBuffer(png, "png", "image/png");
  }
  return saveEpisode(actor.userId, ep);
}

// ====================================================================================================================
// Exportação
// ====================================================================================================================
function scriptMarkdown(ep: Episode): string {
  const out = [`# Episódio ${String(ep.number).padStart(2, "0")} — ${ep.title}`, "", `**Sinopse:** ${ep.synopsis}`, "", `**Personagens:** ${ep.profiles}`, ""];
  for (const s of ep.slides) {
    out.push(`## Slide ${s.n} — ${s.title} [${s.element}]`);
    if (s.narrator) out.push(`🎙️ NARRADOR: ${s.narrator}`);
    out.push(...s.dialogues.map((d) => `🎭 ${d.character}: ${d.text}`));
    if (s.action) out.push(`[${s.action}]`);
    out.push("");
  }
  return out.join("\n");
}

async function writeEpisodeZip(zip: JSZip, ep: Episode, prefix = ""): Promise<number> {
  let count = 0;
  for (const s of ep.slides) {
    if (!s.final) continue;
    try {
      zip.file(`${prefix}slides/slide_${String(s.n).padStart(2, "0")}.png`, await fetchStoredFileBytes(s.final));
      count++;
    } catch { /* arquivo sumiu: o slide fica de fora */ }
  }
  zip.file(`${prefix}legenda.txt`, (ep.caption || "") + (ep.publish_date ? `\n\nPublicar em: ${ep.publish_date}` : ""));
  zip.file(`${prefix}roteiro.md`, scriptMarkdown(ep));
  zip.file(`${prefix}prompts_imagem.md`, ep.slides.map((s) => `## Slide ${s.n}\n${s.image_prompt}`).join("\n\n"));
  return count;
}

export async function exportEpisodeZip(ep: Episode): Promise<Buffer> {
  const zip = new JSZip();
  if ((await writeEpisodeZip(zip, ep)) === 0) throw new ComicError("Este episódio ainda não tem slides montados. Gere as imagens e monte os slides primeiro.", 400);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function exportSeriesZip(actor: Actor, series: Series): Promise<Buffer> {
  const zip = new JSZip();
  let total = 0;
  for (const ep of await listEpisodes(series.id, actor.userId)) total += await writeEpisodeZip(zip, ep, `episodio_${String(ep.number).padStart(2, "0")}/`);
  if (total === 0) throw new ComicError("Nenhum episódio tem slides montados ainda.", 400);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
