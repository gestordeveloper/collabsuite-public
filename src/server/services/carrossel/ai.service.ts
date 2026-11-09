/**
 * Geração de carrosséis por IA.
 *
 * Fluxo para marcas importadas de um brand book (modelos nativos):
 *   1. o contexto (transcrição, artigo, notas) é a fonte da verdade; se for grande demais para o modelo, é
 *      condensado em pontos-chave na ordem original;
 *   2. o prompt lista SOMENTE os modelos do brand book, com os campos exatos de cada um (nome, exemplo e limite de
 *      caracteres), e exige exatamente N slides;
 *   3. a resposta é validada e reparada: contagem, capa no primeiro slide, CTA no último, campos válidos, sem HTML,
 *      sem travessão;
 *   4. o tema (marca / escuro / claro / alternado) é aplicado pelo renderizador, sobre o desenho original da marca.
 */
import { randomUUID } from "crypto";
import {
  AIGenerationError, CONTEXT_LIMIT_CHARS, chat, cleanText, limitHighlights, parseOrNull, report, requireCfg,
  resolveCfg, shorten, splitParagraphs, type AiCfg, type ChatMsg, type ProgressFn,
} from "./aiClient";
import * as prompts from "./prompt.service";
import {
  newSlide, type Brandbook, type CarouselProjectData, type GenerateRequest, type SlideData, type SlideTemplateDef,
} from "./types";

export const MAX_SLIDES = 20;
const IMAGE_INTENT_RE = /\b(print|prints|imagem|imagens|foto|fotos|screenshot|captura|mockup)\b/i;

export const NATIVE_FORMAT = `FORMATO DE RESPOSTA: apenas JSON válido, sem texto antes ou depois:
{
  "title": "Título curto do carrossel",
  "slides": [
    {"template": "T01", "fields": {"campo": "texto", "outro_campo": "texto"}},
    {"template": "T05", "fields": {"title": "texto", "items": [{"number": "01", "title": "texto", "description": "texto"}]}}
  ]
}
Preencha todos os campos de conteúdo do modelo escolhido, respeitando os limites de caracteres. Não use campos que não estejam listados no modelo.`;

export interface Actor {
  userId: number;
  companyId: number | null;
}

// ----------------------------------------------------------------------------------------------------------------
// Catálogo de modelos da marca
// ----------------------------------------------------------------------------------------------------------------

/** Modelos reais da marca que a IA pode escolher (sem os que exigem imagem, salvo se o pedido as mencionar). */
export function nativeCatalog(bb: Brandbook, wantsImages = false): SlideTemplateDef[] {
  const out: SlideTemplateDef[] = [];
  for (const t of bb.slide_templates || []) {
    if (!t.html || t.builtin) continue; // modelos embutidos (Imagem e Texto) têm fluxo próprio
    if (t.needs_image && !wantsImages) continue;
    const hasText = t.slots.some((s) => s.kind === "content" && s.role !== "image") || t.groups.length > 0;
    if (hasText) out.push(t);
  }
  return out;
}

export function describeTemplate(t: SlideTemplateDef): string {
  const bg = ({ dark: "escuro", light: "claro", primary: "cor da marca" } as Record<string, string>)[t.default_bg || ""] || "";
  const lines = [`[${t.code}] ${t.name} | função: ${t.archetype} | fundo nativo: ${bg}`];
  if (t.description) lines.push(`  Uso: ${shorten(t.description, 140)}`);
  lines.push('  Campos (use EXATAMENTE estes nomes em "fields"):');
  for (const s of t.slots) {
    if (s.kind !== "content" || s.role === "image" || s.role === "initials") continue;
    const extra = s.role === "title" ? " Destaque UMA palavra com **palavra**." : "";
    const limit = s.max_chars ? ` até ${s.max_chars} caracteres.` : "";
    lines.push(`    ${s.id}: ${s.label}.${extra}${limit} Ex.: "${shorten(s.sample)}"`);
  }
  for (const g of t.groups) {
    const itemNames = g.item_slots.map((sl) => sl.id).join(", ");
    const ex = g.sample_items.length ? JSON.stringify(g.sample_items.slice(0, 1)).slice(0, 160) : "";
    lines.push(`    ${g.id}: lista de ${g.min_items} a ${g.max_items} itens, cada item com {${itemNames}}. (${g.label}) Ex.: ${ex}`);
  }
  return lines.join("\n");
}

