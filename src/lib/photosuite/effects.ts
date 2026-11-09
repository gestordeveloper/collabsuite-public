/**
 * Estilos de camada (Photoshop "Layer Style") — port da lógica de mapas de cobertura de
 * crates/compose/src/effects.rs do PhotoCraft: a forma da camada (alfa) vira um mapa de cobertura que
 * é deslocado, expandido (spread/choke), borrado (tent), passado por um contorno e pintado com
 * cor/degradê no modo de mesclagem do efeito.
 *
 * Fora do escopo (documentado no codemap): padrões, contornos personalizados, textura do chanfro,
 * múltiplas instâncias do mesmo efeito, opacidade de preenchimento separada.
 */
import { blendChannel, blendRgb } from "./blend";
import { gradientT, prepareGradient, type Bounds, type GradientSpec } from "./gradient";
import type { BlendMode } from "./types";

// ---------------------------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------------------------

export type ContourId = "linear" | "cone" | "cone-inverted" | "half-round" | "gaussian" | "ring" | "sawtooth" | "steps";

export const CONTOUR_LABELS: Record<ContourId, string> = {
  linear: "Linear",
  cone: "Cone",
  "cone-inverted": "Cone invertido",
  "half-round": "Meia-volta",
  gaussian: "Gaussiano",
  ring: "Anel",
  sawtooth: "Dente de serra",
  steps: "Degraus",
};

export interface FxCommon {
  enabled: boolean;
  blend: BlendMode;
  /** 0..1 */
  opacity: number;
}

export type FxPaint = { kind: "color"; color: string } | { kind: "gradient"; gradient: GradientSpec };

export interface ShadowFx {
  common: FxCommon;
  color: string;
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  /** spread (sombra projetada) ou choke (sombra interna), 0..1 */
  spread: number;
  size: number;
  contour: ContourId;
  /** 0..1 */
  noise: number;
}

export interface GlowFx {
  common: FxCommon;
  paint: FxPaint;
  technique: "softer" | "precise";
  spread: number;
  size: number;
  contour: ContourId;
  range: number;
  noise: number;
  /** só brilho interno */
  source: "center" | "edge";
}

export interface StrokeFx {
  common: FxCommon;
  size: number;
  position: "outside" | "inside" | "center";
  paint: FxPaint;
}

export interface SatinFx {
  common: FxCommon;
  color: string;
  angle: number;
  distance: number;
  size: number;
  contour: ContourId;
  invert: boolean;
}

export interface BevelFx {
  enabled: boolean;
  style: "inner" | "outer" | "emboss" | "pillow";
  /** profundidade 0..10 (1 = 100%) */
  depth: number;
  up: boolean;
  size: number;
  soften: number;
  angle: number;
  altitude: number;
  useGlobalLight: boolean;
  highlight: { blend: BlendMode; opacity: number; color: string };
  shadow: { blend: BlendMode; opacity: number; color: string };
}

export interface LayerStyles {
  dropShadow?: ShadowFx;
  innerShadow?: ShadowFx;
  outerGlow?: GlowFx;
  innerGlow?: GlowFx;
  stroke?: StrokeFx;
  colorOverlay?: { common: FxCommon; color: string };
  gradientOverlay?: { common: FxCommon; gradient: GradientSpec };
  satin?: SatinFx;
  bevel?: BevelFx;
}

export type StyleKey = keyof LayerStyles;

export const STYLE_ORDER: StyleKey[] = ["bevel", "stroke", "innerShadow", "innerGlow", "satin", "colorOverlay", "gradientOverlay", "outerGlow", "dropShadow"];

export const STYLE_LABELS: Record<StyleKey, string> = {
  bevel: "Chanfro e relevo",
  stroke: "Traço",
  innerShadow: "Sombra interna",
  innerGlow: "Brilho interno",
  satin: "Cetim",
  colorOverlay: "Sobreposição de cor",
  gradientOverlay: "Sobreposição de degradê",
  outerGlow: "Brilho externo",
  dropShadow: "Sombra projetada",
};

export interface GlobalLight {
  angle: number;
  altitude: number;
}
export const DEFAULT_LIGHT: GlobalLight = { angle: 120, altitude: 30 };

const common = (blend: BlendMode, opacity: number): FxCommon => ({ enabled: true, blend, opacity });

