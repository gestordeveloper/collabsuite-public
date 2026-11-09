/**
 * Ajustes de cor — port das fórmulas de crates/compose/src/adjust.rs do PhotoCraft para documentos
 * RGB de 8 bits em sRGB (o caso do Photosuite). Os que dependem só de cada canal viram tabelas de
 * 256 entradas; os demais rodam por pixel. Cores em 0..1 dentro das fórmulas.
 */
import { lum, setLum } from "./blend";

export interface LevelsChannel {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}
export interface CurvePoint {
  x: number;
  y: number;
}
export interface HueRange {
  hue: number;
  saturation: number;
  lightness: number;
  /** graus onde a faixa começa a entrar, fica cheia, começa a sair e termina */
  bounds: [number, number, number, number];
}
export interface GradientStop {
  pos: number;
  color: [number, number, number];
}

export type Adjustment =
  | { kind: "brightness-contrast"; brightness: number; contrast: number; legacy: boolean }
  | { kind: "levels"; master: LevelsChannel; channels: [LevelsChannel, LevelsChannel, LevelsChannel] }
  | { kind: "curves"; master: CurvePoint[]; channels: [CurvePoint[], CurvePoint[], CurvePoint[]] }
  | { kind: "exposure"; exposure: number; offset: number; gamma: number }
  | { kind: "vibrance"; vibrance: number; saturation: number }
  | { kind: "hue-saturation"; hue: number; saturation: number; lightness: number; colorize: boolean; ranges: HueRange[] }
  | { kind: "color-balance"; shadows: [number, number, number]; midtones: [number, number, number]; highlights: [number, number, number]; preserveLuminosity: boolean }
  | { kind: "black-white"; weights: number[]; tint: [number, number, number] | null }
  | { kind: "photo-filter"; color: [number, number, number]; density: number; preserveLuminosity: boolean }
  | { kind: "channel-mixer"; matrix: number[][]; monochrome: boolean }
  | { kind: "invert" }
  | { kind: "posterize"; levels: number }
  | { kind: "threshold"; level: number }
  | { kind: "gradient-map"; stops: GradientStop[]; reverse: boolean }
  | { kind: "selective-color"; relative: boolean; adjustments: number[][] };

export type AdjustmentKind = Adjustment["kind"];

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  "brightness-contrast": "Brilho/Contraste",
  levels: "Níveis",
  curves: "Curvas",
  exposure: "Exposição",
  vibrance: "Vibração",
  "hue-saturation": "Matiz/Saturação",
  "color-balance": "Equilíbrio de cores",
  "black-white": "Preto e branco",
  "photo-filter": "Filtro fotográfico",
  "channel-mixer": "Mixer de canais",
  invert: "Inverter",
  posterize: "Posterizar",
  threshold: "Limiar",
  "gradient-map": "Mapa de degradê",
  "selective-color": "Cor seletiva",
};

export const ADJUSTMENT_ORDER: AdjustmentKind[] = [
  "brightness-contrast", "levels", "curves", "exposure", "vibrance", "hue-saturation", "color-balance", "black-white",
  "photo-filter", "channel-mixer", "selective-color", "gradient-map", "invert", "posterize", "threshold",
];

export const defaultLevels = (): LevelsChannel => ({ inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 });
export const identityCurve = (): CurvePoint[] => [{ x: 0, y: 0 }, { x: 1, y: 1 }];

/** Faixa neutra `i` (0 = vermelhos … 5 = magentas) com a extensão padrão do Photoshop. */
export function neutralRange(i: number): HueRange {
  const c = 60 * i;
  return { hue: 0, saturation: 0, lightness: 0, bounds: [c - 45, c - 15, c + 15, c + 45] };
}

