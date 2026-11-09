/**
 * SVG — importação como camadas de forma/texto editáveis (path, rect, circle, ellipse, line, polyline,
 * polygon, g, text, com transformações, preenchimento, traço e gradientes lineares/radiais) e
 * exportação (formas → <path>, texto → <text>, pixels → <image>). Filtros, máscaras, clipPath,
 * padrões e <use> não são suportados e geram aviso.
 */
import { createCanvas } from "../engine";
import { defaultGradient, type GradientSpec } from "../gradient";
import { DEFAULT_TEXT, TEXT_PAD, firstBaseline, renderText, type TextData } from "../text";
import { newId } from "../tree";
import type { BlendMode, GroupLayer, Layer, RasterLayer } from "../types";
import {
  DEFAULT_STROKE, corner, ellipsePath, mapShape, rasterizeShape, rectPath, translateShape,
  type Anchor, type FillSpec, type ShapeData, type StrokeSpec, type SubPath,
} from "../vector";
import type { ExportResult, ImportResult } from "./types";

// ---------------------------------------------------------------------------------------------
// Matrizes 2D: [a, b, c, d, e, f] como no SVG
// ---------------------------------------------------------------------------------------------

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

function parseTransform(src: string | null): M {
  if (!src) return ID;
  let m: M = ID;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let t = re.exec(src); t; t = re.exec(src)) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: M = ID;
    switch (t[1]) {
      case "matrix": n = [a[0], a[1], a[2], a[3], a[4], a[5]]; break;
      case "translate": n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case "scale": n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const rot: M = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        n = a.length >= 3 ? mul(mul([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]) : rot;
        break;
      }
      case "skewX": n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case "skewY": n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, n);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Caminhos (atributo d)
// ---------------------------------------------------------------------------------------------

/** Arco elíptico (SVG endpoint) → curvas de Bézier cúbicas. */
function arcToBeziers(x1: number, y1: number, rxIn: number, ryIn: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number): number[][] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  if (fs && dth < 0) dth += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const delta = dth / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: number[][] = [];
  let a = th1;
  const pt = (angle: number, ox = 0, oy = 0): [number, number] => {
    const px = rx * Math.cos(angle) + ox;
    const py = ry * Math.sin(angle) + oy;
    return [cos * px - sin * py + cx, sin * px + cos * py + cy];
  };
  for (let i = 0; i < segs; i++) {
    const b = a + delta;
    const [sx, sy] = [Math.cos(a), Math.sin(a)];
    const [ex, ey] = [Math.cos(b), Math.sin(b)];
    const c1 = pt(a, -t * rx * sy, t * ry * sx);
    const c2 = pt(b, t * rx * ey, -t * ry * ex);
    const e = pt(b);
    out.push([c1[0], c1[1], c2[0], c2[1], e[0], e[1]]);
    a = b;
  }
  return out;
}

