/**
 * Regenerar um slide e revisar a copy do carrossel com IA.
 *
 * - regenerateSlide: reescreve UM slide mantendo coerência com o restante e com o contexto original.
 * - reviewProject: checagens locais (limite de caracteres, travessão, HTML) + revisão editorial pela IA, com uma
 *   sugestão por slide que a interface pode mandar direto para a regeneração.
 */
import {
  AIGenerationError, CONTEXT_LIMIT_CHARS, chat, cleanText, parseOrNull, report, requireCfg, shorten, type AiCfg, type ProgressFn,
} from "./aiClient";
import {
  buildSystemPrompt, findTemplate, nativeCatalog, resolveTheme, sanitizeFields, slideTitle, type Actor,
} from "./ai.service";
import * as imageText from "./imageText.service";
import * as people from "./people.service";
import type { Brandbook, CarouselProjectData, SlideData, SlideTemplateDef } from "./types";

const DASH = /[—–]|\s-\s/;
const HTML = /<[a-z/][^>]*>/i;
const URL_PREFIXES = ["/api/", "/uploads/", "http", "data:"];
const isUrl = (v: string) => URL_PREFIXES.some((p) => v.startsWith(p));

function templateOf(bb: Brandbook, slide: SlideData): SlideTemplateDef | null {
  const code = (slide.template_code || "").toLowerCase();
  return bb.slide_templates.find((t) => t.html && t.code.toLowerCase() === code) || null;
}

/** Texto legível do slide (campos nativos; sem URLs de imagem). */
export function slideText(slide: SlideData): string {
  const parts: string[] = [];
  for (const v of Object.values(slide.fields || {})) {
    if (typeof v === "string" && v.trim() && !isUrl(v)) parts.push(v.trim());
    else if (Array.isArray(v)) {
      for (const row of v) if (row && typeof row === "object") parts.push(Object.values(row).filter(Boolean).join(" "));
    }
  }
  if (!parts.length) parts.push(...[slide.title, slide.body].filter(Boolean) as string[]);
  return parts.join(" | ");
}

function outline(project: CarouselProjectData, markIndex?: number): string {
  return project.slides
    .map((s) => `Slide ${s.index} [${s.template_code || s.template_type}]: ${shorten(slideText(s), 260)}${s.index === markIndex ? "  <<< ESTE" : ""}`)
    .join("\n");
}

function contextBlock(project: CarouselProjectData, cfg: AiCfg): string {
  const src = (project.source_context || "").trim();
  const limit = CONTEXT_LIMIT_CHARS[cfg.provider] || 12000;
  if (src && src.length <= limit) return `CONTEXTO-BASE (fonte da verdade):\n<<<\n${src}\n>>>`;
  if (src) {
    const half = Math.floor(limit / 2);
    return `CONTEXTO-BASE (trechos do início e do fim; fonte da verdade):\n<<<\n${src.slice(0, half)}\n[...]\n${src.slice(-half)}\n>>>`;
  }
  return "CONTEXTO-BASE: não foi guardado para este carrossel. Use os demais slides abaixo como referência dos fatos.";
}