export function defaultAdjustment(kind: AdjustmentKind): Adjustment {
  switch (kind) {
    case "brightness-contrast": return { kind, brightness: 0, contrast: 0, legacy: false };
    case "levels": return { kind, master: defaultLevels(), channels: [defaultLevels(), defaultLevels(), defaultLevels()] };
    case "curves": return { kind, master: identityCurve(), channels: [identityCurve(), identityCurve(), identityCurve()] };
    case "exposure": return { kind, exposure: 0, offset: 0, gamma: 1 };
    case "vibrance": return { kind, vibrance: 0, saturation: 0 };
    case "hue-saturation": return { kind, hue: 0, saturation: 0, lightness: 0, colorize: false, ranges: [0, 1, 2, 3, 4, 5].map(neutralRange) };
    case "color-balance": return { kind, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true };
    case "black-white": return { kind, weights: [40, 60, 40, 60, 20, 80], tint: null };
    case "photo-filter": return { kind, color: [236 / 255, 138 / 255, 0], density: 0.25, preserveLuminosity: true };
    case "channel-mixer": return { kind, matrix: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]], monochrome: false };
    case "invert": return { kind };
    case "posterize": return { kind, levels: 4 };
    case "threshold": return { kind, level: 128 / 255 };
    case "gradient-map": return { kind, stops: [{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [1, 1, 1] }], reverse: false };
    case "selective-color": return { kind, relative: true, adjustments: Array.from({ length: 9 }, () => [0, 0, 0, 0]) };
  }
}

// ---------------------------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------------------------

const LUT_SIZE = 4096;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const remEuclid = (x: number, m: number) => ((x % m) + m) % m;