export async function buildSystemPrompt(
  userId: number, bb: Brandbook, catalog: SlideTemplateDef[], slideCount: number, isSingle: boolean, archetype: string,
  promptText?: string | null,
): Promise<string> {
  const rules = bb.writing_rules.map((r) => `- ${r}`).join("\n");
  const catalogText = catalog.map(describeTemplate).join("\n\n");
  const covers = catalog.filter((t) => t.archetype.startsWith("capa")).map((t) => t.code);
  const ctas = catalog.filter((t) => t.archetype === "cta").map((t) => t.code);

  const structure = isSingle
    ? "Gere exatamente 1 slide de alto impacto. Escolha o modelo que melhor entrega a ideia central do contexto (afirmação, dado real, capa)."
    : `O carrossel tem EXATAMENTE ${slideCount} slides, nem mais nem menos.\n` +
      `- Slide 1: capa com gancho forte (modelos de capa: ${covers.join(", ") || "os de função capa"}).\n` +
      `- Slides 2 a ${slideCount - 1}: desenvolvimento do conteúdo, variando os modelos ` +
      "(nunca o mesmo modelo em slides seguidos; repita um modelo só se o catálogo for curto).\n" +
      `- Slide ${slideCount}: fechamento com chamada para ação (modelos de CTA: ${ctas.join(", ") || "o de função cta"}).`;

  return prompts.renderPrompt(userId, "native", bb.id, {
    marca: bb.name, handle: bb.handle, regras: rules, estrutura: structure, arquetipo: archetype,
    modelos: catalogText, formato_resposta: NATIVE_FORMAT,
  }, promptText);
}

export function buildUserPrompt(req: GenerateRequest, source: string, slideCount: number, isSingle: boolean, condensed: boolean): string {
  const n = isSingle ? 1 : slideCount;
  const parts: string[] = [];
  parts.push(condensed ? "CONTEXTO-BASE (pontos-chave extraídos, na ordem original):" : "CONTEXTO-BASE:");
  parts.push(`<<<\n${source}\n>>>`);
  if (req.topic && req.topic.trim() && req.topic.trim() !== source.trim()) parts.push(`ASSUNTO / ÂNGULO: ${req.topic.trim()}`);
  parts.push(`PÚBLICO-ALVO: ${req.target_audience || "Empreendedores e profissionais"}`);
  if (req.additional_instructions) parts.push(`INSTRUÇÕES EXTRAS: ${req.additional_instructions.trim()}`);
  parts.push(`QUANTIDADE DE SLIDES: exatamente ${n}.`);
  parts.push("Responda apenas com o JSON.");
  return parts.join("\n\n");
}

// ----------------------------------------------------------------------------------------------------------------
// Contexto grande: condensação em pontos-chave
// ----------------------------------------------------------------------------------------------------------------