export async function regenerateSlide(
  project: CarouselProjectData, bb: Brandbook, index: number, actor: Actor,
  opts: { instruction?: string; keepTemplate?: boolean; provider?: string | null; model?: string | null } = {}, progress?: ProgressFn,
): Promise<SlideData> {
  const slide = project.slides.find((s) => s.index === index);
  if (!slide) throw new AIGenerationError("Slide não encontrado no projeto.", 404);

  const current = templateOf(bb, slide);
  const catalog = nativeCatalog(bb, !!current?.needs_image);
  if (current && !catalog.some((t) => t.code === current.code)) catalog.push(current);
  if (!catalog.length) throw new AIGenerationError("Regenerar um slide só funciona para marcas importadas de um brand book (com modelos de slide).", 400);

  const total = project.slides.length;
  let pool: SlideTemplateDef[];
  let role: string;
  if ((opts.keepTemplate ?? true) && current) {
    pool = [current];
    role = `Use o modelo ${current.code} (${current.name}).`;
  } else {
    const covers = catalog.filter((t) => t.archetype.startsWith("capa"));
    const ctas = catalog.filter((t) => t.archetype === "cta");
    const middle = catalog.filter((t) => !covers.includes(t) && !ctas.includes(t));
    if (index === 1 && total >= 2 && covers.length) { pool = covers; role = "Este é o slide de CAPA: gancho forte, use um modelo de capa."; }
    else if (index === total && total >= 3 && ctas.length) { pool = ctas; role = "Este é o slide de FECHAMENTO: chamada para ação, use um modelo de CTA."; }
    else { pool = middle.length ? middle : catalog; role = "Este é um slide de desenvolvimento: escolha o modelo que melhor entrega a ideia."; }
  }

  const cfg = await requireCfg(actor.userId, actor.companyId, opts.provider, opts.model);
  const system = current?.builtin
    ? await imageText.buildSystemPrompt(actor.userId, bb, await people.getPerson(project.person_id, actor.userId), 1, true, project.archetype)
    : await buildSystemPrompt(actor.userId, bb, pool, 1, true, project.archetype);
  const instruction = (opts.instruction || "").trim();
  const user = [
    contextBlock(project, cfg),
    `CARROSSEL COMPLETO (para manter a coerência e não repetir ideias dos outros slides):\n${outline(project, index)}`,
    `TAREFA: reescreva SOMENTE o slide ${index} de ${total}. ${role}`,
    `CONTEÚDO ATUAL DO SLIDE (reescreva, não copie): ${slideText(slide) || "(vazio)"}`,
    instruction
      ? `INSTRUÇÃO DO USUÁRIO: ${instruction}`
      : "INSTRUÇÃO DO USUÁRIO: nenhuma. Entregue uma versão nova e melhor, com outro ângulo, mais clara e mais persuasiva.",
    `PÚBLICO-ALVO: ${project.target_audience || "Empreendedores e profissionais"}`,
    'Responda apenas com o JSON no formato pedido, com "slides" contendo exatamente 1 slide.',
  ].join("\n\n");
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: user }];

  report(progress, `Reescrevendo o slide ${index} com a IA`, 30);
  let { text: raw } = await chat(cfg, system, messages, 2500, { effort: "low" });
  let data = parseOrNull(raw);
  if (!data) {
    messages.push({ role: "assistant", content: raw.slice(0, 4000) }, { role: "user", content: "Resposta inválida. Responda de novo apenas com o JSON completo." });
    report(progress, "Refazendo o JSON que veio incompleto", 70);
    ({ text: raw } = await chat(cfg, system, messages, 3500, { effort: "low" }));
    data = parseOrNull(raw);
  }
  const slidesRaw: any[] = data && Array.isArray(data.slides) ? data.slides : [];
  if (!slidesRaw.length || typeof slidesRaw[0] !== "object") {
    throw new AIGenerationError("A IA não devolveu um slide válido. Tente de novo ou mude o provedor.", 502);
  }

  report(progress, "Montando o slide", 92);
  const s = slidesRaw[0];
  const tpl = findTemplate(s.template ?? s.template_type, pool) || pool[0];
  const fieldsRaw = s.fields && typeof s.fields === "object" && !Array.isArray(s.fields)
    ? s.fields
    : Object.fromEntries(Object.entries(s).filter(([k]) => !["template", "template_type", "theme"].includes(k)));
  const fields = sanitizeFields(fieldsRaw, tpl, index, []);

  // imagens do slide anterior continuam, se o novo modelo tiver o mesmo espaço de imagem
  for (const sl of tpl.slots) if (sl.role === "image" && slide.fields[sl.id]) fields[sl.id] = slide.fields[sl.id];
  const changedTpl = tpl.code !== slide.template_code;
  return {
    ...slide, template_type: tpl.archetype, template_code: tpl.code, fields, title: slideTitle(fields, tpl),
    body: fields.body, category: fields.chip,
    field_font_sizes: changedTpl ? {} : slide.field_font_sizes,
    theme: changedTpl ? resolveTheme(project.theme || "brand", index, tpl.default_bg) : slide.theme,
  };
}

// ----------------------------------------------------------------------------------------------------------------
// Revisar a copy
// ----------------------------------------------------------------------------------------------------------------

