/**
 * Utilitários de cor: parse de hex/rgb/oklch, luminância e remapeamento de luminosidade em OKLab.
 *
 * Classifica o fundo dos modelos de slide (claro / escuro / cor da marca) e gera a variante clara ou escura
 * de um modelo mantendo a matiz e o croma originais da marca.
 */

export type RGB = [number, number, number]; // 0..255
export type RGBA = [number, number, number, number];

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/i;
const OKLCH_RE = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.%]+))?\s*\)$/i;

export const COLOR_TOKEN_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)/gi;

const srgbToLinear = (c: number) => {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const linearToSrgb = (c: number) => {
  c = Math.max(0, Math.min(1, c));
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, v * 255));
};

export function oklabToRgb(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)];
}

export function rgbToOklab(rgb: RGB): [number, number, number] {
  const [r, g, b] = rgb.map(srgbToLinear);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  return raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
}

/** Converte '#hex', 'rgb()', 'oklch()' ou nomes básicos em [r, g, b, alpha]. null se não reconhecer. */
export function parseColor(value: string | null | undefined): RGBA | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "white" || v === "#fff") return [255, 255, 255, 1];
  if (v === "black") return [0, 0, 0, 1];
  if (v === "transparent") return [0, 0, 0, 0];

  let m = HEX_RE.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((ch) => ch + ch).join("");
    if (h.length === 6) h += "ff";
    if (h.length !== 8) return null;
    const [r, g, b, a] = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
    return [r, g, b, a / 255];
  }

  m = RGB_RE.exec(v);
  if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseAlpha(m[4])];

  m = OKLCH_RE.exec(v);
  if (m) {
    let L = parseFloat(m[1]);
    if (m[2] === "%" || L > 1) L = L / 100;
    const C = parseFloat(m[3]);
    const rad = (parseFloat(m[4]) * Math.PI) / 180;
    const [r, g, b] = oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
    return [r, g, b, parseAlpha(m[5])];
  }
  return null;
}

export function toHex(rgb: RGB): string {
  const [r, g, b] = rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const oklabLightness = (rgb: RGB) => rgbToOklab(rgb)[0];

export function chroma(rgb: RGB): number {
  const [, a, b] = rgbToOklab(rgb);
  return Math.hypot(a, b);
}

export const colorDistance = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Mantém matiz e croma (OKLab) e troca só a luminosidade. */
export function withLightness(rgb: RGB, newL: number): RGB {
  const [, a, b] = rgbToOklab(rgb);
  return oklabToRgb(Math.max(0, Math.min(1, newL)), a, b);
}

export type BackgroundKind = "dark" | "light" | "primary";

/** Classifica um fundo em 'dark', 'light' ou 'primary' (cor de destaque da marca). */
export function classifyBackground(value: string | null | undefined, primary?: string | null): BackgroundKind | null {
  const parsed = parseColor(value);
  if (!parsed || parsed[3] < 0.5) return null;
  const rgb: RGB = [parsed[0], parsed[1], parsed[2]];
  if (primary) {
    const p = parseColor(primary);
    if (p && colorDistance(rgb, [p[0], p[1], p[2]]) < 60) return "primary";
  }
  const lum = relativeLuminance(rgb);
  const c = chroma(rgb);
  if (c < 0.06 || c < 0.09) return lum < 0.35 ? "dark" : "light";
  if (lum > 0.75) return "light";
  if (lum < 0.05) return "dark";
  return "primary";
}