export function defaultStyle<K extends StyleKey>(key: K): NonNullable<LayerStyles[K]> {
  const d: Required<LayerStyles> = {
    dropShadow: { common: common("multiply", 0.75), color: "#000000", angle: 120, useGlobalLight: true, distance: 5, spread: 0, size: 5, contour: "linear", noise: 0 },
    innerShadow: { common: common("multiply", 0.75), color: "#000000", angle: 120, useGlobalLight: true, distance: 5, spread: 0, size: 5, contour: "linear", noise: 0 },
    outerGlow: { common: common("screen", 0.75), paint: { kind: "color", color: "#ffffbe" }, technique: "softer", spread: 0, size: 5, contour: "linear", range: 0.5, noise: 0, source: "edge" },
    innerGlow: { common: common("screen", 0.75), paint: { kind: "color", color: "#ffffbe" }, technique: "softer", spread: 0, size: 5, contour: "linear", range: 0.5, noise: 0, source: "edge" },
    stroke: { common: common("normal", 1), size: 3, position: "outside", paint: { kind: "color", color: "#ff0000" } },
    colorOverlay: { common: common("normal", 1), color: "#ff0000" },
    gradientOverlay: {
      common: common("normal", 1),
      gradient: { stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }], opacityStops: [], style: "linear", angle: 90, scale: 1, reverse: false, offset: [0, 0] },
    },
    satin: { common: common("multiply", 0.5), color: "#000000", angle: 19, distance: 11, size: 14, contour: "linear", invert: true },
    bevel: {
      enabled: true, style: "inner", depth: 1, up: true, size: 5, soften: 0, angle: 120, altitude: 30, useGlobalLight: true,
      highlight: { blend: "screen", opacity: 0.75, color: "#ffffff" },
      shadow: { blend: "multiply", opacity: 0.75, color: "#000000" },
    },
  };
  return structuredClone(d[key]) as NonNullable<LayerStyles[K]>;
}

export function styleEnabled(styles: LayerStyles | undefined, key: StyleKey): boolean {
  const s = styles?.[key] as { common?: FxCommon; enabled?: boolean } | undefined;
  if (!s) return false;
  return key === "bevel" ? !!s.enabled : !!s.common?.enabled;
}

export function hasStyles(styles: LayerStyles | undefined): boolean {
  return !!styles && STYLE_ORDER.some((k) => styleEnabled(styles, k));
}

/** Pixels que um efeito pode alcançar além da forma. */
export function styleMargin(styles: LayerStyles): number {
  let m = 0;
  const take = (v: number) => { if (Number.isFinite(v)) m = Math.max(m, v); };
  if (styleEnabled(styles, "dropShadow")) take(styles.dropShadow!.distance + styles.dropShadow!.size);
  if (styleEnabled(styles, "outerGlow")) take(styles.outerGlow!.size);
  if (styleEnabled(styles, "stroke")) take(styles.stroke!.size);
  if (styleEnabled(styles, "satin")) take(styles.satin!.distance + styles.satin!.size);
  if (styleEnabled(styles, "bevel")) take(styles.bevel!.size + styles.bevel!.soften);
  if (styleEnabled(styles, "innerShadow")) take(styles.innerShadow!.distance + styles.innerShadow!.size);
  return Math.min(512, Math.ceil(m)) + 2;
}

// ---------------------------------------------------------------------------------------------
// Mapas de cobertura
// ---------------------------------------------------------------------------------------------

interface MapT {
  w: number;
  h: number;
  v: Float32Array;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const newMap = (w: number, h: number, fill = 0): MapT => ({ w, h, v: new Float32Array(w * h).fill(fill) });
const cloneMap = (m: MapT): MapT => ({ w: m.w, h: m.h, v: new Float32Array(m.v) });
const mapFn = (m: MapT, f: (v: number) => number): MapT => {
  const o = newMap(m.w, m.h);
  for (let i = 0; i < m.v.length; i++) o.v[i] = f(m.v[i]);
  return o;
};

function shifted(m: MapT, dx: number, dy: number, fill: number): MapT {
  const o = newMap(m.w, m.h, fill);
  for (let y = 0; y < m.h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= m.h) continue;
    for (let x = 0; x < m.w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= m.w) continue;
      o.v[y * m.w + x] = m.v[sy * m.w + sx];
    }
  }
  return o;
}