/** Amostra uma tabela (0..1) com interpolação linear. */
function sampleLut(table: ArrayLike<number>, v: number): number {
  const x = clamp01(v) * (table.length - 1);
  const i = Math.floor(x);
  const j = Math.min(i + 1, table.length - 1);
  const f = x - i;
  return table[i] * (1 - f) + table[j] * f;
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

type Vec3 = [number, number, number];

function rgbToHsl(r: number, g: number, b: number, out: Vec3) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (Math.abs(max - min) < 1e-7) {
    out[0] = 0; out[1] = 0; out[2] = l;
    return;
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = remEuclid((g - b) / d, 6);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  out[0] = h / 6; out[1] = s; out[2] = l;
}

function hueRgb(h: number, p: number, q: number, out: Vec3) {
  const f = (t0: number) => {
    const t = remEuclid(t0, 1);
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  out[0] = f(h + 1 / 3); out[1] = f(h); out[2] = f(h - 1 / 3);
}

function hslToRgb(h: number, s: number, l: number, out: Vec3) {
  if (s <= 0) {
    out[0] = out[1] = out[2] = l;
    return;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  hueRgb(h, 2 * l - q, q, out);
}

// ---------------------------------------------------------------------------------------------
// Níveis, curvas, brilho/contraste, exposição, posterizar (por canal → tabelas de 256)
// ---------------------------------------------------------------------------------------------

/** Gama de Níveis: u^(1/g), com "toe" a·u − b·u^q acima de 1 (ajuste medido no Photoshop). */
function levelsGamma(u: number, g: number): number {
  const c = 1 / g;
  if (g <= 1) return Math.pow(u, c);
  const a = Math.pow(2, g);
  const q = 2.2;
  const u1 = Math.pow((1 - c / q) / (a * (1 - 1 / q)), 1 / (1 - c));
  if (u >= u1 || u1 <= 0) return Math.pow(u, c);
  const b = (a * u1 - Math.pow(u1, c)) / Math.pow(u1, q);
  if (!Number.isFinite(b)) return Math.pow(u, c);
  return a * u - b * Math.pow(u, q);
}

/** Níveis de um canal em amostras de 8 bits: cada etapa é arredondada para um nível inteiro. */
function levelsQ(ch: LevelsChannel, v: number, quantum = 255): number {
  const range = Math.max(ch.inWhite - ch.inBlack, 1e-6);
  const whole = (x: number) => Math.floor(x * quantum + 0.5) / quantum;
  const vq = Math.round(v * quantum) / quantum;
  const u = Math.floor(clamp01((vq - ch.inBlack) / range) * quantum + 0.5 + 1e-3) / quantum;
  const t = whole(levelsGamma(u, Math.max(ch.gamma, 0.01)));
  return whole(ch.outBlack + t * (ch.outWhite - ch.outBlack));
}

/** Spline natural cúbica por 4096 amostras — a "curve_lut" do PhotoCraft. */
export function curveLut(points: CurvePoint[]): Float32Array {
  const pts = points.map((p) => [p.x, p.y] as [number, number]).sort((a, b) => a[0] - b[0]);
  for (let i = pts.length - 1; i > 0; i--) if (Math.abs(pts[i][0] - pts[i - 1][0]) < 1e-6) pts.splice(i, 1);
  const out = new Float32Array(LUT_SIZE);
  if (pts.length < 2) {
    for (let i = 0; i < LUT_SIZE; i++) out[i] = i / (LUT_SIZE - 1);
    return out;
  }
  const n = pts.length;
  const m2 = new Float64Array(n);
  if (n > 2) {
    const c = new Float64Array(n);
    const d = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      const h0 = pts[i][0] - pts[i - 1][0];
      const h1 = pts[i + 1][0] - pts[i][0];
      const a = h0 / 6;
      const b = (h0 + h1) / 3;
      const cc = h1 / 6;
      const r = (pts[i + 1][1] - pts[i][1]) / h1 - (pts[i][1] - pts[i - 1][1]) / h0;
      const denom = b - a * c[i - 1];
      c[i] = cc / denom;
      d[i] = (r - a * d[i - 1]) / denom;
    }
    for (let i = n - 2; i >= 1; i--) m2[i] = d[i] - c[i] * m2[i + 1];
  }
  for (let k = 0; k < LUT_SIZE; k++) {
    const xv = k / (LUT_SIZE - 1);
    if (xv <= pts[0][0]) { out[k] = clamp01(pts[0][1]); continue; }
    if (xv >= pts[n - 1][0]) { out[k] = clamp01(pts[n - 1][1]); continue; }
    let i = n - 2;
    for (let j = 0; j < n - 1; j++) if (xv <= pts[j + 1][0]) { i = j; break; }
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = x1 - x0;
    const a = (x1 - xv) / h;
    const b = (xv - x0) / h;
    out[k] = clamp01(a * y0 + b * y1 + (((a * a * a - a) * m2[i] + (b * b * b - b) * m2[i + 1]) * h * h) / 6);
  }
  return out;
}

const BRIGHTNESS_KNEE = 126 / 255;

/** Curva de brilho "moderna" (Photoshop CS3+): linha até um joelho e roll-off de Hermite até (1,1). */
function brightnessRaised(b: number) {
  const s = Math.pow(1.375, b / 50);
  const e = 1 / (1 + 0.084 * b);
  const x0 = Math.min(BRIGHTNESS_KNEE / s, 1);
  const secant = (1 - BRIGHTNESS_KNEE) / Math.max(1 - x0, 1e-6);
  const alpha = s / secant;
  const beta = e / secant;
  const hermite = alpha * alpha + beta * beta <= 9;
  return (x: number) => {
    const y0 = BRIGHTNESS_KNEE;
    if (x <= x0) return Math.min(y0, s * x);
    const h = Math.max(1 - x0, 1e-6);
    const t = clamp01((x - x0) / h);
    let y: number;
    if (hermite) {
      const t2 = t * t;
      const t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * s + (-2 * t3 + 3 * t2) + (t3 - t2) * h * e;
    } else {
      y = 1 - (1 - y0) * Math.pow(1 - t, alpha);
    }
    return clamp01(y);
  };
}

/** Contraste "moderno": S-curve de Hermite simétrica em torno de 0.5. */
function modernContrast(v: number, contrast: number): number {
  if (contrast === 0) return v;
  const k = contrast / 128;
  const end = 1 - k;
  const mid = 1 + k;
  const half = (t: number) => end * 0.5 * (t * t * t - 2 * t * t + t) + (-2 * t * t * t + 3 * t * t) * 0.5 + mid * 0.5 * (t * t * t - t * t);
  const x = clamp01(v);
  return x <= 0.5 ? half(x / 0.5) : 1 - half((1 - x) / 0.5);
}

function modernBrightnessContrastLut(brightness: number, contrast: number): Float32Array {
  const step = (k: number, n: number) => k / (n - 1);
  let bright: Float32Array;
  if (!brightness || !Number.isFinite(brightness)) {
    bright = Float32Array.from({ length: LUT_SIZE }, (_, k) => step(k, LUT_SIZE));
  } else if (brightness > 0) {
    const raised = brightnessRaised(brightness);
    bright = Float32Array.from({ length: LUT_SIZE }, (_, k) => raised(step(k, LUT_SIZE)));
  } else {
    // Reduzir = inverter a curva elevada, amostrada 4× mais fina, numa passada monótona.
    const raised = brightnessRaised(-brightness);
    const fine = 4 * LUT_SIZE;
    const ys = Float32Array.from({ length: fine }, (_, j) => raised(step(j, fine)));
    bright = new Float32Array(LUT_SIZE);
    let j = 0;
    for (let k = 0; k < LUT_SIZE; k++) {
      const y = step(k, LUT_SIZE);
      while (j + 2 < fine && ys[j + 1] < y) j++;
      const y0 = ys[j];
      const y1 = ys[j + 1];
      const f = y1 > y0 ? clamp01((y - y0) / (y1 - y0)) : 0;
      bright[k] = clamp01(step(j, fine) + f / (fine - 1));
    }
  }
  return bright.map((b) => clamp01(modernContrast(b, contrast)));
}

function legacyBrightnessContrast(brightness: number, contrast: number): (v: number) => number {
  const pivot = 128 / 255;
  const b = brightness / 255;
  const c = Math.min(99, Math.max(-100, contrast));
  const k = c >= 0 ? 1 / (1 - c / 100) : 1 + c / 100;
  const [pre, post] = c >= 0 ? [b, 0] : [0, b];
  return (v) => clamp01((v + pre - pivot) * k + pivot + post);
}

/** Posterizar do Photoshop: `n` faixas iguais em 0..255, saídas floor(k·255/(n−1)). */
function posterize(v: number, levels: number): number {
  const n = Math.min(255, Math.max(2, levels));
  const x = Math.round(clamp01(v) * 255);
  const bin = Math.min(Math.floor((x * n) / 256), n - 1);
  return Math.floor((bin * 255) / (n - 1)) / 255;
}

// ---------------------------------------------------------------------------------------------
// Equilíbrio de cores
// ---------------------------------------------------------------------------------------------

function balanceCurve(tones: [Vec3, Vec3, Vec3], preserve: boolean, ch: number): (v: number) => number {
  const [shadows, midtones, highlights] = tones.map((t) => t.map((s) => (Number.isFinite(s) ? Math.min(100, Math.max(-100, s)) : 0))) as [number[], number[], number[]];
  const own = (t: number[]) => t[ch] ?? 0;
  const mx = (t: number[]) => Math.max(t[0], t[1], t[2]);
  const mn = (t: number[]) => Math.min(t[0], t[1], t[2]);
  let black: number, white: number, m: number;
  if (preserve) {
    black = mx(shadows) - own(shadows);
    white = own(highlights) - mn(highlights);
    m = own(midtones) - (mx(midtones) + mn(midtones)) / 2;
  } else {
    black = Math.max(-own(shadows), 0);
    white = Math.max(own(highlights), 0);
    m = own(midtones) + (own(shadows) + own(highlights)) / 2;
  }
  const gamma = Math.pow(2, m / 100);
  const e = 1 / Math.max(gamma, 0.01);
  let knee: { u0: number; s0: number; p: number; d: number } | null = null;
  if (gamma > 1) {
    const s0 = Math.pow(2, gamma);
    const u0 = Math.min(2 * Math.pow(s0, 1 / (e - 1)), 1);
    if (!Number.isNaN(u0) && u0 > 0) knee = { u0, s0, p: Math.pow(u0, e), d: e * Math.pow(u0, e - 1) };
  }
  const b = black / 255;
  const w = 1 - white / 255;
  return (v0) => {
    const v = Number.isFinite(v0) ? clamp01(v0) : 0;
    if (v >= w) return 1;
    if (v <= b) return 0;
    const u = (v - b) / (w - b);
    if (knee && u < knee.u0) {
      const t = u / knee.u0;
      const t2 = t * t;
      const t3 = t2 * t;
      return clamp01((t3 - 2 * t2 + t) * knee.u0 * knee.s0 + (3 * t2 - 2 * t3) * knee.p + (t3 - t2) * knee.u0 * knee.d);
    }
    return Math.pow(u, e);
  };
}

// ---------------------------------------------------------------------------------------------
// Matiz/Saturação
// ---------------------------------------------------------------------------------------------

function rangeWeight(r: HueRange, deg: number): number {
  const [a, b0, c0, d0] = r.bounds;
  const rel = (x: number) => (Number.isFinite(x) ? remEuclid(x - a, 360) : 0);
  const b = rel(b0);
  const c = Math.max(rel(c0), b);
  const d = Math.max(rel(d0), c);
  const h = rel(deg);
  if (h <= b) return b <= 0 ? 1 : h / b;
  if (h <= c) return 1;
  if (h <= d) return d <= c ? 1 : (d - h) / (d - c);
  return 0;
}

const isNeutralRange = (r: HueRange) => r.hue === 0 && r.saturation === 0 && r.lightness === 0;

function hueRangeTables(ranges: HueRange[]): [Float32Array, Float32Array, Float32Array] {
  const t: [Float32Array, Float32Array, Float32Array] = [new Float32Array(LUT_SIZE), new Float32Array(LUT_SIZE), new Float32Array(LUT_SIZE)];
  const active = ranges.filter((r) => !isNeutralRange(r));
  for (let k = 0; k < LUT_SIZE; k++) {
    const deg = (k / (LUT_SIZE - 1)) * 360;
    let h = 0, s = 0, l = 0;
    for (const r of active) {
      const w = rangeWeight(r, deg);
      h += w * r.hue;
      s += (w * r.saturation) / 100;
      l += (w * r.lightness) / 100;
    }
    t[0][k] = h; t[1][k] = s; t[2][k] = l;
  }
  return t;
}

// ---------------------------------------------------------------------------------------------
// Vibração
// ---------------------------------------------------------------------------------------------

const VIBRANCE_BOOST = [0.5001, 0.0887, 0.4374, 0.7573, -0.8113, 0.5154, 2.8026];

function vibranceSkin(h: number): number {
  if (h <= 30) return 1;
  if (h < 45) return (45 - h) / 15;
  if (h < 300) return 0;
  return (h - 300) / 60;
}

function hsvHue(r: number, g: number, b: number, mx: number, mn: number): number {
  const d = mx - mn;
  let h: number;
  if (mx === r) h = remEuclid((g - b) / d, 6);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}

/** Vibração (-1..1) sobre um pixel em luz linear. */
function vibranceLin(l: Vec3, v: number) {
  const mx = Math.max(l[0], l[1], l[2]);
  const mn = Math.min(l[0], l[1], l[2]);
  if (mx <= 0 || mx - mn <= 1e-9) return;
  const t = 1 - mn / mx;
  const shape = t * (1 - t) * (2 - t + t * t) * mx * Math.max(1 - mx, 0);
  let t2: number, v2: number;
  if (v < 0) {
    const a = -v;
    t2 = t * (1 - a / 4) * (1 - a + (a * t * (1 + t)) / 2);
    v2 = mx - a * shape;
  } else {
    const [c0, c1, p, q, r0, ra, rt] = VIBRANCE_BOOST;
    const w = vibranceSkin(hsvHue(l[0], l[1], l[2], mx, mn));
    const a = v * (1 - w) + 0.64 * Math.pow(v, 1.6) * w;
    const boost = (c0 * a + c1 * a * a) * Math.pow(t, p) * Math.pow(1 - t, q) * Math.exp((r0 + ra * a + rt * (1 - t)) * Math.max(1 - mx, 0));
    t2 = Math.min(t * (1 + boost), 1);
    v2 = mx + (v / 4) * shape;
  }
  const m2 = v2 * (1 - t2);
  const k = (v2 - m2) / (mx - mn);
  l[0] = m2 + (l[0] - mn) * k;
  l[1] = m2 + (l[1] - mn) * k;
  l[2] = m2 + (l[2] - mn) * k;
}

// ---------------------------------------------------------------------------------------------
// Preto e branco, filtro fotográfico, cor seletiva, degradê
// ---------------------------------------------------------------------------------------------

function blackWhiteGray(r: number, g: number, b: number, w: number[]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const mid = r + g + b - max - min;
  const primary = r >= g && r >= b ? 0 : g >= b ? 2 : 4;
  const secondary = b <= r && b <= g ? 1 : r <= g ? 3 : 5;
  return min + ((mid - min) * w[secondary]) / 100 + ((max - mid) * w[primary]) / 100;
}

const D50: Vec3 = [0.96422, 1, 0.82521];
const SRGB_TO_XYZ_D50 = [[0.436074, 0.385064, 0.14308], [0.222504, 0.716878, 0.060618], [0.013932, 0.097104, 0.714173]];
const XYZ_D50_TO_SRGB = [[3.133856, -1.616867, -0.490615], [-0.978768, 1.916142, 0.033454], [0.071945, -0.228991, 1.405243]];

function photoFilterMatrix(color: Vec3, density: number): number[][] {
  const d = Number.isFinite(density) ? clamp01(density) : 0;
  const lin = color.map((v) => srgbToLinear(clamp01(v)));
  const xyz = SRGB_TO_XYZ_D50.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
  const s = xyz.map((x, i) => 1 - d + (d * x) / D50[i]);
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => XYZ_D50_TO_SRGB[r].reduce((acc, _, k) => acc + XYZ_D50_TO_SRGB[r][k] * s[k] * SRGB_TO_XYZ_D50[k][c], 0)));
}

