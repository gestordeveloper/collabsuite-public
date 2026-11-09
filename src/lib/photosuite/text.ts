/**
 * Camadas de texto. O texto é a fonte da verdade: os pixels da camada são re-gerados a partir de
 * `TextData` (ao editar, ao carregar o documento e quando a fonte termina de carregar).
 * Unidades: tamanho/entrelinha em px (documento a 72 dpi, então 1 pt = 1 px), tracking em 1/1000 em.
 */
import { GOOGLE_FONTS, cleanFamilyName, ensureFontLoaded, isCustomFontFamily } from "@/src/lib/design-studio/fonts";

export type TextAlign = "left" | "center" | "right" | "justify";
export type TextCaps = "normal" | "upper" | "small";

export interface TextData {
  text: string;
  family: string;
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  align: TextAlign;
  /** 1/1000 em */
  tracking: number;
  /** px entre linhas de base; `null` = automática (1.2 × tamanho) */
  leading: number | null;
  underline: boolean;
  strikethrough: boolean;
  caps: TextCaps;
  /** texto de parágrafo (caixa com quebra de linha); `null` = texto de ponto */
  box: { w: number; h: number } | null;
}

export const DEFAULT_TEXT: TextData = {
  text: "",
  family: "Inter",
  size: 48,
  weight: 400,
  italic: false,
  color: "#000000",
  align: "left",
  tracking: 0,
  leading: null,
  underline: false,
  strikethrough: false,
  caps: "normal",
  box: null,
};

/** Folga em volta do texto (serifas, descendentes, itálico). */
export const TEXT_PAD = 6;

const SMALL_CAPS_SCALE = 0.8;

function fontString(d: TextData, size = d.size): string {
  const family = `"${cleanFamilyName(d.family) || "Inter"}", sans-serif`;
  return `${d.italic ? "italic " : ""}${d.weight} ${size}px ${family}`;
}

export const leadingOf = (d: TextData) => d.leading ?? d.size * 1.2;

interface Line {
  text: string;
  /** fim de parágrafo (a última linha não é justificada) */
  last: boolean;
}

/** Runs de caixa-alta pequena: [texto, é pequeno?] */
function capsRuns(text: string, caps: TextCaps): [string, boolean][] {
  if (caps === "upper") return [[text.toUpperCase(), false]];
  if (caps !== "small") return [[text, false]];
  const runs: [string, boolean][] = [];
  for (const ch of text) {
    const small = ch !== ch.toUpperCase();
    const piece = small ? ch.toUpperCase() : ch;
    const last = runs[runs.length - 1];
    if (last && last[1] === small) last[0] += piece;
    else runs.push([piece, small]);
  }
  return runs;
}

function widthOf(ctx: CanvasRenderingContext2D, d: TextData, text: string): number {
  let w = 0;
  for (const [piece, small] of capsRuns(text, d.caps)) {
    ctx.font = fontString(d, small ? d.size * SMALL_CAPS_SCALE : d.size);
    w += ctx.measureText(piece).width;
  }
  return w;
}

/** Quebra o texto em linhas: respeita \n e, em caixas, quebra por palavras na largura da caixa. */
function breakLines(ctx: CanvasRenderingContext2D, d: TextData, maxWidth: number | null): Line[] {
  const out: Line[] = [];
  for (const para of d.text.split("\n")) {
    if (maxWidth === null || para === "") {
      out.push({ text: para, last: true });
      continue;
    }
    const words = para.split(/(\s+)/).filter((w) => w !== "");
    let cur = "";
    for (const w of words) {
      const trial = cur + w;
      if (cur !== "" && widthOf(ctx, d, trial.trimEnd()) > maxWidth) {
        out.push({ text: cur.trimEnd(), last: false });
        cur = w.trimStart();
      } else {
        cur = trial;
      }
    }
    out.push({ text: cur.trimEnd(), last: true });
  }
  return out;
}

export interface RenderedText {
  canvas: HTMLCanvasElement;
  /** largura/altura do conteúdo desenhado (sem a folga) */
  contentW: number;
  contentH: number;
}

