/** Preenchimento por região (varinha/balde) e degradês. */

export interface Point {
  x: number;
  y: number;
}

/**
 * Cobertura 0/255 da região parecida com o pixel (sx, sy). Tolerância 0..255 é a diferença máxima por
 * canal (incluindo alfa) em relação à cor da semente. `contiguous`: só pixels conectados (4 vizinhos).
 */
export function floodMask(img: ImageData, sx: number, sy: number, tolerance: number, contiguous: boolean): Uint8Array | null {
  const { width: w, height: h, data } = img;
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const si = (sy * w + sx) * 4;
  const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2], a0 = data[si + 3];
  const match = (i: number) =>
    Math.abs(data[i] - r0) <= tolerance &&
    Math.abs(data[i + 1] - g0) <= tolerance &&
    Math.abs(data[i + 2] - b0) <= tolerance &&
    Math.abs(data[i + 3] - a0) <= tolerance;

  const mask = new Uint8Array(w * h);
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p * 4)) mask[p] = 255;
    return mask;
  }
  const stack = new Int32Array(w * h);
  let top = 0;
  stack[top++] = sy * w + sx;
  mask[sy * w + sx] = 255;
  while (top > 0) {
    const p = stack[--top];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0 && !mask[p - 1] && match((p - 1) * 4)) { mask[p - 1] = 255; stack[top++] = p - 1; }
    if (x < w - 1 && !mask[p + 1] && match((p + 1) * 4)) { mask[p + 1] = 255; stack[top++] = p + 1; }
    if (y > 0 && !mask[p - w] && match((p - w) * 4)) { mask[p - w] = 255; stack[top++] = p - w; }
    if (y < h - 1 && !mask[p + w] && match((p + w) * 4)) { mask[p + w] = 255; stack[top++] = p + w; }
  }
  return mask;
}

export type GradientType = "linear" | "radial" | "angle" | "reflected";

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Preenche `ctx` (w×h) com um degradê de `p0` a `p1`; `toTransparent` faz o fim sumir em vez de ir para `c1`. */
export function paintGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  type: GradientType,
  p0: Point,
  p1: Point,
  c0: string,
  c1: string,
  toTransparent: boolean,
) {
  const start = rgba(c0, 1);
  const end = toTransparent ? rgba(c0, 0) : rgba(c1, 1);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  let g: CanvasGradient;
  if (type === "radial") {
    g = ctx.createRadialGradient(p0.x, p0.y, 0, p0.x, p0.y, len);
    g.addColorStop(0, start);
    g.addColorStop(1, end);
  } else if (type === "angle") {
    g = ctx.createConicGradient(Math.atan2(dy, dx), p0.x, p0.y);
    g.addColorStop(0, start);
    g.addColorStop(1, end);
  } else if (type === "reflected") {
    g = ctx.createLinearGradient(p0.x - dx, p0.y - dy, p1.x, p1.y);
    g.addColorStop(0, end);
    g.addColorStop(0.5, start);
    g.addColorStop(1, end);
  } else {
    g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    g.addColorStop(0, start);
    g.addColorStop(1, end);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Converte um canvas colorido em máscara: alfa = luminosidade × alfa (para pintar degradês em máscaras). */
export function lumaToAlpha(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = Math.round(l * (d[i + 3] / 255) * 255);
  }
  ctx.putImageData(img, 0, 0);
}
