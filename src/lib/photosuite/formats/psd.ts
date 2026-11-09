/**
 * PSD (Adobe Photoshop) — leitura e escrita com `ag-psd`. Traz camadas, grupos, máscaras, modos de
 * mesclagem, opacidade, visibilidade, texto, estilos de camada e os ajustes mais comuns.
 * Fica de fora (e vira aviso): recorte (clipping), máscaras vetoriais/de grupo, objetos inteligentes
 * editáveis, formas vetoriais (viram pixels), cores que não sejam RGB 8 bits e os ajustes sem
 * equivalente aqui.
 */
import { readPsd, writePsd, type Layer as PsdLayer, type Psd } from "ag-psd";
import type { Adjustment } from "../adjustments";
import { defaultAdjustment } from "../adjustments";
import { createCanvas, renderDocument } from "../engine";
import { defaultStyle, hasStyles, styleEnabled, type FxCommon, type LayerStyles } from "../effects";
import { DEFAULT_TEXT, TEXT_PAD, firstBaseline, renderText, type TextData } from "../text";
import { newId } from "../tree";
import type { BlendMode, GroupLayer, Layer, RasterLayer } from "../types";
import type { ExportResult, ImportResult } from "./types";

// ---------------------------------------------------------------------------------------------
// Modos de mesclagem
// ---------------------------------------------------------------------------------------------

const TO_PSD: Partial<Record<BlendMode, string>> = {
  "pass-through": "pass through", normal: "normal", dissolve: "dissolve", darken: "darken", multiply: "multiply", "color-burn": "color burn",
  "linear-burn": "linear burn", "darker-color": "darker color", lighten: "lighten", screen: "screen", "color-dodge": "color dodge",
  "linear-dodge": "linear dodge", "lighter-color": "lighter color", overlay: "overlay", "soft-light": "soft light", "hard-light": "hard light",
  "vivid-light": "vivid light", "linear-light": "linear light", "pin-light": "pin light", "hard-mix": "hard mix", difference: "difference",
  exclusion: "exclusion", subtract: "subtract", divide: "divide", hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity",
};
const FROM_PSD: Record<string, BlendMode> = Object.fromEntries(Object.entries(TO_PSD).map(([k, v]) => [v as string, k as BlendMode]));
FROM_PSD["subtraction"] = "subtract";

const toBlend = (b: string | undefined): BlendMode => (b && FROM_PSD[b]) || "normal";

// ---------------------------------------------------------------------------------------------
// Cores
// ---------------------------------------------------------------------------------------------

const h2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

/** Cor do ag-psd (RGBA/RGB 0–255, FRGB 0–1, tons de cinza) → #rrggbb. */
function colorToHex(c: any, fallback = "#000000"): string {
  if (!c) return fallback;
  if ("fr" in c) return `#${h2(c.fr * 255)}${h2(c.fg * 255)}${h2(c.fb * 255)}`;
  if ("r" in c) return `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;
  if ("k" in c) return `#${h2(c.k)}${h2(c.k)}${h2(c.k)}`;
  return fallback;
}
const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

// ---------------------------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------------------------

type PxData = { data: ArrayLike<number>; width: number; height: number };

