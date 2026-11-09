/**
 * Modelo de carrossel "Imagem e Texto": foto em tela cheia + uma caixa de texto sólida (headline + subheadline).
 *
 * O layout entra no app como um modelo embutido (IT01) dentro da lista de modelos de cada brand book. Assim ele usa
 * o mesmo motor dos modelos da marca (campos editáveis, geração de imagem, regenerar slide) sem um caminho paralelo.
 * O estilo (cor da caixa, tamanhos, username, pontinhos...) é configurável, global ou por marca.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { storeBuffer } from "../../controllers/upload.controller";
import {
  AIGenerationError, CONTEXT_LIMIT_CHARS, chat, cleanText, parseOrNull, report, resolveCfg, shorten, type AiCfg, type ChatMsg, type ProgressFn,
} from "./aiClient";
import { MAX_SLIDES, buildUserPrompt, type Actor } from "./ai.service";
import { condenseContext } from "./ai.service";
import * as mediaGen from "./mediaGen.service";
import * as people from "./people.service";
import * as prompts from "./prompt.service";
import { getBrandbook } from "./brandbook.service";
import { renderSlideHtml } from "./template.service";
import { newSlide, type Brandbook, type CarouselProjectData, type GenerateRequest, type SlideData, type SlideTemplateDef } from "./types";

export const CODE = "IT01";
export const ARCHETYPE = "imagem_texto";

// ----------------------------------------------------------------------------------------------------------------
// Estilo configurável
// ----------------------------------------------------------------------------------------------------------------
export interface ImageTextStyle {
  box_color: string; // vazio = cor de destaque da marca
  headline_color: string;
  subheadline_color: string;
  box_width: number; // % do slide
  box_radius: number;
  box_position: "bottom" | "center" | "top";
  font: string;
  headline_size: number;
  headline_weight: number;
  subheadline_size: number;
  overlay: number; // escurecimento da foto (parte de baixo)
  brightness: number;
  show_username: boolean;
  username: string; // vazio = @ da marca
  username_size: number;
  show_dots: boolean;
  headline_max: number;
  subheadline_max: number;
}

export const DEFAULT_STYLE: ImageTextStyle = {
  box_color: "", headline_color: "#FFFFFF", subheadline_color: "rgba(255,255,255,0.85)", box_width: 80, box_radius: 6,
  box_position: "bottom", font: "Inter", headline_size: 56, headline_weight: 800, subheadline_size: 28, overlay: 0.22,
  brightness: 0.88, show_username: true, username: "", username_size: 42, show_dots: true, headline_max: 80, subheadline_max: 130,
};

const RANGES: Partial<Record<keyof ImageTextStyle, [number, number]>> = {
  box_width: [50, 100], box_radius: [0, 60], headline_size: [24, 120], headline_weight: [400, 900], subheadline_size: [16, 60],
  overlay: [0, 0.9], brightness: [0.3, 1.3], username_size: [18, 80], headline_max: [20, 200], subheadline_max: [20, 300],
};

interface StyleStore { global?: Partial<ImageTextStyle>; brandbooks?: Record<string, Partial<ImageTextStyle>> }

async function loadStore(userId: number): Promise<StyleStore> {
  const row = await prisma.carouselSetting.findFirst({ where: { user_id: userId, key: "image_text_style" } });
  if (!row) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}

export async function getStyle(userId: number, brandbookId?: string | null): Promise<ImageTextStyle> {
  const data = await loadStore(userId);
  return { ...DEFAULT_STYLE, ...(data.global || {}), ...((brandbookId && data.brandbooks?.[brandbookId]) || {}) };
}

export async function styleOverview(userId: number) {
  const data = await loadStore(userId);
  return { defaults: DEFAULT_STYLE, global: data.global || {}, brandbooks: data.brandbooks || {} };
}

/** Valida e mantém só os campos conhecidos (levanta erro se algum valor for inválido). */
export function sanitizeStyle(input: Record<string, any>): Partial<ImageTextStyle> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!(k in DEFAULT_STYLE)) continue;
    const def = (DEFAULT_STYLE as any)[k];
    if (typeof def === "number") {
      const n = Number(v);
      const r = RANGES[k as keyof ImageTextStyle];
      if (!Number.isFinite(n) || (r && (n < r[0] || n > r[1]))) throw new Error(`Valor inválido para '${k}'.`);
      out[k] = n;
    } else if (typeof def === "boolean") out[k] = !!v;
    else {
      if (typeof v !== "string") throw new Error(`Valor inválido para '${k}'.`);
      if (k === "box_position" && !["bottom", "center", "top"].includes(v)) throw new Error("Posição da caixa inválida.");
      out[k] = v.slice(0, 200);
    }
  }
  return out as Partial<ImageTextStyle>;
}