function localIssues(slide: SlideData, tpl: SlideTemplateDef | null): string[] {
  const issues: string[] = [];
  const limits: Record<string, number | null> = {};
  const labels: Record<string, string> = {};
  if (tpl) {
    for (const sl of tpl.slots) { limits[sl.id] = sl.max_chars; labels[sl.id] = sl.label || sl.id; }
    for (const g of tpl.groups) {
      for (const sl of g.item_slots) {
        if (!(sl.id in limits)) limits[sl.id] = sl.max_chars;
        if (!(sl.id in labels)) labels[sl.id] = sl.label || sl.id;
      }
    }
  }
  const check = (value: string, slotId: string) => {
    if (!value || isUrl(value)) return;
    const name = labels[slotId] || slotId;
    if (DASH.test(value)) issues.push(`'${name}' usa travessão ou hífen solto entre frases (regra da marca: separar com ponto final).`);
    if (HTML.test(value)) issues.push(`'${name}' contém tag HTML.`);
    const limit = limits[slotId];
    const plain = value.replace(/\*\*/g, "");
    if (limit && plain.length > limit * 1.15) issues.push(`'${name}' tem ${plain.length} caracteres; o desenho do modelo prevê até ${limit}.`);
  };
  for (const [key, v] of Object.entries(slide.fields || {})) {
    if (typeof v === "string") check(v, key);
    else if (Array.isArray(v)) {
      for (const row of v) if (row && typeof row === "object") for (const [k2, v2] of Object.entries(row)) if (typeof v2 === "string") check(v2, k2);
    }
  }
  return issues;
}

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : null;
};

export async function reviewProject(
  project: CarouselProjectData, bb: Brandbook, actor: Actor,
  opts: { provider?: string | null; model?: string | null } = {}, progress?: ProgressFn,
) {
  if (!project.slides.length) throw new AIGenerationError("O carrossel não tem slides para revisar.", 400);
  const cfg = await requireCfg(actor.userId, actor.companyId, opts.provider, opts.model);

  report(progress, "Checando limites e regras da marca", 10);
  const local: Record<number, string[]> = {};
  for (const s of project.slides) local[s.index] = localIssues(s, templateOf(bb, s));

  const rules = bb.writing_rules.map((r) => `- ${r}`).join("\n");
  const system = `Você é editor-chefe de conteúdo da marca ${bb.name} (${bb.handle}). Revisa a copy de um carrossel de Instagram/LinkedIn já escrito.

REGRAS DE ESCRITA DA MARCA:
${rules}
- Sem travessão (—, –). Frases curtas, voz ativa, uma ideia por slide.

CRITÉRIOS (nota de 0 a 10 por slide e geral):
1. Fidelidade: nada que contradiga ou invente fatos fora do CONTEXTO-BASE; os pontos principais do contexto aparecem.
2. Gancho: o slide 1 prende em até 2 segundos? O último slide tem uma chamada para ação clara?
3. Fluxo: cada slide traz uma ideia nova e puxa para o próximo; sem repetição entre slides.
4. Clareza e persuasão: específico (não genérico), benefício claro, linguagem simples.

Seja direto e útil. Em "problemas" liste só o que realmente pode melhorar (lista vazia se o slide está bom).
Em "sugestao" escreva uma instrução curta e acionável para reescrever o slide (ex.: "Abrir com o número de clientes perdidos e cortar a explicação"); use "" se não precisar mudar.

FORMATO: apenas JSON válido:
{"resumo": "2 frases sobre o carrossel como um todo", "nota_geral": 8,
 "slides": [{"index": 1, "nota": 8, "problemas": ["..."], "sugestao": "..."}]}
Inclua TODOS os slides, na ordem.`;
  const user = [
    contextBlock(project, cfg),
    `PÚBLICO-ALVO: ${project.target_audience || "Empreendedores e profissionais"}`,
    `CARROSSEL (${project.slides.length} slides):\n` + project.slides.map((s) => `Slide ${s.index} [${s.template_code || s.template_type}]: ${slideText(s)}`).join("\n"),
    "Responda apenas com o JSON.",
  ].join("\n\n");

  report(progress, "Revisando a copy com a IA", 30);
  const { text } = await chat(cfg, system, [{ role: "user", content: user }], Math.min(6000, 400 * project.slides.length + 1200), { effort: "low" });
  const data = parseOrNull(text);
  if (!data) throw new AIGenerationError("A IA não devolveu uma revisão válida. Tente de novo.", 502);

  const byIndex = new Map<number, any>();
  for (const x of Array.isArray(data.slides) ? data.slides : []) if (x && /^\d+$/.test(String(x.index))) byIndex.set(Number(x.index), x);
  return {
    resumo: cleanText(data.resumo),
    nota_geral: num(data.nota_geral),
    slides: project.slides.map((s) => {
      const ai = byIndex.get(s.index) || {};
      const problems = (Array.isArray(ai.problemas) ? ai.problemas : []).filter((p: unknown) => String(p).trim()).map((p: unknown) => cleanText(p));
      return {
        index: s.index, titulo: s.title, modelo: s.template_code || s.template_type, nota: num(ai.nota),
        problemas: [...local[s.index], ...problems], sugestao: cleanText(ai.sugestao),
      };
    }),
  };
}