export async function condenseContext(cfg: AiCfg, source: string, limit: number, warnings: string[], progress?: ProgressFn): Promise<string> {
  const chunks = splitParagraphs(source, Math.floor(limit * 0.85));
  const perChunk = Math.max(500, Math.floor((limit * 0.85) / Math.max(chunks.length, 1)));
  const points: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    report(progress, `Condensando o conteúdo (trecho ${i + 1} de ${chunks.length})`, 8 + Math.floor((45 * i) / Math.max(chunks.length, 1)));
    const prompt =
      `Trecho ${i + 1} de ${chunks.length} de um conteúdo maior (transcrição/artigo). ` +
      "Extraia os pontos-chave deste trecho, fiéis ao texto, mantendo dados, números, nomes e exemplos concretos. " +
      `No máximo ${perChunk} caracteres no total, em tópicos curtos, na ordem em que aparecem. ` +
      `Responda em JSON: {"pontos": ["...", "..."]}\n\nTRECHO:\n${chunks[i]}`;
    const { text } = await chat(cfg, "Você resume textos com fidelidade e responde apenas em JSON.", [{ role: "user", content: prompt }], 3500, { effort: "low" });
    const data = parseOrNull(text);
    const pts = (data?.pontos || data?.points) as unknown[] | undefined;
    if (Array.isArray(pts)) points.push(...pts.map((p) => String(p).trim()).filter(Boolean));
    else points.push(shorten(chunks[i], perChunk));
  }
  let out = points.map((p) => `- ${p}`).join("\n");
  if (out.length > limit) out = out.slice(0, limit).split("\n").slice(0, -1).join("\n");
  warnings.push(`O conteúdo-base era grande (${source.length.toLocaleString("pt-BR")} caracteres) e foi condensado em pontos-chave antes da geração.`);
  return out;
}

// ----------------------------------------------------------------------------------------------------------------
// Montagem e validação
// ----------------------------------------------------------------------------------------------------------------

/** Tema do slide pedido pelo usuário. null = usar o desenho nativo do modelo (marca). */
export function resolveTheme(reqTheme: string, index: number, nativeBg: string | null | undefined): "dark" | "light" | null {
  if (nativeBg === "primary") return null; // capas/CTAs na cor da marca não trocam de tema
  if (reqTheme === "dark") return "dark";
  if (reqTheme === "light") return "light";
  if (reqTheme === "alternating") return index % 2 === 1 ? "dark" : "light";
  return null;
}

export function findTemplate(ref: unknown, catalog: SlideTemplateDef[]): SlideTemplateDef | null {
  const key = String(ref ?? "").trim().toLowerCase();
  if (!key) return null;
  for (const t of catalog) if (t.code.toLowerCase() === key || t.name.toLowerCase() === key) return t;
  const m = /t?\s*(\d{1,2})/.exec(key);
  if (m) {
    const code = `t${String(parseInt(m[1], 10)).padStart(2, "0")}`;
    for (const t of catalog) if (t.code.toLowerCase() === code) return t;
  }
  for (const t of catalog) if (t.archetype.toLowerCase() === key) return t;
  return null;
}

const contentSlots = (t: SlideTemplateDef) => t.slots.filter((s) => s.kind === "content" && s.role !== "image" && s.role !== "initials");

/** Leva o conteúdo de um modelo para outro (mesmo id, senão mesmo papel). */
export function remapFields(fields: Record<string, any>, old: SlideTemplateDef | null, next: SlideTemplateDef): Record<string, any> {
  const out: Record<string, any> = {};
  const oldByRole: Record<string, any> = {};
  if (old) {
    for (const s of contentSlots(old)) if (s.id in fields && !(s.role in oldByRole)) oldByRole[s.role] = fields[s.id];
  }
  for (const s of contentSlots(next)) {
    if (s.id in fields) out[s.id] = fields[s.id];
    else if (s.role in oldByRole) out[s.id] = oldByRole[s.role];
  }
  for (const g of next.groups) if (g.id in fields) out[g.id] = fields[g.id];
  return out;
}