/** ImageData do ag-psd (8 ou 16 bits) → canvas. */
function pixelsToCanvas(px: PxData): HTMLCanvasElement {
  const c = createCanvas(px.width, px.height);
  const out = new ImageData(px.width, px.height);
  const src = px.data as ArrayLike<number> & { BYTES_PER_ELEMENT?: number };
  const shift = src.BYTES_PER_ELEMENT === 2 ? 8 : 0;
  for (let i = 0; i < out.data.length; i++) out.data[i] = shift ? (src[i] as number) >> shift : (src[i] as number);
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Estilos de camada
// ---------------------------------------------------------------------------------------------

const unit = (u: any, def = 0) => (u && typeof u.value === "number" ? u.value : def);
const pct = (u: any) => Math.min(1, Math.max(0, unit(u) / 100));

function commonOf(x: any, defBlend: BlendMode): FxCommon {
  return { enabled: x?.enabled !== false, blend: x?.blendMode ? toBlend(x.blendMode) : defBlend, opacity: x?.opacity ?? 1 };
}

function stopsOf(g: any): { pos: number; color: string }[] | null {
  if (!g || g.type !== "solid" || !g.colorStops?.length) return null;
  return g.colorStops.map((s: any) => ({ pos: Math.min(1, Math.max(0, s.location / 4096)), color: colorToHex(s.color) }));
}

function importEffects(e: any, warn: (m: string) => void): LayerStyles | undefined {
  if (!e || e.disabled) return undefined;
  const s: LayerStyles = {};
  const shadow = (x: any, key: "dropShadow" | "innerShadow") => {
    if (!x) return;
    s[key] = {
      ...defaultStyle(key),
      common: commonOf(x, "multiply"),
      color: colorToHex(x.color),
      angle: x.angle ?? 120,
      useGlobalLight: x.useGlobalLight ?? true,
      distance: unit(x.distance, 5),
      spread: pct(x.choke),
      size: unit(x.size, 5),
    };
  };
  shadow(e.dropShadow?.[0], "dropShadow");
  shadow(e.innerShadow?.[0], "innerShadow");
  const glow = (x: any, key: "outerGlow" | "innerGlow") => {
    if (!x) return;
    const stops = stopsOf(x.gradient);
    s[key] = {
      ...defaultStyle(key),
      common: commonOf(x, "screen"),
      paint: stops
        ? { kind: "gradient", gradient: { stops, opacityStops: [], style: "linear", angle: 0, scale: 1, reverse: false, offset: [0, 0] } }
        : { kind: "color", color: colorToHex(x.color, "#ffffbe") },
      technique: x.technique === "precise" ? "precise" : "softer",
      source: x.source === "center" ? "center" : "edge",
      spread: pct(x.choke),
      size: unit(x.size, 5),
      range: x.range != null ? Math.min(1, Math.max(0.01, x.range > 1 ? x.range / 100 : x.range)) : 0.5,
      noise: x.noise ?? 0,
    };
  };
  glow(e.outerGlow, "outerGlow");
  glow(e.innerGlow, "innerGlow");
  const stroke = e.stroke?.[0];
  if (stroke) {
    const stops = stroke.fillType === "gradient" ? stopsOf(stroke.gradient) : null;
    if (stroke.fillType === "pattern") warn("Traço com padrão importado como cor sólida.");
    s.stroke = {
      ...defaultStyle("stroke"),
      common: commonOf(stroke, "normal"),
      size: unit(stroke.size, 3),
      position: stroke.position ?? "outside",
      paint: stops
        ? { kind: "gradient", gradient: { stops, opacityStops: [], style: "linear", angle: 90, scale: 1, reverse: false, offset: [0, 0] } }
        : { kind: "color", color: colorToHex(stroke.color, "#ff0000") },
    };
  }
  const solid = e.solidFill?.[0];
  if (solid) s.colorOverlay = { common: commonOf(solid, "normal"), color: colorToHex(solid.color, "#ff0000") };
  const grad = e.gradientOverlay?.[0];
  if (grad) {
    const stops = stopsOf(grad.gradient);
    if (stops) {
      s.gradientOverlay = {
        common: commonOf(grad, "normal"),
        gradient: { stops, opacityStops: [], style: grad.type ?? "linear", angle: grad.angle ?? 90, scale: (grad.scale ?? 100) / 100, reverse: !!grad.reverse, offset: [0, 0] },
      };
    } else {
      warn("Sobreposição de degradê com gradiente de ruído ignorada.");
    }
  }
  if (e.satin) {
    s.satin = {
      ...defaultStyle("satin"),
      common: commonOf(e.satin, "multiply"),
      color: colorToHex(e.satin.color),
      angle: e.satin.angle ?? 19,
      distance: unit(e.satin.distance, 11),
      size: unit(e.satin.size, 14),
      invert: !!e.satin.invert,
    };
  }
  if (e.bevel) {
    const b = e.bevel;
    const style = b.style === "outer bevel" ? "outer" : b.style === "emboss" ? "emboss" : b.style === "pillow emboss" ? "pillow" : "inner";
    if (b.style === "stroke emboss") warn("Relevo de traço importado como chanfro interno.");
    s.bevel = {
      ...defaultStyle("bevel"),
      enabled: b.enabled !== false,
      style,
      depth: (b.strength ?? 100) / 100,
      up: (b.direction ?? "up") === "up",
      size: unit(b.size, 5),
      soften: unit(b.soften, 0),
      angle: b.angle ?? 120,
      altitude: b.altitude ?? 30,
      useGlobalLight: b.useGlobalLight ?? true,
      highlight: { blend: toBlend(b.highlightBlendMode), opacity: b.highlightOpacity ?? 0.75, color: colorToHex(b.highlightColor, "#ffffff") },
      shadow: { blend: toBlend(b.shadowBlendMode), opacity: b.shadowOpacity ?? 0.75, color: colorToHex(b.shadowColor, "#000000") },
    };
  }
  if (e.patternOverlay) warn("Sobreposição de padrão ignorada.");
  return Object.keys(s).length ? s : undefined;
}

const px = (v: number) => ({ units: "Pixels" as const, value: v });
const percent = (v: number) => ({ units: "Percent" as any, value: v });

function exportEffects(styles: LayerStyles | undefined): any | undefined {
  if (!styles || !hasStyles(styles)) return undefined;
  const e: any = {};
  const com = (c: FxCommon) => ({ enabled: c.enabled, present: true, showInDialog: true, blendMode: (TO_PSD[c.blend] ?? "normal") as any, opacity: c.opacity });
  const shadow = (s: any) => ({
    ...com(s.common), size: px(s.size), angle: s.angle, distance: px(s.distance), color: hexToRgb(s.color),
    useGlobalLight: s.useGlobalLight, choke: percent(s.spread * 100), antialiased: false,
  });
  if (styleEnabled(styles, "dropShadow")) e.dropShadow = [shadow(styles.dropShadow)];
  if (styleEnabled(styles, "innerShadow")) e.innerShadow = [shadow(styles.innerShadow)];
  const glow = (g: any) => ({
    ...com(g.common), size: px(g.size), color: hexToRgb(g.paint.kind === "color" ? g.paint.color : g.paint.gradient.stops[0]?.color ?? "#ffffbe"),
    technique: g.technique, source: g.source, choke: percent(g.spread * 100), range: g.range * 100, noise: g.noise, antialiased: false,
  });
  if (styleEnabled(styles, "outerGlow")) e.outerGlow = glow(styles.outerGlow);
  if (styleEnabled(styles, "innerGlow")) e.innerGlow = glow(styles.innerGlow);
  if (styleEnabled(styles, "stroke")) {
    const st = styles.stroke!;
    e.stroke = [{ ...com(st.common), size: px(st.size), position: st.position, fillType: "color", color: hexToRgb(st.paint.kind === "color" ? st.paint.color : st.paint.gradient.stops[0]?.color ?? "#ff0000") }];
  }
  if (styleEnabled(styles, "colorOverlay")) e.solidFill = [{ ...com(styles.colorOverlay!.common), color: hexToRgb(styles.colorOverlay!.color) }];
  if (styleEnabled(styles, "satin")) {
    const s = styles.satin!;
    e.satin = { ...com(s.common), size: px(s.size), distance: px(s.distance), angle: s.angle, color: hexToRgb(s.color), invert: s.invert, antialiased: false };
  }
  if (styleEnabled(styles, "bevel")) {
    const b = styles.bevel!;
    e.bevel = {
      present: true, showInDialog: true, enabled: true, size: px(b.size), angle: b.angle, strength: b.depth * 100, soften: px(b.soften), altitude: b.altitude,
      useGlobalLight: b.useGlobalLight, direction: b.up ? "up" : "down",
      style: ({ inner: "inner bevel", outer: "outer bevel", emboss: "emboss", pillow: "pillow emboss" } as const)[b.style],
      technique: "smooth", highlightBlendMode: (TO_PSD[b.highlight.blend] ?? "screen") as any, shadowBlendMode: (TO_PSD[b.shadow.blend] ?? "multiply") as any,
      highlightColor: hexToRgb(b.highlight.color), shadowColor: hexToRgb(b.shadow.color), highlightOpacity: b.highlight.opacity, shadowOpacity: b.shadow.opacity,
    };
  }
  if (styleEnabled(styles, "gradientOverlay")) {
    const g = styles.gradientOverlay!;
    e.gradientOverlay = [{
      ...com(g.common), type: g.gradient.style, angle: g.gradient.angle, scale: g.gradient.scale * 100, reverse: g.gradient.reverse, align: true,
      gradient: {
        name: "Custom", type: "solid", smoothness: 1,
        colorStops: g.gradient.stops.map((s) => ({ color: hexToRgb(s.color), location: Math.round(s.pos * 4096), midpoint: 50 })),
        opacityStops: [{ opacity: 1, location: 0, midpoint: 50 }, { opacity: 1, location: 4096, midpoint: 50 }],
      },
    }];
  }
  return e;
}

// ---------------------------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------------------------

/** "Arial-BoldItalicMT" → { family: "Arial", weight: 700, italic: true } (o PSD só guarda o nome PostScript). */
function fontFromPostScript(name: string): { family: string; weight: number; italic: boolean } {
  const [base, style = ""] = name.split("-");
  const family = base.replace(/(MT|PS|PSMT)$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || DEFAULT_TEXT.family;
  const all = `${style} ${name}`;
  const weight = /Black|Heavy/i.test(all) ? 900 : /ExtraBold|UltraBold/i.test(all) ? 800 : /Bold/i.test(all) ? 700 : /Semibold|DemiBold/i.test(all) ? 600 : /Medium/i.test(all) ? 500 : /Light/i.test(all) ? 300 : /Thin/i.test(all) ? 100 : 400;
  return { family, weight, italic: /Italic|Oblique/i.test(all) };
}

function textFromPsd(pl: PsdLayer): { data: TextData; tx: number; ty: number } | null {
  const t: any = pl.text;
  if (!t || typeof t.text !== "string") return null;
  const st: any = t.style ?? t.styleRuns?.[0]?.style ?? {};
  const xf: number[] = t.transform ?? [1, 0, 0, 1, pl.left ?? 0, pl.top ?? 0];
  const scale = Math.abs(xf[0]) || 1;
  const f = fontFromPostScript(st.font?.name ?? "");
  const just: string = t.paragraphStyle?.justification ?? "left";
  const box = t.shapeType === "box" && t.boxBounds ? { w: Math.max(1, (t.boxBounds[2] - t.boxBounds[0]) * scale), h: Math.max(1, (t.boxBounds[3] - t.boxBounds[1]) * scale) } : null;
  const size = (st.fontSize ?? 12) * scale;
  const data: TextData = {
    ...DEFAULT_TEXT,
    text: t.text.replace(/\r\n?/g, "\n").replace(/\u0003/g, "\n"),
    family: f.family,
    weight: st.fauxBold ? 700 : f.weight,
    italic: st.fauxItalic || f.italic,
    size,
    color: colorToHex(st.fillColor),
    align: just.startsWith("justify") ? "justify" : (just as TextData["align"]),
    tracking: st.tracking ?? 0,
    leading: st.autoLeading === false && st.leading ? st.leading * scale : null,
    underline: !!st.underline,
    strikethrough: !!st.strikethrough,
    caps: st.fontCaps === 2 ? "upper" : st.fontCaps === 1 ? "small" : "normal",
    box,
  };
  return { data, tx: xf[4], ty: xf[5] };
}

// ---------------------------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------------------------

function adjustmentFromPsd(a: any): Adjustment | null {
  switch (a?.type) {
    case "brightness/contrast": return { kind: "brightness-contrast", brightness: a.brightness ?? 0, contrast: a.contrast ?? 0, legacy: !!a.useLegacy };
    case "invert": return { kind: "invert" };
    case "posterize": return { kind: "posterize", levels: a.levels ?? 4 };
    case "threshold": return { kind: "threshold", level: (a.level ?? 128) / 255 };
    case "exposure": return { kind: "exposure", exposure: a.exposure ?? 0, offset: a.offset ?? 0, gamma: a.gamma ?? 1 };
    case "vibrance": return { kind: "vibrance", vibrance: a.vibrance ?? 0, saturation: a.saturation ?? 0 };
    case "hue/saturation": {
      const d = defaultAdjustment("hue-saturation") as Extract<Adjustment, { kind: "hue-saturation" }>;
      const m = a.colorize ? a.colorization : a.master;
      return { ...d, hue: m?.hue ?? 0, saturation: m?.saturation ?? 0, lightness: m?.lightness ?? 0, colorize: !!a.colorize };
    }
    case "levels": {
      const d = defaultAdjustment("levels") as Extract<Adjustment, { kind: "levels" }>;
      const ch = (c: any) => (c ? { inBlack: c.shadowInput / 255, inWhite: c.highlightInput / 255, gamma: (c.midtoneInput ?? 100) / 100, outBlack: c.shadowOutput / 255, outWhite: c.highlightOutput / 255 } : undefined);
      const list = a.channels ?? [];
      return { ...d, master: ch(list[0]) ?? d.master, channels: [ch(list[1]) ?? d.channels[0], ch(list[2]) ?? d.channels[1], ch(list[3]) ?? d.channels[2]] };
    }
    case "curves": {
      const d = defaultAdjustment("curves") as Extract<Adjustment, { kind: "curves" }>;
      const pts = (c: any) => (c?.length ? c.map((p: any) => ({ x: p.input / 255, y: p.output / 255 })) : undefined);
      const list = a.channels ?? [];
      return { ...d, master: pts(list[0]) ?? d.master, channels: [pts(list[1]) ?? d.channels[0], pts(list[2]) ?? d.channels[1], pts(list[3]) ?? d.channels[2]] };
    }
    default: return null;
  }
}

function adjustmentToPsd(a: Adjustment): any | null {
  switch (a.kind) {
    case "brightness-contrast": return { type: "brightness/contrast", brightness: a.brightness, contrast: a.contrast, useLegacy: a.legacy };
    case "invert": return { type: "invert" };
    case "posterize": return { type: "posterize", levels: a.levels };
    case "threshold": return { type: "threshold", level: Math.round(a.level * 255) };
    case "exposure": return { type: "exposure", exposure: a.exposure, offset: a.offset, gamma: a.gamma };
    case "vibrance": return { type: "vibrance", vibrance: a.vibrance, saturation: a.saturation };
    case "hue-saturation": {
      const m = { hue: a.hue, saturation: a.saturation, lightness: a.lightness };
      return a.colorize ? { type: "hue/saturation", colorize: true, colorization: m, master: { hue: 0, saturation: 0, lightness: 0 } } : { type: "hue/saturation", master: m };
    }
    case "levels": {
      const ch = (c: Extract<Adjustment, { kind: "levels" }>["master"]) => ({
        shadowInput: Math.round(c.inBlack * 255), highlightInput: Math.round(c.inWhite * 255), shadowOutput: Math.round(c.outBlack * 255), highlightOutput: Math.round(c.outWhite * 255), midtoneInput: Math.round(c.gamma * 100),
      });
      return { type: "levels", channels: [ch(a.master), ...a.channels.map(ch)] };
    }
    case "curves": {
      const pts = (c: { x: number; y: number }[]) => c.map((p) => ({ input: Math.round(p.x * 255), output: Math.round(p.y * 255) }));
      return { type: "curves", channels: [pts(a.master), ...a.channels.map(pts)] };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------------------------------

export interface PsdImportOptions {
  /** converte camadas de texto em texto editável (o layout pode diferir um pouco do Photoshop) */
  editableText?: boolean;
}

export async function importPsd(buf: ArrayBuffer, fileName: string, opts: PsdImportOptions = {}): Promise<ImportResult> {
  const editableText = opts.editableText ?? true;
  const psd = readPsd(buf, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  const warnings = new Set<string>();
  const warn = (m: string) => warnings.add(m);
  const canvases = new Map<string, HTMLCanvasElement>();
  const counts = { text: 0, adjustmentSkipped: 0, clipping: 0, vector: 0, groupMask: 0 };

  if ((psd.colorMode ?? 3) !== 3) warn("O documento não é RGB: as cores podem ficar diferentes do original.");
  if ((psd.bitsPerChannel ?? 8) !== 8) warn(`O documento tem ${psd.bitsPerChannel} bits por canal; foi convertido para 8 bits.`);

  const base = (pl: PsdLayer) => ({
    id: newId(),
    name: pl.name || "Camada",
    visible: !pl.hidden,
    locked: !!(pl.protected?.all || pl.protected?.composite),
    opacity: pl.opacity ?? 1,
  });

  /** Máscara do PSD (retângulo em coordenadas do documento) → canvas do tamanho da camada, valor no alfa. */
  const buildMask = (pl: PsdLayer, x: number, y: number, w: number, h: number): HTMLCanvasElement | null => {
    const m = pl.mask;
    if (!m) return null;
    const mw = (m.right ?? 0) - (m.left ?? 0);
    const mh = (m.bottom ?? 0) - (m.top ?? 0);
    const src: any = m.imageData;
    const out = new ImageData(w, h);
    const def = m.defaultColor ?? 255;
    const ox = (m.positionRelativeToLayer ? (pl.left ?? 0) : 0) + (m.left ?? 0);
    const oy = (m.positionRelativeToLayer ? (pl.top ?? 0) : 0) + (m.top ?? 0);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const mx = x + i - ox;
        const my = y + j - oy;
        let v = def;
        if (src && mx >= 0 && my >= 0 && mx < mw && my < mh) v = src.data[(my * mw + mx) * 4];
        const o = (j * w + i) * 4;
        out.data[o] = out.data[o + 1] = out.data[o + 2] = 255;
        out.data[o + 3] = v;
      }
    }
    const c = createCanvas(w, h);
    c.getContext("2d")!.putImageData(out, 0, 0);
    return c;
  };

  const convert = (pl: PsdLayer): Layer | null => {
    if (pl.clipping) counts.clipping++;
    const common = base(pl);

    if (pl.children) {
      if (pl.mask) counts.groupMask++;
      const g: GroupLayer = {
        ...common,
        type: "group",
        blend: pl.blendMode === "pass through" || !pl.blendMode ? "pass-through" : toBlend(pl.blendMode),
        collapsed: pl.opened === false,
        children: pl.children.map(convert).filter((l): l is Layer => !!l),
      };
      return g;
    }

    if (pl.adjustment) {
      const adj = adjustmentFromPsd(pl.adjustment);
      if (!adj) {
        counts.adjustmentSkipped++;
        return null;
      }
      const w = psd.width;
      const h = psd.height;
      const layer: RasterLayer = { ...common, type: "raster", blend: toBlend(pl.blendMode), x: 0, y: 0, width: w, height: h, fill: null, src: null, mask: null, adjustment: adj };
      const mask = buildMask(pl, 0, 0, w, h) ?? (() => {
        const c = createCanvas(w, h);
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        return c;
      })();
      layer.mask = { src: null, enabled: !pl.mask?.disabled };
      canvases.set(`${layer.id}:mask`, mask);
      return layer;
    }

    const left = pl.left ?? 0;
    const top = pl.top ?? 0;
    let width = (pl.right ?? 0) - left;
    let height = (pl.bottom ?? 0) - top;
    const imageData = pl.imageData as PxData | undefined;
    if (pl.vectorMask || (pl as any).vectorFill) counts.vector++;

    // texto editável
    const tx = editableText ? textFromPsd(pl) : null;
    if (pl.text) counts.text++;
    if (tx) {
      const r = renderText(tx.data);
      const baseline = firstBaseline(tx.data);
      let x = tx.data.box ? left - TEXT_PAD : tx.tx - TEXT_PAD;
      const y = tx.data.box ? top - TEXT_PAD : ty0(tx.ty, baseline);
      if (!tx.data.box) x -= r.contentW * (tx.data.align === "center" ? 0.5 : tx.data.align === "right" ? 1 : 0);
      const layer: RasterLayer = {
        ...common, type: "raster", blend: toBlend(pl.blendMode), x: Math.round(x), y: Math.round(y), width: r.canvas.width, height: r.canvas.height,
        fill: null, src: null, mask: null, text: tx.data, styles: importEffects(pl.effects, warn),
      };
      canvases.set(layer.id, r.canvas);
      const m = buildMask(pl, layer.x, layer.y, layer.width, layer.height);
      if (m) {
        layer.mask = { src: null, enabled: !pl.mask?.disabled };
        canvases.set(`${layer.id}:mask`, m);
      }
      return layer;
    }

    let canvas: HTMLCanvasElement;
    if (imageData && width > 0 && height > 0) {
      canvas = pixelsToCanvas(imageData);
      width = canvas.width;
      height = canvas.height;
    } else {
      width = Math.max(1, width);
      height = Math.max(1, height);
      canvas = createCanvas(width, height);
    }
    const layer: RasterLayer = {
      ...common, type: "raster", blend: toBlend(pl.blendMode), x: left, y: top, width, height, fill: null, src: null, mask: null, styles: importEffects(pl.effects, warn),
    };
    canvases.set(layer.id, canvas);
    const m = buildMask(pl, left, top, width, height);
    if (m) {
      layer.mask = { src: null, enabled: !pl.mask?.disabled };
      canvases.set(`${layer.id}:mask`, m);
    }
    return layer;
  };

  let layers: Layer[] = (psd.children ?? []).map(convert).filter((l): l is Layer => !!l);

  // PSD "achatado" (sem camadas): usa a imagem composta
  if (layers.length === 0) {
    const comp = psd.imageData as PxData | undefined;
    const c = comp ? pixelsToCanvas(comp) : createCanvas(psd.width, psd.height);
    const layer: RasterLayer = { id: newId(), type: "raster", name: "Fundo", visible: true, locked: false, opacity: 1, blend: "normal", x: 0, y: 0, width: c.width, height: c.height, fill: null, src: null, mask: null };
    canvases.set(layer.id, c);
    layers = [layer];
    warn("O PSD não tinha camadas; foi aberto como uma única imagem.");
  }

  if (counts.text) warn(editableText ? `${counts.text} camada(s) de texto convertida(s) para texto editável — o layout pode diferir um pouco do Photoshop.` : `${counts.text} camada(s) de texto abertas como pixels.`);
  if (counts.adjustmentSkipped) warn(`${counts.adjustmentSkipped} camada(s) de ajuste sem equivalente foram ignoradas (podem alterar a aparência).`);
  if (counts.clipping) warn(`${counts.clipping} camada(s) com máscara de recorte (clipping): o recorte não é suportado e foi ignorado.`);
  if (counts.vector) warn(`${counts.vector} forma(s) vetorial(is) do PSD foram abertas como pixels.`);
  if (counts.groupMask) warn(`${counts.groupMask} grupo(s) com máscara: a máscara do grupo foi ignorada.`);
  if (psd.linkedFiles?.length || layersHave(psd.children, "placedLayer")) warn("Objetos inteligentes foram abertos como pixels (não são editáveis).");

  return { name: fileName.replace(/\.[^.]+$/, "") || "PSD", width: psd.width, height: psd.height, layers, canvases, warnings: [...warnings] };
}

function layersHave(ls: PsdLayer[] | undefined, key: string): boolean {
  return !!ls?.some((l) => (l as any)[key] || layersHave(l.children, key));
}

const ty0 = (ty: number, baseline: number) => ty - baseline;

// ---------------------------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------------------------

export function exportPsd(
  doc: { width: number; height: number; layers: Layer[] },
  getCanvas: (key: string) => HTMLCanvasElement | undefined,
): ExportResult {
  const warnings = new Set<string>();
  const counts = { shapes: 0, adjustmentSkipped: 0, paintnet: 0, styled: 0, groupMask: 0 };

  const maskOf = (l: RasterLayer): any | undefined => {
    if (!l.mask) return undefined;
    const m = getCanvas(`${l.id}:mask`);
    if (!m) return undefined;
    const src = m.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, m.width, m.height);
    const gray = new ImageData(m.width, m.height);
    for (let i = 0; i < src.data.length; i += 4) {
      gray.data[i] = gray.data[i + 1] = gray.data[i + 2] = src.data[i + 3];
      gray.data[i + 3] = 255;
    }
    return { left: l.x, top: l.y, right: l.x + m.width, bottom: l.y + m.height, defaultColor: 0, disabled: !l.mask.enabled, imageData: gray };
  };

  const blendOf = (b: BlendMode) => {
    const v = TO_PSD[b];
    if (!v) {
      counts.paintnet++;
      return "normal" as const;
    }
    return v as any;
  };

  const convert = (l: Layer): PsdLayer | null => {
    const common: PsdLayer = { name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: blendOf(l.blend), protected: l.locked ? { all: true } : undefined };
    if (l.type === "group") {
      return { ...common, opened: !l.collapsed, children: l.children.map(convert).filter((c): c is PsdLayer => !!c) };
    }
    if (l.adjustment) {
      const adj = adjustmentToPsd(l.adjustment);
      if (!adj) {
        counts.adjustmentSkipped++;
        return null;
      }
      const mask = maskOf(l);
      return { ...common, adjustment: adj, ...(mask ? { mask } : {}) };
    }
    const canvas = getCanvas(l.id);
    if (!canvas) return null;
    if (l.shape) counts.shapes++;
    if (hasStyles(l.styles)) counts.styled++;
    const out: PsdLayer = {
      ...common,
      left: l.x, top: l.y, right: l.x + canvas.width, bottom: l.y + canvas.height,
      imageData: canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height),
    };
    const effects = exportEffects(l.styles);
    if (effects) out.effects = effects;
    const mask = maskOf(l);
    if (mask) out.mask = mask;
    if (l.text) {
      const t = l.text;
      const ps = `${t.family.replace(/\s+/g, "")}${t.weight >= 700 || t.italic ? "-" : ""}${t.weight >= 700 ? "Bold" : ""}${t.italic ? "Italic" : ""}`;
      out.text = {
        text: t.text.replace(/\n/g, "\r"),
        transform: [1, 0, 0, 1, l.x + TEXT_PAD, l.y + TEXT_PAD + t.size],
        antiAlias: "smooth",
        shapeType: t.box ? "box" : "point",
        ...(t.box ? { boxBounds: [0, 0, t.box.w, t.box.h] } : {}),
        style: {
          font: { name: ps },
          fontSize: t.size,
          fillColor: hexToRgb(t.color),
          tracking: t.tracking,
          autoLeading: t.leading === null,
          ...(t.leading !== null ? { leading: t.leading } : {}),
          underline: t.underline,
          strikethrough: t.strikethrough,
          fontCaps: t.caps === "upper" ? 2 : t.caps === "small" ? 1 : 0,
        },
        paragraphStyle: { justification: t.align === "justify" ? "justify-left" : t.align },
      } as any;
    }
    return out;
  };

  const children = doc.layers.map(convert).filter((c): c is PsdLayer => !!c);

  // imagem composta (pré-visualização e compatibilidade com leitores que ignoram camadas)
  const comp = createCanvas(doc.width, doc.height);
  renderDocument(doc, comp);
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    imageData: comp.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, doc.width, doc.height),
    children,
  };
  const buffer = writePsd(psd, { generateThumbnail: true, noBackground: true });

  if (counts.shapes) warnings.add(`${counts.shapes} forma(s) vetorial(is) foram gravadas como pixels (o PSD perde a edição vetorial).`);
  if (counts.adjustmentSkipped) warnings.add(`${counts.adjustmentSkipped} camada(s) de ajuste sem equivalente no PSD não foram exportadas.`);
  if (counts.paintnet) warnings.add(`${counts.paintnet} camada(s) com modo de mesclagem do Paint.NET foram gravadas como Normal.`);
  if (counts.styled) warnings.add("Estilos de camada foram exportados; o resultado no Photoshop pode diferir levemente.");
  return { blob: new Blob([buffer], { type: "image/vnd.adobe.photoshop" }), warnings: [...warnings] };
}