function parsePathData(d: string): SubPath[] {
  const paths: SubPath[] = [];
  let cur = null as SubPath | null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastC: [number, number] | null = null; // 2º ponto de controle da última cúbica (para S)
  let lastQ: [number, number] | null = null;
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const tokens: string[] = [];
  for (let m = re.exec(d); m; m = re.exec(d)) tokens.push(m[0]);
  let i = 0;
  const num = () => Number(tokens[i++]);
  const flag = () => {
    // flags de arco podem vir coladas ("a1 1 0 00.5.5"): consome um único caractere
    const t = tokens[i];
    if (t.length > 1 && /^[01]/.test(t)) {
      tokens[i] = t.slice(1);
      return Number(t[0]);
    }
    i++;
    return Number(t);
  };
  const isCmd = (t?: string) => !!t && /^[A-Za-z]$/.test(t);
  const start = (px: number, py: number) => {
    cur = { closed: false, points: [corner(px, py)] };
    paths.push(cur);
  };
  const lineTo = (px: number, py: number) => {
    if (!cur) start(x, y);
    cur!.points.push(corner(px, py));
  };
  const curveTo = (c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number) => {
    if (!cur) start(x, y);
    const a = cur!.points[cur!.points.length - 1];
    a.ox = c1x - a.x; a.oy = c1y - a.y;
    const n: Anchor = { x: px, y: py, ix: c2x - px, iy: c2y - py, ox: 0, oy: 0 };
    cur!.points.push(n);
  };
  let cmd = "";
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    else if (cmd === "") break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (C) {
      case "M": {
        x = ox + num(); y = oy + num(); sx = x; sy = y;
        start(x, y);
        cmd = rel ? "l" : "L";
        lastC = lastQ = null;
        break;
      }
      case "L": { x = ox + num(); y = oy + num(); lineTo(x, y); lastC = lastQ = null; break; }
      case "H": { x = ox + num(); lineTo(x, y); lastC = lastQ = null; break; }
      case "V": { y = oy + num(); lineTo(x, y); lastC = lastQ = null; break; }
      case "C": {
        const c1x = ox + num(), c1y = oy + num(), c2x = ox + num(), c2y = oy + num(), px = ox + num(), py = oy + num();
        curveTo(c1x, c1y, c2x, c2y, px, py);
        lastC = [c2x, c2y]; lastQ = null; x = px; y = py;
        break;
      }
      case "S": {
        const c2x = ox + num(), c2y = oy + num(), px = ox + num(), py = oy + num();
        const c1x = lastC ? 2 * x - lastC[0] : x;
        const c1y = lastC ? 2 * y - lastC[1] : y;
        curveTo(c1x, c1y, c2x, c2y, px, py);
        lastC = [c2x, c2y]; lastQ = null; x = px; y = py;
        break;
      }
      case "Q": {
        const qx = ox + num(), qy = oy + num(), px = ox + num(), py = oy + num();
        curveTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py);
        lastQ = [qx, qy]; lastC = null; x = px; y = py;
        break;
      }
      case "T": {
        const px = ox + num(), py = oy + num();
        const qx = lastQ ? 2 * x - lastQ[0] : x;
        const qy = lastQ ? 2 * y - lastQ[1] : y;
        curveTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py);
        lastQ = [qx, qy]; lastC = null; x = px; y = py;
        break;
      }
      case "A": {
        const rx = num(), ry = num(), rot = num(), fa = flag(), fs = flag();
        const px = ox + num(), py = oy + num();
        if (!cur) start(x, y);
        for (const b of arcToBeziers(x, y, rx, ry, rot, fa, fs, px, py)) curveTo(b[0], b[1], b[2], b[3], b[4], b[5]);
        x = px; y = py; lastC = lastQ = null;
        break;
      }
      case "Z": {
        if (cur) {
          const sp: SubPath = cur;
          const first = sp.points[0];
          const last = sp.points[sp.points.length - 1];
          if (sp.points.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
            first.ix = last.ix; first.iy = last.iy;
            sp.points.pop();
          }
          sp.closed = true;
        }
        x = sx; y = sy; cur = null; lastC = lastQ = null;
        break;
      }
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------------------------------

interface Style {
  fill: string | null;
  fillOpacity: number;
  stroke: string | null;
  strokeOpacity: number;
  strokeWidth: number;
  cap: StrokeSpec["cap"];
  join: StrokeSpec["join"];
  dash: number[] | null;
  evenOdd: boolean;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: string;
  textAnchor: string;
}

const DEFAULT_STYLE: Style = {
  fill: "#000000", fillOpacity: 1, stroke: null, strokeOpacity: 1, strokeWidth: 1, cap: "butt", join: "miter", dash: null, evenOdd: false,
  fontFamily: "sans-serif", fontSize: 16, fontWeight: 400, fontStyle: "normal", textAnchor: "start",
};

const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", transparent: "none" };

function parseColor(c: string): string | null {
  const v = c.trim().toLowerCase();
  if (v === "none" || v === "transparent") return null;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map((s) => (s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s)));
    const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
    return `#${h(p[0])}${h(p[1])}${h(p[2])}`;
  }
  return NAMED[v] && NAMED[v] !== "none" ? NAMED[v] : "#000000";
}

const lengthOf = (v: string | null, ref = 0): number => {
  if (!v) return 0;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.trim().endsWith("%") ? (n / 100) * ref : n;
};