function selectiveWeights(r: number, g: number, b: number, out: number[]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const mid = r + g + b - max - min;
  const c = [r, g, b];
  const top = (i: number) => (c[i] >= max ? max - mid : 0);
  const bottom = (i: number) => (c[i] <= min ? mid - min : 0);
  out[0] = top(0); out[1] = bottom(2); out[2] = top(1); out[3] = bottom(0); out[4] = top(2); out[5] = bottom(1);
  out[6] = Math.max((min - 0.5) * 2, 0);
  out[7] = clamp01(1 - Math.abs(max - 0.5) - Math.abs(min - 0.5));
  out[8] = Math.max((0.5 - max) * 2, 0);
}

function gradientAt(stops: GradientStop[], t: number, out: Vec3) {
  if (stops.length === 0) { out[0] = out[1] = out[2] = t; return; }
  if (stops.length === 1 || t <= stops[0].pos) { out[0] = stops[0].color[0]; out[1] = stops[0].color[1]; out[2] = stops[0].color[2]; return; }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t <= b.pos) {
      const k = b.pos > a.pos ? (t - a.pos) / (b.pos - a.pos) : 0;
      for (let c = 0; c < 3; c++) out[c] = a.color[c] + (b.color[c] - a.color[c]) * k;
      return;
    }
  }
  const last = stops[stops.length - 1].color;
  out[0] = last[0]; out[1] = last[1]; out[2] = last[2];
}