export function sanitizeFields(raw: any, t: SlideTemplateDef, slideNo: number, warnings: string[]): Record<string, any> {
  const fields: Record<string, any> = {};
  raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const s of contentSlots(t)) {
    if (!(s.id in raw)) continue;
    let v = raw[s.id];
    if (v && typeof v === "object") v = (Array.isArray(v) ? v : Object.values(v)).map(String).join(" ");
    let text = cleanText(v, s.rich);
    if (s.role === "title") text = limitHighlights(text, 1);
    if (!text) continue;
    if (s.max_chars && text.length > s.max_chars * 1.7) {
      warnings.push(`Slide ${slideNo}: o campo '${s.label}' ficou longo demais para o desenho do modelo ${t.code}; o tamanho da fonte será reduzido automaticamente.`);
    }
    fields[s.id] = text;
  }
  for (const g of t.groups) {
    let itemsRaw = raw[g.id];
    if ((itemsRaw === undefined || itemsRaw === null) && t.groups.length === 1) itemsRaw = raw.items ?? raw.list ?? raw.lista;
    if (!Array.isArray(itemsRaw)) continue;
    const items: Record<string, string>[] = [];
    for (let it of itemsRaw.slice(0, g.max_items)) {
      const row: Record<string, string> = {};
      if (typeof it === "string") it = g.item_slots.length ? { [g.item_slots[0].id]: it } : {};
      if (!it || typeof it !== "object") continue;
      for (const sl of g.item_slots) {
        let val = it[sl.id];
        if ((val === undefined || val === null) && sl.role === "description") val = it.desc ?? it.text ?? it.body;
        if ((val === undefined || val === null) && sl.role === "title") val = it.titulo ?? it.name;
        if (val !== undefined && val !== null) row[sl.id] = cleanText(val, sl.rich);
      }
      if (Object.values(row).some(Boolean)) items.push(row);
    }
    if (items.length) {
      if (items.length < g.min_items && g.min_items > 1) {
        warnings.push(`Slide ${slideNo}: '${g.label}' do modelo ${t.code} ficou com ${items.length} item(ns); o desenho prevê ao menos ${g.min_items}.`);
      }
      fields[g.id] = items;
    }
  }
  // título ausente: aproveita o texto principal para o slide nunca ficar sem chamada
  const titleSlot = contentSlots(t).find((s) => s.role === "title");
  if (titleSlot && !(titleSlot.id in fields)) {
    const alt = contentSlots(t).find((s) => (s.role === "body" || s.role === "text") && s.id in fields);
    if (alt) fields[titleSlot.id] = fields[alt.id];
  }
  return fields;
}

function pickByRole(catalog: SlideTemplateDef[], wantCover: boolean, exclude?: string): SlideTemplateDef | null {
  for (const t of catalog) {
    const isCover = t.archetype.startsWith("capa");
    if (wantCover && isCover && t.code !== exclude) return t;
    if (!wantCover && t.archetype === "cta" && t.code !== exclude) return t;
  }
  return null;
}

export function slideTitle(fields: Record<string, any>, tpl: SlideTemplateDef): string {
  return String(fields.title || fields.body || fields.text_1 || tpl.name).replace(/\*\*/g, "");
}