/** Pesos de uma caixa centrada de largura fracionária `w`. */
function boxWeights(w: number): Float32Array {
  const bw = Number.isNaN(w) ? 1 : Math.min(512, Math.max(1, w));
  const half = bw / 2;
  const r = Math.max(0, Math.ceil(half - 0.5));
  const v: number[] = [];
  for (let i = -r; i <= r; i++) v.push(Math.max(0, Math.min(i + 0.5, half) - Math.max(i - 0.5, -half)));
  const sum = v.reduce((a, b) => a + b, 0);
  return Float32Array.from(v.map((x) => x / sum));
}

/** Kernel "tent": duas passadas de caixa de largura `w` (Photoshop borra assim). */
function tentKernel(w: number): Float32Array {
  const b = boxWeights(w);
  const t = new Float32Array(b.length * 2 - 1);
  for (let i = 0; i < b.length; i++) for (let j = 0; j < b.length; j++) t[i + j] += b[i] * b[j];
  return t;
}

/** Borra o mapa no lugar com o kernel tent de largura `size` (borda repetida). */
function tent(m: MapT, size: number): MapT {
  if (!Number.isFinite(size)) return m;
  const k = tentKernel(size);
  const r = (k.length - 1) >> 1;
  if (r === 0) return m;
  const { w, h } = m;
  const tmp = new Float32Array(m.v.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += m.v[row + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
      tmp[row + x] = s;
    }
  }
  const out = new Float32Array(m.v.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
      out[y * w + x] = s;
    }
  }
  return { w, h, v: out };
}

const INF = 1e12;