/** Desenha o texto num canvas novo. */
export function renderText(d: TextData): RenderedText {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.letterSpacing = `${(d.tracking / 1000) * d.size}px`;
  const lines = breakLines(measure, d, d.box ? d.box.w : null);
  const lead = leadingOf(d);
  measure.font = fontString(d);
  const m = measure.measureText("Hg");
  const asc = m.fontBoundingBoxAscent ?? d.size * 0.9;
  const desc = m.fontBoundingBoxDescent ?? d.size * 0.25;

  const widths = lines.map((l) => widthOf(measure, d, l.text));
  const contentW = d.box ? d.box.w : Math.max(1, ...widths, 1);
  const contentH = Math.max(lead, lines.length * lead);
  const w = Math.ceil(contentW) + TEXT_PAD * 2;
  const h = Math.ceil(d.box ? Math.max(d.box.h, 1) : contentH) + TEXT_PAD * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d")!;
  ctx.letterSpacing = `${(d.tracking / 1000) * d.size}px`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = d.color;
  ctx.strokeStyle = d.color;

  const lineTop = (i: number) => TEXT_PAD + i * lead;
  lines.forEach((line, i) => {
    const baseline = lineTop(i) + (lead - (asc + desc)) / 2 + asc;
    const lw = widths[i];
    let x = TEXT_PAD;
    let extra = 0;
    if (d.align === "center") x += (contentW - lw) / 2;
    else if (d.align === "right") x += contentW - lw;
    else if (d.align === "justify" && !line.last && d.box) {
      const gaps = (line.text.match(/\s+/g) ?? []).length;
      if (gaps > 0) extra = (contentW - lw) / gaps;
    }
    const startX = x;
    for (const [piece, small] of capsRuns(line.text, d.caps)) {
      ctx.font = fontString(d, small ? d.size * SMALL_CAPS_SCALE : d.size);
      if (extra > 0) {
        // justificação: reparte o espaço extra entre as palavras
        for (const token of piece.split(/(\s+)/)) {
          ctx.fillText(token, x, baseline);
          x += ctx.measureText(token).width + (/^\s+$/.test(token) ? extra : 0);
        }
      } else {
        ctx.fillText(piece, x, baseline);
        x += ctx.measureText(piece).width;
      }
    }
    const lineEnd = extra > 0 ? startX + contentW : x;
    const thickness = Math.max(1, d.size / 16);
    if (d.underline) ctx.fillRect(startX, baseline + thickness * 1.5, lineEnd - startX, thickness);
    if (d.strikethrough) ctx.fillRect(startX, baseline - d.size * 0.3, lineEnd - startX, thickness);
  });
  return { canvas, contentW, contentH };
}

/** Distância do topo do canvas do texto até a linha de base da primeira linha (para posicionar texto importado). */
export function firstBaseline(d: TextData): number {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = fontString(d);
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent ?? d.size * 0.9;
  const desc = m.fontBoundingBoxDescent ?? d.size * 0.25;
  return TEXT_PAD + (leadingOf(d) - (asc + desc)) / 2 + asc;
}

/** Fração da largura que um texto de ponto "ancora": move o x ao redimensionar (0 esq, .5 centro, 1 dir). */
export const anchorFactor = (a: TextAlign) => (a === "center" ? 0.5 : a === "right" ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// Carregamento de fontes
// ---------------------------------------------------------------------------------------------

const ready = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Garante que a fonte do texto está disponível para o canvas e devolve `true` quando uma fonte
 * que ainda não estava pronta acabou de carregar (aí o texto precisa ser redesenhado).
 * Fontes do Google chegam por uma folha de estilos adicionada na hora: `document.fonts.load` só
 * enxerga a fonte depois que a folha é lida, então tentamos algumas vezes até aparecer.
 */
export async function ensureTextFont(d: Pick<TextData, "family" | "weight" | "italic" | "size">): Promise<boolean> {
  const family = cleanFamilyName(d.family);
  if (!family) return false;
  const spec = `${d.italic ? "italic " : ""}${d.weight} 16px "${family}"`;
  if (ready.has(spec)) return false;
  ensureFontLoaded(family);
  const remote = GOOGLE_FONTS.some((f) => f.family === family) || isCustomFontFamily(family);
  for (let attempt = 0; attempt < (remote ? 30 : 1); attempt++) {
    try {
      const faces = await document.fonts.load(spec, "Hg");
      if (faces.length > 0) {
        ready.add(spec);
        return true;
      }
    } catch {
      return false;
    }
    if (!remote) break;
    await sleep(250);
  }
  return false;
}