function assemble(
  data: Record<string, any>, slidesRaw: any[], req: GenerateRequest, bb: Brandbook, catalog: SlideTemplateDef[], n: number, warnings: string[],
): CarouselProjectData {
  if (slidesRaw.length > n) {
    slidesRaw = n >= 3 ? [slidesRaw[0], ...slidesRaw.slice(1, slidesRaw.length - 1).slice(0, n - 2), slidesRaw[slidesRaw.length - 1]] : slidesRaw.slice(0, n);
    warnings.push(`A IA devolveu mais slides do que o pedido; mantive os ${n} primeiros (capa e fechamento preservados).`);
  } else if (slidesRaw.length < n) {
    warnings.push(`A IA devolveu ${slidesRaw.length} slides em vez de ${n}. Use 'Novo' no estúdio para adicionar slides ou gere novamente.`);
  }

  const total = slidesRaw.length;
  const reqTheme = (req.theme || "brand").toLowerCase();
  const slides: SlideData[] = [];

  slidesRaw.forEach((sRaw, k) => {
    const i = k + 1;
    const s = sRaw && typeof sRaw === "object" ? sRaw : {};
    let tpl = findTemplate(s.template ?? s.template_type, catalog);
    let fieldsRaw: any = s.fields && typeof s.fields === "object" && !Array.isArray(s.fields)
      ? s.fields
      : Object.fromEntries(Object.entries(s).filter(([key]) => !["template", "template_type", "theme"].includes(key)));

    // papel do slide na sequência (capa no começo, CTA no fim)
    if (!req.is_single_slide && total >= 2) {
      if (i === 1 && (!tpl || !tpl.archetype.startsWith("capa"))) {
        const next = pickByRole(catalog, true);
        if (next) { if (tpl) fieldsRaw = remapFields(fieldsRaw, tpl, next); tpl = next; }
      }
      if (i === total && total >= 3 && (!tpl || tpl.archetype !== "cta")) {
        const next = pickByRole(catalog, false);
        if (next) { if (tpl) fieldsRaw = remapFields(fieldsRaw, tpl, next); tpl = next; }
      }
    }
    if (!tpl) {
      tpl = catalog.find((t) => !t.archetype.startsWith("capa") && t.archetype !== "cta") || catalog[0];
      warnings.push(`Slide ${i}: a IA indicou um modelo inexistente; usei ${tpl.code} (${tpl.name}).`);
    }

    const fields = sanitizeFields(fieldsRaw, tpl, i, warnings);
    slides.push(newSlide({
      id: `slide_${String(i).padStart(2, "0")}`, index: i, template_type: tpl.archetype, template_code: tpl.code,
      theme: resolveTheme(reqTheme, i, tpl.default_bg), fields, title: slideTitle(fields, tpl),
      body: fields.body, category: fields.chip, show_pagination: !req.is_single_slide,
    }));
  });

  const title = cleanText(data.title, false) || shorten(req.topic || slides[0]?.title || "Carrossel", 80);
  return {
    id: `proj_${randomUUID().replace(/-/g, "").slice(0, 8)}`, title, brandbook_id: bb.id, archetype: req.archetype,
    theme: req.theme || "brand", is_single_slide: !!req.is_single_slide, slides, warnings,
    carousel_model: "brandbook",
  };
}

// ----------------------------------------------------------------------------------------------------------------
// Sem chave de IA: divide o texto do usuário entre os modelos da marca (sem inventar conteúdo)
// ----------------------------------------------------------------------------------------------------------------