/** Transformada de distância euclidiana exata (Felzenszwalb): distância de cada pixel ao `inside` mais próximo. */
function edt(inside: Uint8Array, w: number, h: number): Float32Array {
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = inside[i] ? 0 : INF;
  const n = Math.max(w, h);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  const col = new Float32Array(n);
  const d = new Float32Array(n);
  const pass = (len: number, get: (i: number) => number, set: (i: number, val: number) => void) => {
    for (let i = 0; i < len; i++) col[i] = get(i);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (col[q] + q * q - (col[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (col[q] + q * q - (col[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + col[v[k]];
    }
    for (let i = 0; i < len; i++) set(i, d[i]);
  };
  for (let x = 0; x < w; x++) pass(h, (i) => f[i * w + x], (i, val) => { f[i * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, (i) => f[y * w + i], (i, val) => { f[y * w + i] = val; });
  for (let i = 0; i < f.length; i++) f[i] = Math.sqrt(f[i]);
  return f;
}

/** Distância de cada pixel de fora ao dentro (alfa ≥ 0.5) mais próximo; 0 dentro. */
function distOutside(a: MapT): Float32Array {
  const inside = new Uint8Array(a.v.length);
  for (let i = 0; i < inside.length; i++) inside[i] = a.v[i] >= 0.5 ? 1 : 0;
  return edt(inside, a.w, a.h);
}

/** Distância de cada pixel de dentro ao fora mais próximo; 0 fora. */
function distInside(a: MapT): Float32Array {
  const outside = new Uint8Array(a.v.length);
  for (let i = 0; i < outside.length; i++) outside[i] = a.v[i] < 0.5 ? 1 : 0;
  return edt(outside, a.w, a.h);
}

/** Cresce a forma `r` px (com antialias), mantendo a borda suave original. */
function dilate(s: MapT, r: number): MapT {
  if (r <= 0) return cloneMap(s);
  const d = distOutside(s);
  const out = cloneMap(s);
  for (let i = 0; i < out.v.length; i++) {
    out.v[i] = d[i] === 0 ? Math.max(out.v[i], 0) : Math.max(out.v[i], clamp01(r + 0.5 - d[i]));
    if (s.v[i] > 0 && s.v[i] < 0.5 && d[i] > 0) out.v[i] = Math.min(1, Math.max(out.v[i], s.v[i] + r));
  }
  return out;
}

const spreadSplit = (size: number, spread: number): [number, number] => [Math.round(size * spread), size * (1 - spread)];

const CONTOURS: Record<ContourId, ((t: number) => number) | null> = {
  linear: null,
  cone: (t) => (t < 0.5 ? 2 * t : 2 - 2 * t),
  "cone-inverted": (t) => (t < 0.5 ? 1 - 2 * t : 2 * t - 1),
  "half-round": (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))),
  gaussian: (t) => (Math.exp(-Math.pow((1 - t) * 2.2, 2)) - Math.exp(-4.84)) / (1 - Math.exp(-4.84)),
  ring: (t) => Math.abs(Math.sin(t * Math.PI * 2)),
  sawtooth: (t) => (t * 2) % 1,
  steps: (t) => Math.floor(t * 5) / 4,
};

const contourLut = (id: ContourId): Float32Array | null => {
  const f = CONTOURS[id];
  if (!f) return null;
  return Float32Array.from({ length: 1024 }, (_, i) => clamp01(f(i / 1023)));
};

const lutAt = (lut: Float32Array, v: number) => {
  const x = clamp01(v) * (lut.length - 1);
  const i = Math.floor(x);
  const j = Math.min(i + 1, lut.length - 1);
  return lut[i] + (lut[j] - lut[i]) * (x - i);
};

function applyContour(m: MapT, id: ContourId, range = 1): MapT {
  const base = contourLut(id);
  const rg = Number.isFinite(range) ? Math.min(1, Math.max(0.01, range)) : 1;
  if (!base && rg >= 0.999) return m;
  return mapFn(m, (v) => {
    const u = Math.min(1, v / rg);
    return base ? lutAt(base, u) : u;
  });
}

/** Contorno do cetim: o contorno lido pelo outro extremo, |c(1−v) − c(1)|. */
function satinContour(m: MapT, id: ContourId): MapT {
  const lut = contourLut(id);
  if (!lut) return m;
  const end = lut[lut.length - 1];
  return mapFn(m, (v) => Math.abs(lutAt(lut, 1 - v) - end));
}

function hashNoise(x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ 0x9e3779b9) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return (h & 0xffff) / 65536;
}

function applyNoise(m: MapT, amount: number, ox: number, oy: number) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      if (m.v[i] <= 0) continue;
      m.v[i] = clamp01(m.v[i] * (1 + (hashNoise(ox + x, oy + y) - 0.5) * 2 * amount));
    }
  }
}

const offsetOf = (angle: number, dist: number): [number, number] => {
  const a = (angle * Math.PI) / 180;
  return [Math.round(-Math.cos(a) * dist), Math.round(Math.sin(a) * dist)];
};

function shadowMap(A: MapT, s: ShadowFx, light: GlobalLight, inner: boolean, ox: number, oy: number): MapT {
  const angle = s.useGlobalLight ? light.angle : s.angle;
  const [dx, dy] = offsetOf(angle, s.distance);
  const src = inner ? mapFn(A, (a) => 1 - a) : A;
  let m = shifted(src, dx, dy, inner ? 1 : 0);
  const [r, bw] = spreadSplit(s.size, s.spread);
  m = dilate(m, r);
  m = tent(m, bw);
  m = applyContour(m, s.contour);
  applyNoise(m, s.noise, ox, oy);
  if (inner) for (let i = 0; i < m.v.length; i++) m.v[i] *= A.v[i];
  return m;
}

function glowMap(A: MapT, g: GlowFx, inner: boolean, ox: number, oy: number): MapT {
  const src = inner ? mapFn(A, (a) => 1 - a) : A;
  let m: MapT;
  if (g.technique === "precise") {
    const d = inner ? distInside(A) : distOutside(src);
    const solid = g.size * g.spread;
    const soft = Math.max(g.size + 1 - solid, 1e-3);
    m = newMap(A.w, A.h);
    for (let i = 0; i < m.v.length; i++) {
      const dd = d[i] + 0.5;
      m.v[i] = dd <= solid ? 1 : 0.5 * clamp01(1 - (dd - solid) / soft);
    }
  } else {
    const [r, bw] = spreadSplit(g.size, g.spread);
    m = tent(dilate(src, r), bw);
  }
  m = applyContour(m, g.contour, g.range);
  if (inner && g.source === "center") m = mapFn(m, (v) => 1 - v);
  applyNoise(m, g.noise, ox, oy);
  if (inner) for (let i = 0; i < m.v.length; i++) m.v[i] *= A.v[i];
  return m;
}

function satinMap(A: MapT, s: SatinFx): MapT {
  const [dx, dy] = offsetOf(s.angle, Math.max(s.distance, 1));
  const a = tent(shifted(A, dx, dy, 0), s.size);
  const b = tent(shifted(A, -dx, -dy, 0), s.size);
  let m = newMap(A.w, A.h);
  for (let i = 0; i < m.v.length; i++) m.v[i] = Math.abs(a.v[i] - b.v[i]);
  if (s.invert) m = mapFn(m, (v) => 1 - v);
  m = satinContour(m, s.contour);
  for (let i = 0; i < m.v.length; i++) m.v[i] *= A.v[i];
  return m;
}

/** Cobertura (0..1) de realce e sombra do chanfro; a região de cada uma depende do estilo. */
function bevelMaps(A: MapT, b: BevelFx, light: GlobalLight): { hi: MapT; sh: MapT } {
  const { w, h } = A;
  let H = tent(A, b.size);
  if (b.soften > 0) H = tent(H, b.soften);
  const angle = ((b.useGlobalLight ? light.angle : b.angle) * Math.PI) / 180;
  const alt = ((b.useGlobalLight ? light.altitude : b.altitude) * Math.PI) / 180;
  const Lx = Math.cos(angle) * Math.cos(alt);
  const Ly = -Math.sin(angle) * Math.cos(alt);
  const Lz = Math.sin(alt);
  const kk = b.depth * Math.max(b.size, 1);
  const hi = newMap(w, h);
  const sh = newMap(w, h);
  const at = (x: number, y: number) => H.v[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = A.v[i];
      // região onde o chanfro age
      let region: number;
      let sign = 1;
      if (b.style === "inner") region = a;
      else if (b.style === "outer") region = 1 - a;
      else if (b.style === "pillow") { region = 1; sign = a >= 0.5 ? 1 : -1; }
      else region = 1;
      if (region <= 0) continue;
      const gx = (at(x + 1, y) - at(x - 1, y)) / 2;
      const gy = (at(x, y + 1) - at(x, y - 1)) / 2;
      const nx = -gx * kk;
      const ny = -gy * kk;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      let shade = (nx * Lx + ny * Ly + Lz) * inv - Lz;
      if (!b.up) shade = -shade;
      shade *= sign;
      if (b.style === "outer") shade = -shade; // o degrau de fora desce, ao contrário do de dentro
      const g = clamp01(Math.abs(shade) * 2.5) * region;
      if (shade > 0) hi.v[i] = g;
      else sh.v[i] = g;
    }
  }
  return { hi, sh };
}