/** scope: 'global' ou id da marca. style null = remove as personalizações do escopo. */
export async function saveStyle(userId: number, scope: string, style: Record<string, any> | null): Promise<void> {
  const data = await loadStore(userId);
  const clean = style ? sanitizeStyle(style) : null;
  if (scope === "global") data.global = clean || {};
  else {
    data.brandbooks = data.brandbooks || {};
    if (clean && Object.keys(clean).length) data.brandbooks[scope] = clean;
    else delete data.brandbooks[scope];
  }
  const value = JSON.stringify(data);
  const existing = await prisma.carouselSetting.findFirst({ where: { user_id: userId, key: "image_text_style" } });
  if (existing) await prisma.carouselSetting.update({ where: { id: existing.id }, data: { value } });
  else await prisma.carouselSetting.create({ data: { user_id: userId, key: "image_text_style", value } });
}

// ----------------------------------------------------------------------------------------------------------------
// Modelo embutido (HTML 1080x1350)
// ----------------------------------------------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildHtml(style: ImageTextStyle, bb: Brandbook): string {
  const widthPx = Math.round((1080 * style.box_width) / 100);
  const justify = ({ center: "center", top: "flex-start" } as Record<string, string>)[style.box_position] || "flex-end";
  const topAlpha = Math.round(style.overlay * 0.27 * 1000) / 1000;
  const font = esc(style.font.trim() || "Inter");
  const box = esc(style.box_color.trim() || bb.colors.primary_800 || bb.colors.primary_600);
  const fam = style.font.trim().replace(/ /g, "+");
  const fontLink = fam ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fam}:wght@400;500;600;700;800;900&display=swap">` : "";
  const username = style.show_username
    ? `<div data-slot="handle" style="width:100%;text-align:center;color:#fff;font-size:${style.username_size}px;font-weight:700;letter-spacing:-1px">@marca</div>` : "";
  const dots = style.show_dots
    ? '<div data-slot="dots" data-dot-off="rgba(255,255,255,0.4)" data-dot-on="#fff" style="position:absolute;bottom:35px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:3"></div>' : "";
  return `<div data-tpl-root="1" style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#000;box-sizing:border-box;font-family:'${font}',sans-serif">
${fontLink}
<div data-image-slot="image" data-anim-skip="1" data-placeholder="Escolha ou gere a imagem de fundo" style="position:absolute;inset:0;width:100%;height:100%;background:#111;filter:brightness(${style.brightness})"></div>
<div data-anim-skip="1" style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,${style.overlay}),rgba(0,0,0,${topAlpha}))"></div>
<div style="position:relative;z-index:2;width:100%;height:100%;padding:90px;display:flex;flex-direction:column;justify-content:${justify};box-sizing:border-box">
<div style="background:${box};width:${widthPx}px;max-width:100%;padding:40px 42px;margin-bottom:${style.box_position === "bottom" ? 80 : 0}px;border-radius:${style.box_radius}px;box-sizing:border-box">
<div data-fit="1" data-slot="headline" style="color:${esc(style.headline_color)};font-size:${style.headline_size}px;line-height:1.1;font-weight:${style.headline_weight};letter-spacing:-2px;margin-bottom:16px;text-wrap:balance">Sua headline aqui</div>
<div data-fit="2" data-slot="subheadline" style="color:${esc(style.subheadline_color)};font-size:${style.subheadline_size}px;line-height:1.3;font-weight:500">Sua subheadline aqui</div>
</div>
${username}
</div>
${dots}
</div>`;
}