function composeOffline(
  req: GenerateRequest, bb: Brandbook, catalog: SlideTemplateDef[], source: string, n: number, warnings: string[],
): CarouselProjectData {
  let sentences = source.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 12);
  if (!sentences.length) sentences = [source.trim()];
  const cover = pickByRole(catalog, true);
  const cta = pickByRole(catalog, false);
  let middlePool = catalog.filter((t) => t !== cover && t !== cta && !t.slots.some((s) => ["stat", "author", "cta"].includes(s.role)));
  const prefer: Record<string, number> = { afirmacao: 0, topico: 1, passo: 2, lista: 3 };
  middlePool.sort((a, b) => (prefer[a.archetype] ?? 9) - (prefer[b.archetype] ?? 9));
  if (!middlePool.length) middlePool = catalog.filter((t) => t !== cover);
  if (!middlePool.length) middlePool = catalog;

  const fit = (text: string, limit?: number | null) => {
    const lim = limit || 120;
    const t = cleanText(text, false);
    if (t.length <= lim) return t;
    return `${t.slice(0, lim).replace(/\s+\S*$/, "").replace(/[,;:]+$/, "")}…`;
  };

  const fill = (t: SlideTemplateDef, chunk: string[]): Record<string, any> => {
    const fields: Record<string, any> = {};
    const slots = contentSlots(t);
    const titleSlot = slots.find((s) => s.role === "title");
    const bodySlot = slots.find((s) => s.role === "body" || s.role === "text");
    if (titleSlot) fields[titleSlot.id] = fit(chunk[0], titleSlot.max_chars);
    if (bodySlot && chunk.length > 1) fields[bodySlot.id] = fit(chunk.slice(1).join(" "), bodySlot.max_chars);
    else if (bodySlot && !titleSlot) fields[bodySlot.id] = fit(chunk[0], bodySlot.max_chars);
    for (const g of t.groups) {
      const pts = chunk.length > 1 ? chunk.slice(1) : chunk;
      fields[g.id] = pts.slice(0, g.max_items).map((p) => {
        const row: Record<string, string> = {};
        for (const sl of g.item_slots) if (sl.role === "title" || sl.role === "text") row[sl.id] = fit(p, sl.max_chars);
        return row;
      });
    }
    return fields;
  };

  const totalMid = !req.is_single_slide ? Math.max(n - 2, 0) : 0;
  const plan: [SlideTemplateDef, string[]][] = [];
  if (req.is_single_slide || n === 1) plan.push([cover || catalog[0], sentences.slice(0, 1)]);
  else {
    plan.push([cover || catalog[0], [req.topic && req.topic.trim() !== source.trim() ? req.topic.trim() : sentences[0]]]);
    const per = Math.max(1, Math.floor(sentences.length / Math.max(totalMid, 1)));
    for (let k = 0; k < totalMid; k++) {
      const chunk = sentences.slice(k * per, (k + 1) * per);
      plan.push([middlePool[k % middlePool.length], chunk.length ? chunk : [sentences[sentences.length - 1]]]);
    }
    if (n >= 2) plan.push([cta || middlePool[0], ["Salve este conteúdo para consultar depois.", "Compartilhe com quem precisa ver isso."]]);
  }

  const reqTheme = (req.theme || "brand").toLowerCase();
  const slides = plan.map(([t, chunk], k) => {
    const i = k + 1;
    const fields = fill(t, chunk);
    return newSlide({
      id: `slide_${String(i).padStart(2, "0")}`, index: i, template_type: t.archetype, template_code: t.code,
      theme: resolveTheme(reqTheme, i, t.default_bg), fields, title: String(fields.title || t.name).replace(/\*\*/g, ""),
      body: fields.body, show_pagination: !req.is_single_slide,
    });
  });
  return {
    id: `proj_${randomUUID().replace(/-/g, "").slice(0, 8)}`, title: shorten(req.topic || sentences[0], 80), brandbook_id: bb.id,
    archetype: req.archetype, theme: req.theme || "brand", is_single_slide: !!req.is_single_slide, slides, warnings,
    carousel_model: "brandbook",
  };
}

// ----------------------------------------------------------------------------------------------------------------
// Fluxo principal
// ----------------------------------------------------------------------------------------------------------------

function stampBriefing(project: CarouselProjectData, req: GenerateRequest, source: string): CarouselProjectData {
  project.topic = req.topic || null;
  project.source_context = source.slice(0, 30000);
  project.target_audience = req.target_audience ?? null;
  project.additional_instructions = req.additional_instructions ?? null;
  project.project_id = req.project_id ?? null;
  return project;
}