/** Atributos de apresentação + style="…" (o style vence). */
function readStyle(el: Element, parent: Style): Style {
  const s: Style = { ...parent };
  const get = (name: string): string | null => {
    const st = el.getAttribute("style");
    if (st) {
      const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(st);
      if (m) return m[1].trim();
    }
    return el.getAttribute(name);
  };
  const fill = get("fill");
  if (fill) s.fill = fill.startsWith("url(") ? fill : parseColor(fill);
  const stroke = get("stroke");
  if (stroke) s.stroke = stroke.startsWith("url(") ? stroke : parseColor(stroke);
  const num = (n: string, def: number) => { const v = get(n); return v != null && Number.isFinite(parseFloat(v)) ? parseFloat(v) : def; };
  s.fillOpacity = num("fill-opacity", s.fillOpacity);
  s.strokeOpacity = num("stroke-opacity", s.strokeOpacity);
  s.strokeWidth = num("stroke-width", s.strokeWidth);
  const cap = get("stroke-linecap");
  if (cap === "butt" || cap === "round" || cap === "square") s.cap = cap;
  const join = get("stroke-linejoin");
  if (join === "miter" || join === "round" || join === "bevel") s.join = join;
  const dash = get("stroke-dasharray");
  if (dash) s.dash = dash === "none" ? null : dash.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  const rule = get("fill-rule");
  if (rule) s.evenOdd = rule === "evenodd";
  const ff = get("font-family");
  if (ff) s.fontFamily = ff.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  s.fontSize = num("font-size", s.fontSize);
  const fw = get("font-weight");
  if (fw) s.fontWeight = fw === "bold" ? 700 : fw === "normal" ? 400 : Number(fw) || s.fontWeight;
  const fst = get("font-style");
  if (fst) s.fontStyle = fst;
  const ta = get("text-anchor");
  if (ta) s.textAnchor = ta;
  return s;
}

export interface SvgImportOptions {
  /** `shapes`: camadas de forma/texto editáveis (padrão); `raster`: uma imagem */
  mode?: "shapes" | "raster";
}

function svgSize(root: Element): { w: number; h: number; vb: [number, number, number, number] | null } {
  const vbAttr = root.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const vb = vbAttr && vbAttr.length === 4 && vbAttr.every(Number.isFinite) ? (vbAttr as [number, number, number, number]) : null;
  let w = lengthOf(root.getAttribute("width"), vb?.[2] ?? 0);
  let h = lengthOf(root.getAttribute("height"), vb?.[3] ?? 0);
  if (!w || root.getAttribute("width")?.endsWith("%")) w = vb?.[2] ?? 1024;
  if (!h || root.getAttribute("height")?.endsWith("%")) h = vb?.[3] ?? 1024;
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), vb };
}