// ---------------------------------------------------------------------------------------------
// Composição por pixel (sem alocações)
// ---------------------------------------------------------------------------------------------

const SEPARABLE = new Set<BlendMode>([
  "normal", "dissolve", "darken", "multiply", "color-burn", "linear-burn", "lighten", "screen", "color-dodge", "linear-dodge", "overlay",
  "soft-light", "hard-light", "vivid-light", "linear-light", "pin-light", "hard-mix", "difference", "exclusion", "subtract", "divide",
  "reflect", "glow", "negation", "xor", "pdn-color-burn", "pdn-color-dodge",
]);

/**
 * Compõe (sr,sg,sb em 0..1; sa = cobertura×opacidade) sobre o pixel `i` de `d` (RGBA 8 bits, alfa direto).
 * `atop` mantém o alfa do fundo (efeitos internos); caso contrário é o "source over" geral.
 */
function put(d: Uint8ClampedArray, i: number, mode: BlendMode, sr: number, sg: number, sb: number, sa: number, atop = false) {
  if (sa <= 0) return;
  const ab = d[i + 3] / 255;
  const br = d[i] / 255, bg = d[i + 1] / 255, bb = d[i + 2] / 255;
  let mr: number, mg: number, mb: number;
  if (mode === "normal" || mode === "dissolve") { mr = sr; mg = sg; mb = sb; }
  else if (SEPARABLE.has(mode)) { mr = blendChannel(mode, br, sr); mg = blendChannel(mode, bg, sg); mb = blendChannel(mode, bb, sb); }
  else { const o = blendRgb(mode, [br, bg, bb], [sr, sg, sb]); mr = o[0]; mg = o[1]; mb = o[2]; }
  if (atop) {
    d[i] = Math.round(((1 - sa) * br + sa * mr) * 255);
    d[i + 1] = Math.round(((1 - sa) * bg + sa * mg) * 255);
    d[i + 2] = Math.round(((1 - sa) * bb + sa * mb) * 255);
    return;
  }
  const ao = sa + ab * (1 - sa);
  if (ao <= 0) return;
  d[i] = Math.round(((((1 - sa) * ab * br) + ((1 - ab) * sa * sr) + sa * ab * mr) / ao) * 255);
  d[i + 1] = Math.round(((((1 - sa) * ab * bg) + ((1 - ab) * sa * sg) + sa * ab * mg) / ao) * 255);
  d[i + 2] = Math.round(((((1 - sa) * ab * bb) + ((1 - ab) * sa * sb) + sa * ab * mb) / ao) * 255);
  d[i + 3] = Math.round(ao * 255);
}

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Cor por pixel de um FxPaint (cor sólida ou degradê no retângulo `b`). */
function paintColorAt(p: FxPaint, b: Bounds, w: number): (i: number, out: [number, number, number, number]) => void {
  if (p.kind === "color") {
    const [r, g, bl] = hex(p.color);
    return (_i, out) => { out[0] = r; out[1] = g; out[2] = bl; out[3] = 1; };
  }
  const prep = prepareGradient(p.gradient);
  return (i, out) => prep.sample(gradientT(p.gradient, b, (i % w) + 0.5, Math.floor(i / w) + 0.5), out);
}