export async function generateCarousel(
  req: GenerateRequest, bb: Brandbook, actor: Actor, progress?: ProgressFn,
): Promise<CarouselProjectData> {
  report(progress, "Lendo o contexto", 4);
  const source = (req.context || req.topic || "").trim();
  if (!source) throw new AIGenerationError("Informe o contexto ou o tema do carrossel.", 400);
  const n = req.is_single_slide ? 1 : Math.max(1, Math.min(Math.floor(req.slide_count || 7), MAX_SLIDES));

  const wantsImages = IMAGE_INTENT_RE.test(`${source.slice(0, 3000)} ${req.additional_instructions || ""}`);
  const catalog = nativeCatalog(bb, wantsImages);
  if (!catalog.length) {
    throw new AIGenerationError("Esta marca não tem modelos de slide importados. Importe o brand book (.zip) em Marcas para gerar carrosséis.", 400);
  }

  const cfg = await resolveCfg(actor.userId, actor.companyId, req.provider, req.model);
  const warnings: string[] = [];
  if (!cfg) {
    warnings.push(
      "Nenhuma chave de IA configurada. O carrossel foi montado sem IA, dividindo o seu texto entre os modelos da marca. " +
      "Configure uma chave em Configurações > Integrações para um resultado editorial.",
    );
    return stampBriefing(composeOffline(req, bb, catalog, source, n, warnings), req, source);
  }
  return stampBriefing(await generateNative(req, bb, catalog, cfg, actor, source, n, warnings, progress), req, source);
}

async function generateNative(
  req: GenerateRequest, bb: Brandbook, catalog: SlideTemplateDef[], cfg: AiCfg, actor: Actor, source: string, n: number,
  warnings: string[], progress?: ProgressFn,
): Promise<CarouselProjectData> {
  const limit = CONTEXT_LIMIT_CHARS[cfg.provider] || 12000;
  let condensed = false;
  if (source.length > limit) {
    source = await condenseContext(cfg, source, limit, warnings, progress);
    condensed = true;
  }
  // textos curtos (tema) são só formatação: raciocínio baixo. Transcrições pedem planejar a cobertura: médio.
  const effort = source.length < 2500 ? "low" : "medium";

  const system = await buildSystemPrompt(actor.userId, bb, catalog, n, !!req.is_single_slide, req.archetype);
  const user = buildUserPrompt(req, source, n, !!req.is_single_slide, condensed);
  const messages: ChatMsg[] = [{ role: "user", content: user }];
  const maxTokens = Math.min(9000, 700 * n + 1800);

  report(progress, `Escrevendo ${n === 1 ? "o slide" : `os ${n} slides`} com a IA`, 55);
  let { text: raw } = await chat(cfg, system, messages, maxTokens, { effort });
  report(progress, "Conferindo estrutura e campos", 88);
  let data = parseOrNull(raw);
  if (!data) {
    // JSON quebrado ou truncado: uma nova tentativa com mais espaço
    messages.push(
      { role: "assistant", content: raw.slice(0, 6000) },
      { role: "user", content: "A resposta não era um JSON válido (ou foi cortada). Responda de novo apenas com o JSON completo." },
    );
    report(progress, "Refazendo o JSON que veio incompleto", 90);
    ({ text: raw } = await chat(cfg, system, messages, Math.min(12000, Math.floor(maxTokens * 1.5)), { effort }));
    data = parseOrNull(raw);
    if (!data) throw new AIGenerationError("A IA não devolveu um JSON válido. Tente novamente ou use outro modelo.", 502);
  }

  let slidesRaw: any[] = Array.isArray(data.slides) ? data.slides : [];
  if (slidesRaw.length !== n) {
    messages.push(
      { role: "assistant", content: raw.slice(0, 8000) },
      {
        role: "user",
        content: `Você retornou ${slidesRaw.length} slides, mas são necessários EXATAMENTE ${n}. Reescreva o JSON completo com exatamente ${n} slides, cobrindo o contexto do início ao fim.`,
      },
    );
    report(progress, `Ajustando para exatamente ${n} slides`, 92);
    const { text: raw2 } = await chat(cfg, system, messages, maxTokens, { effort });
    const data2 = parseOrNull(raw2);
    if (data2 && Array.isArray(data2.slides) && Math.abs(data2.slides.length - n) <= Math.abs(slidesRaw.length - n)) {
      data = data2;
      slidesRaw = data2.slides;
    }
  }

  report(progress, "Montando os slides", 97);
  return assemble(data, slidesRaw, req, bb, catalog, n, warnings);
}

export { requireCfg };