export function buildTemplate(bb: Brandbook, style: ImageTextStyle): SlideTemplateDef {
  return {
    code: CODE, name: "Imagem e Texto", archetype: ARCHETYPE,
    description: "Foto em tela cheia com uma caixa de texto sólida (headline + subheadline). Modelo embutido do app.",
    default_bg: null, html: buildHtml(style, bb), needs_image: true, builtin: true, groups: [],
    slots: [
      { id: "headline", role: "title", label: "Headline", kind: "content", rich: false, multiline: true, sample: "Sua headline aqui", max_chars: style.headline_max, font_size: style.headline_size },
      { id: "subheadline", role: "body", label: "Subheadline", kind: "content", rich: false, multiline: true, sample: "Sua subheadline aqui", max_chars: style.subheadline_max, font_size: style.subheadline_size },
      { id: "image", role: "image", label: "Imagem de fundo", kind: "content", rich: false, multiline: false, sample: "", max_chars: null },
    ],
  };
}

/** Acrescenta o modelo Imagem e Texto à lista de modelos (em memória; nunca é salvo no brand book). */
export function inject(bb: Brandbook, style: ImageTextStyle): Brandbook {
  return { ...bb, slide_templates: [...(bb.slide_templates || []).filter((t) => !t.builtin), buildTemplate(bb, style)] };
}

/** Marca com o modelo embutido já aplicado, usando o estilo do usuário. */
export async function getBrandbookFor(id: string, userId: number): Promise<Brandbook> {
  const bb = await getBrandbook(id);
  return inject(bb, await getStyle(userId, bb.id));
}