/** Pinta `color × mapa` no buffer. */
function paintMap(d: Uint8ClampedArray, m: MapT, paint: FxPaint, bounds: Bounds, blend: BlendMode, opacity: number, atop = false) {
  const col = paintColorAt(paint, bounds, m.w);
  const c: [number, number, number, number] = [0, 0, 0, 1];
  for (let i = 0; i < m.v.length; i++) {
    const a = m.v[i] * opacity;
    if (a <= 0) continue;
    col(i, c);
    put(d, i * 4, blend, c[0], c[1], c[2], c[3] * a, atop);
  }
}

// ---------------------------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------------------------

export interface StyledParts {
  /** pixels entre a borda da região e a camada */
  margin: number;
  /** abaixo do conteúdo, de baixo para cima: sombra projetada, brilho externo, traço externo */
  beneath: { canvas: HTMLCanvasElement; blend: BlendMode }[];
  /** o conteúdo com os efeitos internos */
  content: HTMLCanvasElement;
}

function canvasFrom(d: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.putImageData(new ImageData(d, w, h), 0, 0);
  return c;
}

/** Renderiza os estilos de uma camada a partir dos pixels `src` (sem máscara). */
export function renderStyles(src: HTMLCanvasElement, styles: LayerStyles, light: GlobalLight): StyledParts {
  const m = styleMargin(styles);
  const w = src.width + m * 2;
  const h = src.height + m * 2;
  const ctx = document.createElement("canvas");
  ctx.width = w;
  ctx.height = h;
  const c2 = ctx.getContext("2d", { willReadFrequently: true })!;
  c2.drawImage(src, m, m);
  const content = c2.getImageData(0, 0, w, h).data;
  const A = newMap(w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = content[(y * w + x) * 4 + 3] / 255;
    A.v[y * w + x] = a;
    if (a > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const bounds: Bounds = maxX < 0 ? { x0: 0, y0: 0, x1: w, y1: h } : { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };

  const beneath: StyledParts["beneath"] = [];
  const addBeneath = (blend: BlendMode, draw: (d: Uint8ClampedArray) => void) => {
    const d = new Uint8ClampedArray(w * h * 4);
    draw(d);
    beneath.push({ canvas: canvasFrom(d, w, h), blend });
  };
  // As cores dos efeitos externos são pintadas sobre um buffer transparente no modo "normal":
  // o modo de mesclagem do efeito é aplicado depois, contra o fundo real (compositeOnto).
  const plain = (d: Uint8ClampedArray, m2: MapT, paint: FxPaint, opacity: number) => paintMap(d, m2, paint, bounds, "normal", opacity);

  if (styleEnabled(styles, "dropShadow")) {
    const s = styles.dropShadow!;
    addBeneath(s.common.blend, (d) => plain(d, shadowMap(A, s, light, false, 0, 0), { kind: "color", color: s.color }, s.common.opacity));
  }
  if (styleEnabled(styles, "outerGlow")) {
    const g = styles.outerGlow!;
    addBeneath(g.common.blend, (d) => plain(d, glowMap(A, g, false, 0, 0), g.paint, g.common.opacity));
  }
  const st = styleEnabled(styles, "stroke") ? styles.stroke! : null;
  if (st && st.position !== "inside") {
    const outW = st.position === "outside" ? st.size : st.size / 2;
    const dOut = distOutside(A);
    const cov = newMap(w, h);
    for (let i = 0; i < cov.v.length; i++) cov.v[i] = A.v[i] >= 0.5 ? 1 : clamp01(outW - dOut[i] + 1);
    addBeneath(st.common.blend, (d) => plain(d, cov, st.paint, st.common.opacity));
  }

  // ---- interior: o conteúdo ganha alfa 1 dentro da forma, recebe os efeitos e volta ao alfa original
  const lay = new Uint8ClampedArray(content);
  const inside = (a: number) => a > 1e-3;
  for (let i = 0; i < A.v.length; i++) lay[i * 4 + 3] = inside(A.v[i]) ? 255 : 0;
  const full = newMap(w, h);
  for (let i = 0; i < full.v.length; i++) full.v[i] = inside(A.v[i]) ? 1 : 0;
  const rel = (mp: MapT): MapT => {
    const o = newMap(w, h);
    for (let i = 0; i < o.v.length; i++) o.v[i] = inside(A.v[i]) ? Math.min(1, mp.v[i] / A.v[i]) : 0;
    return o;
  };

  if (styleEnabled(styles, "gradientOverlay")) {
    const g = styles.gradientOverlay!;
    paintMap(lay, full, { kind: "gradient", gradient: g.gradient }, bounds, g.common.blend, g.common.opacity);
  }
  if (styleEnabled(styles, "colorOverlay")) {
    const c = styles.colorOverlay!;
    paintMap(lay, full, { kind: "color", color: c.color }, bounds, c.common.blend, c.common.opacity);
  }
  if (styleEnabled(styles, "satin")) {
    const s = styles.satin!;
    paintMap(lay, rel(satinMap(A, s)), { kind: "color", color: s.color }, bounds, s.common.blend, s.common.opacity);
  }
  if (styleEnabled(styles, "innerGlow")) {
    const g = styles.innerGlow!;
    paintMap(lay, rel(glowMap(A, g, true, 0, 0)), g.paint, bounds, g.common.blend, g.common.opacity);
  }
  if (styleEnabled(styles, "innerShadow")) {
    const s = styles.innerShadow!;
    paintMap(lay, rel(shadowMap(A, s, light, true, 0, 0)), { kind: "color", color: s.color }, bounds, s.common.blend, s.common.opacity);
  }
  if (st && st.position !== "center" ? st.position === "inside" : !!st) {
    // traço interno (e a metade interna do traço centralizado)
    const inW = st!.position === "inside" ? st!.size : st!.size / 2;
    const dIn = distInside(A);
    const cov = newMap(w, h);
    for (let i = 0; i < cov.v.length; i++) cov.v[i] = inside(A.v[i]) ? clamp01(inW - dIn[i] + 1) : 0;
    paintMap(lay, cov, st!.paint, bounds, st!.common.blend, st!.common.opacity);
  }
  if (styleEnabled(styles, "bevel")) {
    const b = styles.bevel!;
    const { hi, sh } = bevelMaps(A, b, light);
    paintMap(lay, hi, { kind: "color", color: b.highlight.color }, bounds, b.highlight.blend, b.highlight.opacity);
    paintMap(lay, sh, { kind: "color", color: b.shadow.color }, bounds, b.shadow.blend, b.shadow.opacity);
  }
  // o alfa volta a ser o da forma (efeitos externos ao chanfro mantêm o alfa que ganharam)
  for (let i = 0; i < A.v.length; i++) {
    if (inside(A.v[i])) lay[i * 4 + 3] = Math.round(A.v[i] * 255 * (lay[i * 4 + 3] / 255));
  }
  return { margin: m, beneath, content: canvasFrom(lay, w, h) };
}
