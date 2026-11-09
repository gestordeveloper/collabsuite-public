/**
 * Gera o HTML 1080x1350 de cada slide a partir dos modelos reais do brand book.
 * (O fallback de 9 layouts genéricos do CarrosselX não foi portado: toda marca precisa ter modelos importados.)
 */
import type { Element } from "domhandler";
import * as te from "./templateEngine";
import { fetchStoredFileBytes } from "../../lib/fileStorage";
import type { Brandbook, SlideData, SlideTemplateDef } from "./types";

export function findNativeTemplate(slide: SlideData, bb: Brandbook): SlideTemplateDef | null {
  const templates = (bb.slide_templates || []).filter((t) => t.html);
  if (!templates.length) return null;
  const code = (slide.template_code || "").toLowerCase();
  if (code) {
    const hit = templates.find((t) => t.code.toLowerCase() === code);
    if (hit) return hit;
  }
  const tt = (slide.template_type || "").toLowerCase();
  // projetos antigos: template_type guardava o código (t04) ou o arquétipo (afirmacao)
  return templates.find((t) => t.code.toLowerCase() === tt) || templates.find((t) => t.archetype.toLowerCase() === tt) || null;
}

const MIME_BY_EXT: Record<string, string> = {
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".png": "image/png",
};

/** URLs de imagem do slide (campos de imagem e image_url), para pré-carregar antes de renderizar. */
export function collectImageUrls(slide: SlideData, tpl: SlideTemplateDef): string[] {
  const urls = new Set<string>();
  for (const sl of tpl.slots) {
    if (sl.role !== "image") continue;
    const v = slide.fields?.[sl.id];
    if (typeof v === "string" && v && !te.isVideoUrl(v)) urls.add(v);
  }
  if (slide.image_url && !te.isVideoUrl(slide.image_url)) urls.add(slide.image_url);
  return [...urls];
}

/** Baixa as imagens e devolve {url: data URI}: o HTML exportado não depende de rede nem de cookies. */
export async function inlineImages(urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(urls.map(async (url) => {
    if (url.startsWith("data:")) { out.set(url, url); return; }
    try {
      const bytes = await fetchStoredFileBytes(url);
      const ext = (url.split("?")[0].match(/\.[a-z0-9]+$/i)?.[0] || ".png").toLowerCase();
      out.set(url, `data:${MIME_BY_EXT[ext] || "image/png"};base64,${bytes.toString("base64")}`);
    } catch {
      /* mantém a URL original: a imagem falha só neste slide */
    }
  }));
  return out;
}

export interface RenderOptions {
  total: number;
  isSingle: boolean;
  /** url -> data URI (exportação). Sem isso, as URLs seguem como estão (prévia no navegador). */
  inlined?: Map<string, string>;
}

export function renderSlideHtml(slide: SlideData, bb: Brandbook, opts: RenderOptions): string {
  const tpl = findNativeTemplate(slide, bb);
  if (!tpl) throw new Error("Esta marca não tem modelos de slide importados de um brand book.");
  return renderNative(tpl, slide, bb, opts);
}

function renderNative(tpl: SlideTemplateDef, slide: SlideData, bb: Brandbook, opts: RenderOptions): string {
  const { $, root } = te.fillTemplate(tpl, slide, {
    brandName: bb.name, handle: bb.handle, assets: bb.assets || {}, total: opts.total, isSingle: opts.isSingle,
    fallbackHl: bb.colors.primary_600, primary: bb.colors.primary_600,
    imageResolver: opts.inlined ? (u) => opts.inlined!.get(u) || u : undefined,
  });

  // Tema pedido: usa a variante clara/escura da própria marca (só troca neutros; a cor de destaque permanece)
  const want = slide.theme;
  if ((want === "dark" || want === "light") && (tpl.default_bg === "dark" || tpl.default_bg === "light") && want !== tpl.default_bg) {
    const hasTokens = (bb.theme_tokens as any)?.dark?.bg && (bb.theme_tokens as any)?.light?.bg;
    const tokens = hasTokens
      ? (bb.theme_tokens as any)
      : te.computeThemeTokens(bb.slide_templates, {
        neutral_950: bb.colors.neutral_950, neutral_50: bb.colors.neutral_50, neutral_dark: bb.colors.neutral_dark,
      });
    te.applyTheme(root, tpl.default_bg, want, tokens, bb.colors.primary_600);
  }
  if (slide.bg_override) te.setElementStyle(root, { background: slide.bg_override });
  const ct = slide.custom_typography;
  const extra: [string | null | undefined, number | null | undefined][] = ct
    ? [[ct.title_font, ct.title_weight], [ct.body_font, ct.body_weight]]
    : [];
  return te.wrapDocument($, root as Element, bb, extra);
}

/** Pré-visualização do modelo com os textos de exemplo do brand book (para validar a importação). */
export function renderTemplatePreview(bb: Brandbook, code: string, theme?: string | null): string {
  const tpl = bb.slide_templates.find((t) => t.code.toLowerCase() === code.toLowerCase() && t.html);
  if (!tpl) throw new Error(`Modelo ${code} não encontrado ou sem HTML.`);
  const idx = Math.max(1, parseInt(tpl.code.replace(/\D/g, "") || "1", 10));
  const slide: SlideData = {
    id: "preview", index: idx, template_type: tpl.archetype, template_code: tpl.code,
    theme: theme === "dark" || theme === "light" ? theme : null, title: "", fields: {}, show_pagination: true,
    custom_typography: {}, field_font_sizes: {}, animation: { preset: "none", ken_burns: false },
  };
  return renderNative(tpl, slide, bb, { total: Math.max(idx, bb.slide_templates.length, 8), isSingle: false });
}