const PREVIEW_IMAGE = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><defs><radialGradient id="g" cx="55%" cy="30%" r="75%"><stop offset="0" stop-color="#8a6a4a"/><stop offset=".55" stop-color="#3a2a20"/><stop offset="1" stop-color="#0d0a08"/></radialGradient></defs><rect width="1080" height="1350" fill="url(#g)"/></svg>',
).toString("base64")}`;

/** Pré-visualização do modelo com um estilo ainda não salvo (tela de configuração). */
export function previewHtml(bb: Brandbook, style: ImageTextStyle, headline: string, subheadline: string, imageUrl?: string | null): string {
  const tpl = buildTemplate(bb, style);
  const slide = newSlide({ id: "preview", index: 2, template_type: ARCHETYPE, template_code: CODE, fields: { headline, subheadline, image: imageUrl || PREVIEW_IMAGE } });
  return renderSlideHtml(slide, { ...bb, slide_templates: [tpl] }, { total: 8, isSingle: false });
}

// ----------------------------------------------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------------------------------------------
function formatBlock(perSlideImages: boolean): string {
  const img = perSlideImages ? ', "image_prompt": "cena desta foto"' : "";
  return `FORMATO DE RESPOSTA: apenas JSON válido, sem texto antes ou depois:
{
  "title": "Título curto do carrossel",
  "image_prompt": "A cena da foto em 1 ou 2 frases em português: onde a pessoa está, o que faz e a emoção. Sem texto na imagem.",
  "slides": [
    {"headline": "texto"${img}, "subheadline": "texto"}
  ]
}
Respeite os limites de caracteres. Não use campos que não estejam no formato.`;
}

export async function buildSystemPrompt(
  userId: number, bb: Brandbook, person: people.Person | null, n: number, isSingle: boolean, archetype: string,
  perSlideImages = false, promptText?: string | null,
): Promise<string> {
  const style = await getStyle(userId, bb.id);
  const rules = bb.writing_rules.map((r) => `- ${r}`).join("\n");
  const structure = isSingle
    ? "Gere exatamente 1 slide de alto impacto: a ideia central do contexto em uma headline forte."
    : `O carrossel tem EXATAMENTE ${n} slides, nem mais nem menos.\n- Slide 1: gancho emocional que prende em 2 segundos.\n` +
      `- Slides 2 a ${Math.max(n - 1, 1)}: desenvolvimento, uma ideia nova por slide, sem repetir.\n- Slide ${n}: fechamento com chamada para ação clara.`;
  const limits = `Até ${style.headline_max} caracteres (poucas palavras) na headline e até ${style.subheadline_max} na subheadline.`;
  return prompts.renderPrompt(userId, "image_text", bb.id, {
    marca: bb.name, handle: bb.handle, regras: rules, estrutura: structure, arquetipo: archetype, limites: limits,
    pessoa: people.describeFull(person), formato_resposta: formatBlock(perSlideImages),
  }, promptText);
}

export async function buildPersonPrompt(userId: number, person: people.Person, scene: string, brandbookId?: string | null, promptText?: string | null): Promise<string> {
  const refs = person.photos.length
    ? "Use as imagens de referência: mantenha exatamente o rosto, o cabelo, a barba, os óculos e os traços da pessoa das fotos. Ela precisa ser reconhecível." : "";
  return prompts.renderPrompt(userId, "image_scene", brandbookId ?? null, {
    pessoa: people.describeLook(person), referencias: refs,
    cena: scene.trim() || "retrato natural da pessoa, em um ambiente que combine com o assunto do carrossel",
    evitar: person.avoid.trim() ? `Evitar: ${person.avoid.trim()}.` : "",
  }, promptText);
}

/** Foto da pessoa gerada com as fotos de referência dela. Devolve a URL já armazenada. */
export async function generatePersonImage(actor: Actor, person: people.Person, scene: string, brandbookId?: string | null, provider?: mediaGen.ImageProvider | null): Promise<string> {
  const refs = await people.referenceFiles(person);
  const prompt = await buildPersonPrompt(actor.userId, person, scene, brandbookId);
  const png = await mediaGen.generateImage(actor, prompt, { references: refs, provider });
  return storeBuffer(png, "png", "image/png");
}

// ----------------------------------------------------------------------------------------------------------------
// Geração do carrossel
// ----------------------------------------------------------------------------------------------------------------
function assemble(
  data: Record<string, any>, req: GenerateRequest, bb: Brandbook, n: number, warnings: string[], style: ImageTextStyle,
): { project: CarouselProjectData; scenes: string[] } {
  let raw: any[] = Array.isArray(data.slides) ? data.slides : [];
  if (raw.length > n) { warnings.push(`A IA devolveu mais slides do que o pedido; mantive os ${n} primeiros.`); raw = raw.slice(0, n); }
  else if (raw.length < n) warnings.push(`A IA devolveu ${raw.length} slides em vez de ${n}. Use 'Novo' no estúdio para adicionar slides.`);
  const slides: SlideData[] = [];
  const scenes: string[] = [];
  raw.forEach((sRaw, k) => {
    const i = k + 1;
    const s = sRaw && typeof sRaw === "object" ? sRaw : {};
    const src = s.fields && typeof s.fields === "object" ? s.fields : s;
    const head = cleanText(src.headline ?? src.title, false);
    const sub = cleanText(src.subheadline ?? src.body, false);
    if (head.length > style.headline_max * 1.7) warnings.push(`Slide ${i}: a headline ficou longa; o tamanho da fonte será reduzido automaticamente.`);
    const fields: Record<string, string> = {};
    if (head) fields.headline = head;
    if (sub) fields.subheadline = sub;
    scenes.push(cleanText(s.image_prompt, false));
    slides.push(newSlide({
      id: `slide_${String(i).padStart(2, "0")}`, index: i, template_type: ARCHETYPE, template_code: CODE, fields,
      title: head || "Slide", body: sub || null, show_pagination: !req.is_single_slide,
    }));
  });
  const title = cleanText(data.title, false) || shorten(req.topic || slides[0]?.title || "Carrossel", 80);
  return {
    project: {
      id: `proj_${randomUUID().replace(/-/g, "").slice(0, 8)}`, title, brandbook_id: bb.id, archetype: req.archetype, theme: "brand",
      is_single_slide: !!req.is_single_slide, slides, warnings, carousel_model: "image_text", person_id: req.person_id ?? null,
    },
    scenes,
  };
}

function composeOffline(req: GenerateRequest, bb: Brandbook, source: string, n: number, warnings: string[], style: ImageTextStyle) {
  let sentences = source.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 12);
  if (!sentences.length) sentences = [source.trim()];
  const per = Math.max(1, Math.floor(sentences.length / Math.max(n, 1)));
  const slides = Array.from({ length: n }, (_, k) => {
    const chunk = sentences.slice(k * per, (k + 1) * per);
    const c = chunk.length ? chunk : [sentences[sentences.length - 1]];
    const head = c[0].length > style.headline_max ? c[0].slice(0, style.headline_max).replace(/\s+\S*$/, "") : c[0];
    return { headline: head, subheadline: c.slice(1).join(" ").slice(0, style.subheadline_max) };
  });
  return assemble({ title: req.topic, slides }, req, bb, n, warnings, style);
}

export async function generate(req: GenerateRequest, bb: Brandbook, actor: Actor, progress?: ProgressFn): Promise<CarouselProjectData> {
  report(progress, "Lendo o contexto", 4);
  const original = (req.context || req.topic || "").trim();
  if (!original) throw new AIGenerationError("Informe o contexto ou o tema do carrossel.", 400);
  const n = req.is_single_slide ? 1 : Math.max(1, Math.min(Math.floor(req.slide_count || 7), MAX_SLIDES));
  const style = await getStyle(actor.userId, bb.id);
  const person = await people.getPerson(req.person_id, actor.userId);
  const perSlide = req.background === "ai" && req.image_mode === "per_slide";
  const cfg = await resolveCfg(actor.userId, actor.companyId, req.provider, req.model);
  const warnings: string[] = [];
  let source = original;
  let result: { project: CarouselProjectData; scenes: string[] };

  if (!cfg) {
    warnings.push("Nenhuma chave de IA configurada. O carrossel foi montado sem IA, dividindo o seu texto em slides. Configure uma chave em Configurações > Integrações.");
    result = composeOffline(req, bb, source, n, warnings, style);
    result.scenes = result.scenes.map(() => "");
  } else {
    const limit = CONTEXT_LIMIT_CHARS[cfg.provider] || 12000;
    let condensed = false;
    if (source.length > limit) { source = await condenseContext(cfg, source, limit, warnings, progress); condensed = true; }
    const effort = source.length < 2500 ? "low" : "medium";
    const system = await buildSystemPrompt(actor.userId, bb, person, n, !!req.is_single_slide, req.archetype, perSlide);
    let user = buildUserPrompt(req, source, n, !!req.is_single_slide, condensed);
    if (req.scene?.trim()) user += `\n\nCENA DESEJADA PARA A FOTO: ${req.scene.trim()}`;
    const messages: ChatMsg[] = [{ role: "user", content: user }];
    const maxTokens = Math.min(9000, 450 * n + 1800);

    report(progress, `Escrevendo ${n === 1 ? "o slide" : `os ${n} slides`} com a IA`, 55);
    let { text: raw } = await chat(cfg, system, messages, maxTokens, { effort });
    let data = parseOrNull(raw);
    if (!data) {
      messages.push({ role: "assistant", content: raw.slice(0, 6000) }, { role: "user", content: "A resposta não era um JSON válido (ou foi cortada). Responda de novo apenas com o JSON completo." });
      report(progress, "Refazendo o JSON que veio incompleto", 80);
      ({ text: raw } = await chat(cfg, system, messages, Math.min(12000, Math.floor(maxTokens * 1.5)), { effort }));
      data = parseOrNull(raw);
      if (!data) throw new AIGenerationError("A IA não devolveu um JSON válido. Tente novamente ou use outro modelo.", 502);
    }
    const got: any[] = Array.isArray(data.slides) ? data.slides : [];
    if (got.length !== n) {
      messages.push({ role: "assistant", content: raw.slice(0, 8000) }, { role: "user", content: `Você retornou ${got.length} slides, mas são necessários EXATAMENTE ${n}. Reescreva o JSON completo.` });
      report(progress, `Ajustando para exatamente ${n} slides`, 88);
      const { text: raw2 } = await chat(cfg, system, messages, maxTokens, { effort });
      const d2 = parseOrNull(raw2);
      if (d2 && Array.isArray(d2.slides) && Math.abs(d2.slides.length - n) <= Math.abs(got.length - n)) data = d2;
    }
    report(progress, "Montando os slides", 92);
    result = assemble(data, req, bb, n, warnings, style);
    const projectScene = cleanText(data.image_prompt, false);
    if (!perSlide) result.scenes = result.project.slides.map(() => projectScene);
  }

  const project = result.project;
  project.source_context = original.slice(0, 30000);
  project.topic = req.topic || null;
  project.target_audience = req.target_audience ?? null;
  project.additional_instructions = req.additional_instructions ?? null;
  project.project_id = req.project_id ?? null;

  if (req.background === "ai") await generateBackgrounds(project, req, bb, person, result.scenes, perSlide, actor, progress);
  else if (req.background === "file" && req.image_url) {
    for (const s of project.slides) { s.fields.image = req.image_url; s.image_url = req.image_url; }
    project.images = [{ url: req.image_url, kind: "upload", type: "image" }];
  }
  return project;
}

/** Gera a foto de fundo com a pessoa (uma para todos ou uma por slide). Falha vira aviso, não derruba o carrossel. */
async function generateBackgrounds(
  project: CarouselProjectData, req: GenerateRequest, bb: Brandbook, person: people.Person | null, scenes: string[], perSlide: boolean,
  actor: Actor, progress?: ProgressFn,
): Promise<void> {
  if (!person) {
    project.warnings.push("Para gerar imagens com IA escolha uma pessoa (mapa da pessoa). O carrossel ficou sem imagem de fundo.");
    return;
  }
  const available = await mediaGen.availableImageProviders(actor.userId, actor.companyId);
  if (!available.length) {
    project.warnings.push("Nenhuma chave de geração de imagem configurada (OpenRouter ou OpenAI em Configurações > Integrações): o carrossel ficou sem imagem de fundo. Gere ou escolha a imagem no editor depois.");
    return;
  }
  const count = perSlide ? project.slides.length : 1;
  const urls: string[] = [];
  for (let k = 0; k < count; k++) {
    report(progress, `Gerando a foto ${k + 1} de ${count} com ${person.name}`, 93 + Math.floor((5 * k) / Math.max(count, 1)));
    const scene = req.scene?.trim() || scenes[k] || "";
    try {
      urls.push(await generatePersonImage(actor, person, scene, bb.id));
    } catch (e) {
      project.warnings.push(`Não consegui gerar a foto ${k + 1}: ${(e as Error).message}`);
      urls.push("");
    }
  }
  project.slides.forEach((slide, i) => {
    const url = perSlide && i < urls.length ? urls[i] : urls[0] || "";
    if (url) { slide.fields.image = url; slide.image_url = url; }
  });
  project.images = [...(project.images || []), ...urls.filter(Boolean).map((url) => ({ url, kind: "ai" as const, type: "image" as const }))];
}

export function sceneForSlide(slide: SlideData): string {
  return [slide.fields?.headline, slide.fields?.subheadline].filter(Boolean).join(". ");
}