// ---------------------------------------------------------------------------------------------
// Compilação: Adjustment → função aplicável a um ImageData
// ---------------------------------------------------------------------------------------------

type PixelFn = (r: number, g: number, b: number, out: Vec3) => void;

interface Compiled {
  /** tabelas de 256 por canal (R, G, B) — caminho rápido */
  lut?: [Uint8Array, Uint8Array, Uint8Array];
  px?: PixelFn;
  /** ajuste que não muda nada (nem precisa rodar) */
  identity?: boolean;
}

function lut256(fn: (v: number) => number): Uint8Array {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.round(clamp01(fn(i / 255)) * 255);
  return t;
}

function compile(adj: Adjustment): Compiled {
  switch (adj.kind) {
    case "invert": {
      const t = lut256((v) => 1 - v);
      return { lut: [t, t, t] };
    }
    case "posterize": {
      const t = lut256((v) => posterize(v, adj.levels));
      return { lut: [t, t, t] };
    }
    case "brightness-contrast": {
      if (adj.legacy) {
        const f = legacyBrightnessContrast(adj.brightness, adj.contrast);
        const t = lut256(f);
        return { lut: [t, t, t] };
      }
      if (!adj.brightness && !adj.contrast) return { identity: true };
      const table = modernBrightnessContrastLut(adj.brightness, adj.contrast);
      const t = lut256((v) => sampleLut(table, v));
      return { lut: [t, t, t] };
    }
    case "exposure": {
      if (!adj.exposure && !adj.offset && adj.gamma === 1) return { identity: true };
      const m = Math.pow(2, adj.exposure);
      const g = Math.max(adj.gamma, 0.01);
      // Em sRGB a exposição trabalha em gama 2.2 (Transfer::for_exposure)
      const t = lut256((v) => {
        let lin = Math.max(Math.pow(v, 2.2) * m + adj.offset, 0);
        if (g !== 1) lin = Math.pow(lin, 1 / g);
        return clamp01(Math.pow(lin, 1 / 2.2));
      });
      return { lut: [t, t, t] };
    }
    case "levels": {
      const row = (c: LevelsChannel) => {
        const table = new Float32Array(LUT_SIZE);
        for (let k = 0; k < LUT_SIZE; k++) table[k] = levelsQ(adj.master, levelsQ(c, k / (LUT_SIZE - 1)));
        return lut256((v) => sampleLut(table, v));
      };
      return { lut: [row(adj.channels[0]), row(adj.channels[1]), row(adj.channels[2])] };
    }
    case "curves": {
      const m = curveLut(adj.master);
      const row = (pts: CurvePoint[]) => {
        const c = curveLut(pts);
        return lut256((v) => sampleLut(m, sampleLut(c, v)));
      };
      return { lut: [row(adj.channels[0]), row(adj.channels[1]), row(adj.channels[2])] };
    }
    case "color-balance": {
      const tones: [Vec3, Vec3, Vec3] = [adj.shadows, adj.midtones, adj.highlights];
      const curves = [0, 1, 2].map((ch) => balanceCurve(tones, adj.preserveLuminosity, ch));
      return { lut: [lut256(curves[0]), lut256(curves[1]), lut256(curves[2])] };
    }
    case "threshold": {
      const t = Math.round(adj.level * 255);
      return {
        px: (r, g, b, o) => {
          const sum = 30 * Math.round(clamp01(r) * 255) + 59 * Math.round(clamp01(g) * 255) + 11 * Math.round(clamp01(b) * 255);
          const w = sum > 100 * t - 50 ? 1 : 0;
          o[0] = o[1] = o[2] = w;
        },
      };
    }
    case "channel-mixer": {
      const m = adj.matrix;
      const mix = (row: number[], r: number, g: number, b: number) => clamp01(row[0] * r + row[1] * g + row[2] * b + row[3]);
      return {
        px: (r, g, b, o) => {
          if (adj.monochrome) o[0] = o[1] = o[2] = mix(m[0], r, g, b);
          else { o[0] = mix(m[0], r, g, b); o[1] = mix(m[1], r, g, b); o[2] = mix(m[2], r, g, b); }
        },
      };
    }
    case "black-white": {
      return {
        px: (r, g, b, o) => {
          const gray = clamp01(blackWhiteGray(r, g, b, adj.weights));
          if (adj.tint) {
            const t = setLum(adj.tint, gray);
            o[0] = clamp01(t[0]); o[1] = clamp01(t[1]); o[2] = clamp01(t[2]);
          } else {
            o[0] = o[1] = o[2] = gray;
          }
        },
      };
    }
    case "photo-filter": {
      if (adj.density <= 0) return { identity: true };
      const M = photoFilterMatrix(adj.color, adj.density);
      return {
        px: (r, g, b, o) => {
          const l0 = srgbToLinear(r), l1 = srgbToLinear(g), l2 = srgbToLinear(b);
          let f: Vec3 = [
            linearToSrgb(M[0][0] * l0 + M[0][1] * l1 + M[0][2] * l2),
            linearToSrgb(M[1][0] * l0 + M[1][1] * l1 + M[1][2] * l2),
            linearToSrgb(M[2][0] * l0 + M[2][1] * l1 + M[2][2] * l2),
          ];
          if (adj.preserveLuminosity) f = setLum(f, lum([r, g, b]));
          o[0] = clamp01(f[0]); o[1] = clamp01(f[1]); o[2] = clamp01(f[2]);
        },
      };
    }
    case "vibrance": {
      const v = adj.vibrance / 100;
      const s = adj.saturation / 100;
      if (!v && !s) return { identity: true };
      const l: Vec3 = [0, 0, 0];
      return {
        px: (r, g, b, o) => {
          l[0] = srgbToLinear(r); l[1] = srgbToLinear(g); l[2] = srgbToLinear(b);
          if (v !== 0) vibranceLin(l, v);
          if (s !== 0) {
            const gr = 0.288 * l[0] + 0.712 * l[1];
            for (let i = 0; i < 3; i++) l[i] = clamp01(gr + (1 + s) * (l[i] - gr));
          }
          o[0] = linearToSrgb(clamp01(l[0])); o[1] = linearToSrgb(clamp01(l[1])); o[2] = linearToSrgb(clamp01(l[2]));
        },
      };
    }
    case "hue-saturation": {
      const useRanges = !adj.colorize && adj.ranges.some((r) => !isNeutralRange(r));
      const tables = useRanges ? hueRangeTables(adj.ranges) : null;
      const hsl: Vec3 = [0, 0, 0];
      const hsl2: Vec3 = [0, 0, 0];
      const lc: Vec3 = [0, 0, 0];
      const lightness = Math.min(1, Math.max(-1, adj.lightness / 100));
      const lighten = (v: number) => (lightness > 0 ? v + (1 - v) * lightness : v * (1 + lightness));
      return {
        px: (r, g, b, o) => {
          let dh = 0, ds = 0, dl = 0;
          if (tables) {
            rgbToHsl(r, g, b, hsl);
            dh = sampleLut(tables[0], hsl[0]);
            ds = sampleLut(tables[1], hsl[0]);
            dl = sampleLut(tables[2], hsl[0]);
          }
          const s = Math.min(1, Math.max(-1, adj.saturation / 100 + ds));
          const hue = adj.hue + dh;
          if (adj.colorize) {
            rgbToHsl(r, g, b, hsl);
            hslToRgb(remEuclid(hue, 360) / 360, Math.min(Math.abs(s), 1), lighten(hsl[2]), o);
          } else {
            lc[0] = lighten(r); lc[1] = lighten(g); lc[2] = lighten(b);
            rgbToHsl(lc[0], lc[1], lc[2], hsl2);
            const hh = remEuclid(hsl2[0] + hue / 360, 1);
            const ss = Math.min(1, Math.max(0, s > 0 ? hsl2[1] / Math.max(1 - s, 1 / 512) : hsl2[1] * (1 + s)));
            hslToRgb(hh, ss, hsl2[2], o);
          }
          if (dl !== 0) {
            // Luminosidade de faixa: aproxima do canal mais claro (ao subir) ou do mais escuro (ao descer)
            const k = Math.min(1, Math.max(-1, dl));
            const target = k > 0 ? Math.max(o[0], o[1], o[2]) : Math.min(o[0], o[1], o[2]);
            for (let i = 0; i < 3; i++) o[i] = o[i] + (target - o[i]) * Math.abs(k);
          }
        },
      };
    }
    case "selective-color": {
      const w = new Array<number>(9).fill(0);
      const delta: Vec3 = [0, 0, 0];
      const a = adj.adjustments.map((row) => row.map((v) => v / 100));
      return {
        px: (r, g, b, o) => {
          selectiveWeights(r, g, b, w);
          delta[0] = delta[1] = delta[2] = 0;
          const c = [r, g, b];
          for (let k = 0; k < 9; k++) {
            if (w[k] <= 0) continue;
            for (let i = 0; i < 3; i++) {
              const ink = 1 - c[i];
              let d = a[k][i] + a[k][3];
              if (adj.relative) d *= ink;
              else if (d > 0) d *= Math.min(1, 2 * (1 - ink));
              else d *= Math.min(1, 2 * ink);
              delta[i] += d * w[k];
            }
          }
          o[0] = clamp01(r - delta[0]); o[1] = clamp01(g - delta[1]); o[2] = clamp01(b - delta[2]);
        },
      };
    }
    case "gradient-map": {
      const stops = [...adj.stops].sort((x, y) => x.pos - y.pos);
      return {
        px: (r, g, b, o) => {
          let t = 0.3 * r + 0.59 * g + 0.11 * b;
          if (adj.reverse) t = 1 - t;
          gradientAt(stops, t, o);
        },
      };
    }
  }
}

/** Aplica o ajuste a `data` (RGBA 8 bits, alfa direto) no lugar. Pixels totalmente transparentes ficam como estão. */
export function applyAdjustment(adj: Adjustment, data: Uint8ClampedArray) {
  const c = compile(adj);
  if (c.identity) return;
  if (c.lut) {
    const [lr, lg, lb] = c.lut;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      data[i] = lr[data[i]];
      data[i + 1] = lg[data[i + 1]];
      data[i + 2] = lb[data[i + 2]];
    }
    return;
  }
  const px = c.px!;
  const o: Vec3 = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    px(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, o);
    data[i] = Math.round(clamp01(o[0]) * 255);
    data[i + 1] = Math.round(clamp01(o[1]) * 255);
    data[i + 2] = Math.round(clamp01(o[2]) * 255);
  }
}

/** O ajuste está no estado neutro (não altera a imagem)? */
export function isIdentityAdjustment(adj: Adjustment): boolean {
  return !!compile(adj).identity;
}
