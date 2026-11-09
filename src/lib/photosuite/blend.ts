/**
 * Port fiel de crates/color/src/blend.rs do PhotoCraft (referência CPU escalar).
 * Cores em 0..1 com alfa direto (não pré-multiplicado).
 */
import type { BlendMode } from "./types";

type RGB = [number, number, number];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function colorBurn(cb: number, cs: number) {
  if (cb >= 1) return 1;
  if (cs <= 0) return 0;
  return 1 - Math.min((1 - cb) / cs, 1);
}

function colorDodge(cb: number, cs: number) {
  if (cb <= 0) return 0;
  if (cs >= 1) return 1;
  return Math.min(cb / (1 - cs), 1);
}

function hardLight(cb: number, cs: number) {
  if (cs <= 0.5) return cb * 2 * cs;
  const s = 2 * cs - 1;
  return cb + s - cb * s;
}

/** Soft Light do Photoshop: curva W3C com D(cb) cúbico abaixo de 0.25. */
function softLightPs(cb: number, cs: number) {
  if (cs <= 0.5) return 2 * cb * cs + cb * cb * (1 - 2 * cs);
  const b = Math.max(cb, 0);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return 2 * cb * (1 - cs) + d * (2 * cs - 1);
}

function vividLightHardMix(cb: number, cs: number) {
  const EDGE = 1e-4;
  if (cs <= 0.5) {
    if (cb >= 1 - EDGE) return 1;
    if (cs <= 0) return 0;
    return 1 - Math.min((1 - cb) / (2 * cs), 1);
  }
  if (cb <= EDGE) return 0;
  if (cs >= 1) return 1;
  return Math.min(cb / (2 * (1 - cs)), 1);
}

function reflect(cb: number, cs: number) {
  return cs >= 1 ? 1 : Math.min((cb * cb) / (1 - cs), 1);
}

/** Função de mistura por canal B(cb, cs). */
export function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case "normal":
    case "dissolve":
    case "pass-through":
      return cs;
    case "darken": return Math.min(cb, cs);
    case "multiply": return cb * cs;
    case "color-burn": return colorBurn(cb, cs);
    case "linear-burn": return Math.max(cb + cs - 1, 0);
    case "lighten": return Math.max(cb, cs);
    case "screen": return cb + cs - cb * cs;
    case "color-dodge": return colorDodge(cb, cs);
    case "linear-dodge": return Math.min(cb + cs, 1);
    case "overlay": return hardLight(cs, cb);
    case "soft-light": return softLightPs(cb, cs);
    case "hard-light": return hardLight(cb, cs);
    case "vivid-light":
      if (cs <= 0) return 0;
      if (cs >= 1) return 1;
      return cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * (cs - 0.5));
    case "linear-light": return clamp01(cb + 2 * cs - 1);
    case "pin-light": return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case "hard-mix": return vividLightHardMix(cb, cs) >= 0.5 - 1e-6 ? 1 : 0;
    case "difference": return Math.abs(cb - cs);
    case "exclusion": return cb + cs - 2 * cb * cs;
    case "subtract": return Math.max(cb - cs, 0);
    case "divide":
      if (cs <= 0) return cb <= 0 ? 0 : 1;
      return Math.min(cb / cs, 1);
    case "reflect": return reflect(cb, cs);
    case "glow": return reflect(cs, cb);
    case "negation": return 1 - Math.abs(1 - cb - cs);
    case "xor": {
      // O XOR do Paint.NET é definido em canais de 8 bits.
      const b = Math.round(clamp01(cb) * 255);
      const s = Math.round(clamp01(cs) * 255);
      return (b ^ s) / 255;
    }
    case "pdn-color-burn": return cs <= 0 ? 0 : Math.max(1 - (1 - cb) / cs, 0);
    case "pdn-color-dodge": return cs >= 1 ? 1 : Math.min(cb / (1 - cs), 1);
    // Não separáveis: tratados em blendRgb.
    default: return cs;
  }
}

// ---- auxiliares não separáveis (W3C Compositing Level 1) ----

export const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/** ClipColor: aproxima `c` do seu cinza até todos os canais ficarem em 0..top, mantendo a luminosidade. */
function clipColor(c: RGB, top: number): RGB {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  const out: RGB = [c[0], c[1], c[2]];
  if (n < 0) {
    const d = l - n;
    for (let i = 0; i < 3; i++) out[i] = l > 0 && d > 0 ? l + ((out[i] - l) * l) / d : l;
  }
  if (x > top) {
    const d = x - l;
    for (let i = 0; i < 3; i++) out[i] = l < top && d > 0 ? l + ((out[i] - l) * (top - l)) / d : l;
  }
  return out;
}

export function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d], 1);
}

const sat = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c: RGB, s: number): RGB {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [imin, imid, imax] = idx;
  const out: RGB = [0, 0, 0];
  if (c[imax] > c[imin]) {
    out[imid] = ((c[imid] - c[imin]) * s) / (c[imax] - c[imin]);
    out[imax] = s;
  }
  out[imin] = 0;
  return out;
}

export function blendRgb(mode: BlendMode, cb: RGB, cs: RGB): RGB {
  switch (mode) {
    case "hue": return setLum(setSat(cs, sat(cb)), lum(cb));
    case "saturation": return setLum(setSat(cb, sat(cs)), lum(cb));
    case "color": return setLum(cs, lum(cb));
    case "luminosity": return setLum(cb, lum(cs));
    case "darker-color": return lum(cs) < lum(cb) ? cs : cb;
    case "lighter-color": return lum(cs) > lum(cb) ? cs : cb;
    default: return [blendChannel(mode, cb[0], cs[0]), blendChannel(mode, cb[1], cs[1]), blendChannel(mode, cb[2], cs[2])];
  }
}

/**
 * Compõe um pixel de origem (alfa direto) sobre um fundo (alfa direto) — fórmula geral W3C/PDF:
 * αo = αs + αb(1−αs);  αo·Co = (1−αs)·αb·Cb + (1−αb)·αs·Cs + αs·αb·B(Cb,Cs)
 */
export function compositePixel(
  mode: BlendMode,
  backdrop: [number, number, number, number],
  source: [number, number, number, number],
  opacity: number,
): [number, number, number, number] {
  const ab = backdrop[3];
  const as = source[3] * opacity;
  if (as <= 0) return backdrop;
  const cb: RGB = [backdrop[0], backdrop[1], backdrop[2]];
  const cs: RGB = [source[0], source[1], source[2]];
  const b = blendRgb(mode, cb, cs);
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const out: [number, number, number, number] = [0, 0, 0, ao];
  for (let i = 0; i < 3; i++) {
    out[i] = ((1 - as) * ab * cb[i] + (1 - ab) * as * cs[i] + as * ab * b[i]) / ao;
  }
  return out;
}

/** Modos cuja fórmula coincide com o `globalCompositeOperation` nativo do canvas (caminho rápido). */
export const NATIVE_BLEND: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: "source-over",
  darken: "darken",
  multiply: "multiply",
  "color-burn": "color-burn",
  lighten: "lighten",
  screen: "screen",
  "color-dodge": "color-dodge",
  overlay: "overlay",
  "hard-light": "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};