/** SVG renderizado pelo navegador como uma única imagem. */
async function importSvgAsImage(text: string, name: string, w: number, h: number, warnings: string[]): Promise<ImportResult> {
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Não foi possível renderizar o SVG."));
      i.src = url;
    });
    const c = createCanvas(w, h);
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const layer: RasterLayer = { id: newId(), type: "raster", name, visible: true, locked: false, opacity: 1, blend: "normal", x: 0, y: 0, width: w, height: h, fill: null, src: null, mask: null };
    return { name, width: w, height: h, layers: [layer], canvases: new Map([[layer.id, c]]), warnings };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importSvg(text: string, fileName: string, opts: SvgImportOptions = {}): Promise<ImportResult> {
  const name = fileName.replace(/\.[^.]+$/, "") || "SVG";
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) throw new Error("Arquivo SVG inválido.");
  const { w, h, vb } = svgSize(root);
  const warnings = new Set<string>();
  if (opts.mode === "raster") return importSvgAsImage(text, name, w, h, [...warnings]);

  const canvases = new Map<string, HTMLCanvasElement>();
  const base: M = vb ? mul([w / vb[2], 0, 0, h / vb[3], 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]) : ID;

  // gradientes (com herança por xlink:href)
  const byId = new Map<string, Element>();
  doc.querySelectorAll("[id]").forEach((e) => byId.set(e.getAttribute("id")!, e));
  const gradientOf = (ref: string): GradientSpec | null => {
    const id = /url\(\s*['"]?#([^)'"]+)/.exec(ref)?.[1];
    let el = id ? byId.get(id) : undefined;
    if (!el || !/gradient/i.test(el.nodeName)) { warnings.add("Preenchimento por padrão/imagem não suportado; usado preto."); return null; }
    const chain: Element[] = [];
    for (let e: Element | undefined = el; e && chain.length < 8; ) {
      chain.push(e);
      const href = e.getAttribute("href") ?? e.getAttribute("xlink:href");
      e = href ? byId.get(href.replace(/^#/, "")) : undefined;
    }
    const stopsEl = chain.map((e) => [...e.children].filter((c) => c.nodeName.toLowerCase() === "stop")).find((s) => s.length) ?? [];
    if (!stopsEl.length) return null;
    const opacityStops: GradientSpec["opacityStops"] = [];
    const stops = stopsEl.map((s) => {
      const st = readStyle(s, DEFAULT_STYLE);
      const raw = s.getAttribute("style")?.match(/stop-color\s*:\s*([^;]+)/)?.[1] ?? s.getAttribute("stop-color") ?? "#000";
      const off = s.getAttribute("offset") ?? "0";
      const pos = Math.min(1, Math.max(0, off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off)));
      const so = parseFloat(s.getAttribute("style")?.match(/stop-opacity\s*:\s*([^;]+)/)?.[1] ?? s.getAttribute("stop-opacity") ?? "1");
      if (so < 1) opacityStops.push({ pos, alpha: so });
      void st;
      return { pos, color: parseColor(raw) ?? "#000000" };
    });
    const g = defaultGradient();
    g.stops = stops;
    g.opacityStops = opacityStops.length ? opacityStops : [];
    const radial = el.nodeName.toLowerCase().includes("radial");
    g.style = radial ? "radial" : "linear";
    if (!radial) {
      const f = (n: string, d: number) => { const v = chain.map((e) => e.getAttribute(n)).find((x) => x != null); return v == null ? d : v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v); };
      const x1 = f("x1", 0), y1 = f("y1", 0), x2 = f("x2", 1), y2 = f("y2", 0);
      g.angle = (-Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    }
    return g;
  };

  const unsupported = new Set<string>();

  const makeShapeLayer = (shapeLocal: SubPath[], style: Style, m: M, label: string, opacity: number): RasterLayer | null => {
    if (!shapeLocal.length) return null;
    let fill: FillSpec | null = null;
    if (style.fill) {
      if (style.fill.startsWith("url(")) {
        const g = gradientOf(style.fill);
        fill = g ? { kind: "gradient", gradient: g } : { kind: "color", color: "#000000" };
      } else fill = { kind: "color", color: style.fill };
    }
    let stroke: StrokeSpec | null = null;
    if (style.stroke && style.strokeWidth > 0) {
      const sw = style.strokeWidth * scaleOf(m);
      const color = style.stroke.startsWith("url(") ? (gradientOf(style.stroke)?.stops[0]?.color ?? "#000000") : style.stroke;
      if (style.stroke.startsWith("url(")) warnings.add("Traço com gradiente importado como cor sólida.");
      stroke = { ...DEFAULT_STROKE, color, width: sw, cap: style.cap, join: style.join, dash: style.dash?.length ? Math.max(0.1, style.dash[0] / style.strokeWidth) : null, align: "center" };
    }
    if (!fill && !stroke) return null;
    const docShape = mapShape({ paths: shapeLocal, fill, stroke, evenOdd: style.evenOdd }, (x, y) => apply(m, x, y));
    const r = rasterizeShape(docShape);
    const layer: RasterLayer = {
      id: newId(), type: "raster", name: label, visible: true, locked: false,
      opacity: Math.min(1, opacity * (fill ? style.fillOpacity : style.strokeOpacity)), blend: "normal",
      x: r.shiftX, y: r.shiftY, width: r.canvas.width, height: r.canvas.height, fill: null, src: null, mask: null,
      shape: translateShape(docShape, -r.shiftX, -r.shiftY),
    };
    canvases.set(layer.id, r.canvas);
    return layer;
  };

  const walk = (el: Element, parentStyle: Style, parentM: M): Layer[] => {
    const out: Layer[] = [];
    for (const child of el.children) {
      const tag = child.nodeName.toLowerCase().replace(/^svg:/, "");
      if (["defs", "title", "desc", "metadata", "style", "lineargradient", "radialgradient", "symbol", "clippath", "mask", "filter", "pattern"].includes(tag)) {
        if (["clippath", "mask", "filter", "pattern"].includes(tag)) unsupported.add(tag === "clippath" ? "clipPath" : tag);
        continue;
      }
      if (child.getAttribute("display") === "none" || child.getAttribute("visibility") === "hidden") continue;
      const m = mul(parentM, parseTransform(child.getAttribute("transform")));
      const style = readStyle(child, parentStyle);
      const opacity = parseFloat(child.getAttribute("opacity") ?? child.getAttribute("style")?.match(/(?:^|;)\s*opacity\s*:\s*([^;]+)/)?.[1] ?? "1");
      const op = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
      const label = child.getAttribute("id") || undefined;
      if (child.getAttribute("clip-path") || child.getAttribute("mask") || child.getAttribute("filter")) unsupported.add("clipPath/máscara/filtro");

      let paths: SubPath[] | null = null;
      switch (tag) {
        case "g":
        case "svg": {
          const inner = walk(child, style, m);
          if (inner.length) {
            const g: GroupLayer = { id: newId(), type: "group", name: label ?? "Grupo", visible: true, locked: false, opacity: op, blend: "pass-through", collapsed: false, children: inner };
            out.push(g);
          }
          continue;
        }
        case "path": paths = parsePathData(child.getAttribute("d") ?? ""); break;
        case "rect": {
          const x = lengthOf(child.getAttribute("x")), y = lengthOf(child.getAttribute("y"));
          const rw = lengthOf(child.getAttribute("width")), rh = lengthOf(child.getAttribute("height"));
          const rxA = lengthOf(child.getAttribute("rx")), ryA = lengthOf(child.getAttribute("ry"));
          if (rw > 0 && rh > 0) paths = [rectPath(x, y, rw, rh, Math.max(rxA, ryA) || 0)];
          break;
        }
        case "circle": {
          const r = lengthOf(child.getAttribute("r"));
          if (r > 0) paths = [ellipsePath(lengthOf(child.getAttribute("cx")), lengthOf(child.getAttribute("cy")), r, r)];
          break;
        }
        case "ellipse": {
          const rx = lengthOf(child.getAttribute("rx")), ry = lengthOf(child.getAttribute("ry"));
          if (rx > 0 && ry > 0) paths = [ellipsePath(lengthOf(child.getAttribute("cx")), lengthOf(child.getAttribute("cy")), rx, ry)];
          break;
        }
        case "line":
          paths = [{ closed: false, points: [corner(lengthOf(child.getAttribute("x1")), lengthOf(child.getAttribute("y1"))), corner(lengthOf(child.getAttribute("x2")), lengthOf(child.getAttribute("y2")))] }];
          style.fill = null;
          if (!style.stroke) style.stroke = "#000000";
          break;
        case "polyline":
        case "polygon": {
          const n = (child.getAttribute("points") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
          const pts: Anchor[] = [];
          for (let i = 0; i + 1 < n.length; i += 2) pts.push(corner(n[i], n[i + 1]));
          if (pts.length >= 2) paths = [{ closed: tag === "polygon", points: pts }];
          if (tag === "polyline" && style.fill === DEFAULT_STYLE.fill && !child.hasAttribute("fill")) style.fill = null;
          break;
        }
        case "text": {
          const t = textLayer(child, style, m, label, op);
          if (t) out.push(t);
          continue;
        }
        case "image": unsupported.add("image"); continue;
        case "use": unsupported.add("use"); continue;
        default: continue;
      }
      if (paths) {
        const l = makeShapeLayer(paths, style, m, label ?? ({ rect: "Retângulo", circle: "Círculo", ellipse: "Elipse", line: "Linha", polyline: "Polilinha", polygon: "Polígono", path: "Caminho" } as Record<string, string>)[tag] ?? "Forma", op);
        if (l) out.push(l);
      }
    }
    return out;
  };

  const textLayer = (el: Element, style: Style, m: M, label: string | undefined, opacity: number): RasterLayer | null => {
    const content = [...el.childNodes].map((n) => n.textContent ?? "").join("").replace(/\s+/g, " ").trim();
    if (!content) return null;
    const k = scaleOf(m);
    const x0 = lengthOf(el.getAttribute("x"));
    const y0 = lengthOf(el.getAttribute("y"));
    const data: TextData = {
      ...DEFAULT_TEXT, text: content, family: style.fontFamily === "sans-serif" ? DEFAULT_TEXT.family : style.fontFamily, size: style.fontSize * k,
      weight: style.fontWeight, italic: style.fontStyle === "italic", color: style.fill && !style.fill.startsWith("url(") ? style.fill : "#000000",
      align: style.textAnchor === "middle" ? "center" : style.textAnchor === "end" ? "right" : "left",
    };
    const r = renderText(data);
    const [px, py] = apply(m, x0, y0);
    const f = data.align === "center" ? 0.5 : data.align === "right" ? 1 : 0;
    const layer: RasterLayer = {
      id: newId(), type: "raster", name: label ?? content.slice(0, 40), visible: true, locked: false, opacity: opacity * style.fillOpacity, blend: "normal",
      x: Math.round(px - TEXT_PAD - r.contentW * f), y: Math.round(py - firstBaseline(data)), width: r.canvas.width, height: r.canvas.height,
      fill: null, src: null, mask: null, text: data,
    };
    canvases.set(layer.id, r.canvas);
    return layer;
  };

  const layers = walk(root, DEFAULT_STYLE, base);
  if (unsupported.size) warnings.add(`Recursos do SVG não suportados e ignorados: ${[...unsupported].join(", ")}.`);
  if (layers.length === 0) {
    warnings.add("Não foi possível converter as formas do SVG; aberto como imagem.");
    return importSvgAsImage(text, name, w, h, [...warnings]);
  }
  return { name, width: w, height: h, layers, canvases, warnings: [...warnings] };
}

// ---------------------------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) => String(Math.round(v * 1000) / 1000);

function pathD(paths: SubPath[]): string {
  const parts: string[] = [];
  for (const sp of paths) {
    if (!sp.points.length) continue;
    parts.push(`M${num(sp.points[0].x)} ${num(sp.points[0].y)}`);
    const seg = (a: Anchor, b: Anchor) => {
      if (!a.ox && !a.oy && !b.ix && !b.iy) parts.push(`L${num(b.x)} ${num(b.y)}`);
      else parts.push(`C${num(a.x + a.ox)} ${num(a.y + a.oy)} ${num(b.x + b.ix)} ${num(b.y + b.iy)} ${num(b.x)} ${num(b.y)}`);
    };
    for (let i = 0; i < sp.points.length - 1; i++) seg(sp.points[i], sp.points[i + 1]);
    if (sp.closed && sp.points.length > 1) {
      seg(sp.points[sp.points.length - 1], sp.points[0]);
      parts.push("Z");
    }
  }
  return parts.join("");
}

const BLEND_CSS: Partial<Record<BlendMode, string>> = {
  multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken", lighten: "lighten", "color-dodge": "color-dodge", "color-burn": "color-burn",
  "hard-light": "hard-light", "soft-light": "soft-light", difference: "difference", exclusion: "exclusion", hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity",
};

export function exportSvg(doc: { width: number; height: number; layers: Layer[] }, getCanvas: (key: string) => HTMLCanvasElement | undefined): ExportResult {
  const warnings = new Set<string>();
  const defs: string[] = [];
  let gradN = 0;
  let maskN = 0;

  const gradientDef = (g: GradientSpec, w: number, h: number): string => {
    const id = `g${++gradN}`;
    const stops = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => {
      const alpha = g.opacityStops.length ? g.opacityStops.reduce((p, c) => (Math.abs(c.pos - s.pos) < Math.abs(p.pos - s.pos) ? c : p)).alpha : 1;
      return `<stop offset="${num(s.pos)}" stop-color="${s.color}" stop-opacity="${num(alpha)}"/>`;
    }).join("");
    if (g.style === "radial") defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`);
    else {
      const a = (g.angle * Math.PI) / 180;
      const dx = Math.cos(a) / 2, dy = -Math.sin(a) / 2;
      defs.push(`<linearGradient id="${id}" x1="${num(0.5 - dx)}" y1="${num(0.5 - dy)}" x2="${num(0.5 + dx)}" y2="${num(0.5 + dy)}">${stops}</linearGradient>`);
    }
    void w; void h;
    return `url(#${id})`;
  };

  const common = (l: Layer): string => {
    const style: string[] = [];
    if (l.blend !== "normal" && l.blend !== "pass-through") {
      const css = BLEND_CSS[l.blend];
      if (css) style.push(`mix-blend-mode:${css}`);
      else warnings.add(`Modo de mesclagem "${l.blend}" não existe no SVG; gravado como Normal.`);
    }
    return `${l.visible ? "" : ' display="none"'}${l.opacity < 1 ? ` opacity="${num(l.opacity)}"` : ""}${style.length ? ` style="${style.join(";")}"` : ""} id="${esc(l.name).replace(/\s+/g, "_")}"`;
  };

  const layerSvg = (l: Layer): string => {
    if (l.type === "group") return `<g${common(l)}>${l.children.map(layerSvg).join("")}</g>`;
    if (l.adjustment) { warnings.add("Camadas de ajuste não existem no SVG e foram ignoradas."); return ""; }
    if (l.styles && Object.keys(l.styles).length) warnings.add("Estilos de camada não são exportados para SVG.");
    const tr = `translate(${l.x} ${l.y})`;
    if (l.shape) {
      const s = l.shape;
      const fill = s.fill ? (s.fill.kind === "color" ? s.fill.color : gradientDef(s.fill.gradient, l.width, l.height)) : "none";
      const st = s.stroke;
      if (st && st.align !== "center") warnings.add("Traço dentro/fora da forma foi gravado centralizado.");
      const strokeAttrs = st ? ` stroke="${st.color}" stroke-width="${num(st.width)}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"${st.dash ? ` stroke-dasharray="${num(st.dash * st.width)} ${num(st.dash * st.width)}"` : ""}` : "";
      if (l.mask) warnings.add("Máscaras de camada não foram aplicadas a formas no SVG.");
      return `<path${common(l)} transform="${tr}" d="${pathD(s.paths)}" fill="${fill}"${s.evenOdd ? ' fill-rule="evenodd"' : ""}${strokeAttrs}/>`;
    }
    if (l.text) {
      const t = l.text;
      if (t.box) warnings.add("Texto de parágrafo: as quebras automáticas de linha não são gravadas no SVG.");
      const anchor = t.align === "center" ? "middle" : t.align === "right" ? "end" : "start";
      const lead = t.leading ?? t.size * 1.2;
      const lines = t.text.split("\n");
      const w = renderText(t).contentW;
      const x0 = l.x + TEXT_PAD + (t.align === "center" ? w / 2 : t.align === "right" ? w : 0);
      const y0 = l.y + firstBaseline(t);
      const decor = [t.underline ? "underline" : "", t.strikethrough ? "line-through" : ""].filter(Boolean).join(" ");
      const spans = lines.map((ln, i) => `<tspan x="${num(x0)}" y="${num(y0 + i * lead)}">${esc(ln) || " "}</tspan>`).join("");
      return `<text${common(l)} font-family="${esc(t.family)}" font-size="${num(t.size)}" font-weight="${t.weight}" font-style="${t.italic ? "italic" : "normal"}" fill="${t.color}" text-anchor="${anchor}"${t.tracking ? ` letter-spacing="${num((t.tracking / 1000) * t.size)}"` : ""}${decor ? ` text-decoration="${decor}"` : ""}${t.caps === "upper" ? ' style="text-transform:uppercase"' : ""}>${spans}</text>`;
    }
    const canvas = getCanvas(l.id);
    if (!canvas) return "";
    let maskAttr = "";
    if (l.mask?.enabled) {
      const m = getCanvas(`${l.id}:mask`);
      if (m) {
        const g = createCanvas(m.width, m.height);
        const gctx = g.getContext("2d")!;
        gctx.fillStyle = "#000";
        gctx.fillRect(0, 0, g.width, g.height);
        gctx.globalCompositeOperation = "lighter";
        // alfa → cinza: pinta branco com o alfa da máscara sobre preto
        const tmp = createCanvas(m.width, m.height);
        const tctx = tmp.getContext("2d")!;
        tctx.fillStyle = "#fff";
        tctx.fillRect(0, 0, tmp.width, tmp.height);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(m, 0, 0);
        gctx.drawImage(tmp, 0, 0);
        const id = `m${++maskN}`;
        defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${l.x}" y="${l.y}" width="${m.width}" height="${m.height}"><image x="${l.x}" y="${l.y}" width="${m.width}" height="${m.height}" href="${g.toDataURL("image/png")}"/></mask>`);
        maskAttr = ` mask="url(#${id})"`;
      }
    }
    return `<image${common(l)}${maskAttr} x="${l.x}" y="${l.y}" width="${canvas.width}" height="${canvas.height}" href="${canvas.toDataURL("image/png")}"/>`;
  };

  const body = doc.layers.map(layerSvg).join("\n");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">\n${defs.length ? `<defs>${defs.join("")}</defs>\n` : ""}${body}\n</svg>\n`;
  return { blob: new Blob([svg], { type: "image/svg+xml" }), warnings: [...warnings] };
}
