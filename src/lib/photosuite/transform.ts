/**
 * Transformação livre de uma camada: o conteúdo (w×h) é escalado por (sx, sy) em torno do centro,
 * girado por `rot` e levado para (cx, cy) em coordenadas do documento.
 */
import type { Point } from "./fill";

export interface TState {
  layerId: string;
  /** tamanho do conteúdo original */
  w: number;
  h: number;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  /** radianos */
  rot: number;
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: { id: HandleId; hx: -1 | 0 | 1; hy: -1 | 0 | 1 }[] = [
  { id: "nw", hx: -1, hy: -1 },
  { id: "n", hx: 0, hy: -1 },
  { id: "ne", hx: 1, hy: -1 },
  { id: "e", hx: 1, hy: 0 },
  { id: "se", hx: 1, hy: 1 },
  { id: "s", hx: 0, hy: 1 },
  { id: "sw", hx: -1, hy: 1 },
  { id: "w", hx: -1, hy: 0 },
];

const rotate = (v: Point, a: number): Point => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

/** Ponto do documento para um offset normalizado (-1..1) do retângulo transformado. */
export function pointAt(t: TState, hx: number, hy: number): Point {
  const v = rotate({ x: (hx * t.w * t.sx) / 2, y: (hy * t.h * t.sy) / 2 }, t.rot);
  return { x: t.cx + v.x, y: t.cy + v.y };
}

export function corners(t: TState): Point[] {
  return [pointAt(t, -1, -1), pointAt(t, 1, -1), pointAt(t, 1, 1), pointAt(t, -1, 1)];
}

export function bbox(t: TState) {
  const c = corners(t);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  // a tolerância absorve o ruído de ponto flutuante (girar 90° não pode ganhar 1px)
  const eps = 1e-6;
  const x = Math.floor(Math.min(...xs) + eps);
  const y = Math.floor(Math.min(...ys) + eps);
  return { x, y, w: Math.max(1, Math.ceil(Math.max(...xs) - eps) - x), h: Math.max(1, Math.ceil(Math.max(...ys) - eps) - y) };
}

/** Desenha `src` com a transformação `t`, deslocado de (-ox, -oy). */
export function drawTransformed(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, t: TState, ox = 0, oy = 0) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(t.cx - ox, t.cy - oy);
  ctx.rotate(t.rot);
  ctx.scale(t.sx, t.sy);
  ctx.drawImage(src, -t.w / 2, -t.h / 2);
  ctx.restore();
}

/** Arrasta uma alça mantendo a alça oposta (ou o centro, com Alt) fixa; Shift mantém a proporção. */
export function resizeByHandle(t: TState, hx: number, hy: number, p: Point, shift: boolean, alt: boolean): TState {
  const anchor = alt ? { x: t.cx, y: t.cy } : (() => {
    const v = rotate({ x: (hx * t.w * t.sx) / 2, y: (hy * t.h * t.sy) / 2 }, t.rot);
    return { x: t.cx - v.x, y: t.cy - v.y };
  })();
  const d = rotate({ x: p.x - anchor.x, y: p.y - anchor.y }, -t.rot);
  const k = alt ? 2 : 1; // com Alt a alça fica a meia largura do centro
  let sx = hx !== 0 ? d.x / ((hx * t.w) / k) : t.sx;
  let sy = hy !== 0 ? d.y / ((hy * t.h) / k) : t.sy;

  if (shift && hx !== 0 && hy !== 0) {
    const fx = Math.abs(sx / t.sx);
    const fy = Math.abs(sy / t.sy);
    const f = Math.max(fx, fy);
    sx = Math.sign(sx || 1) * Math.abs(t.sx) * f;
    sy = Math.sign(sy || 1) * Math.abs(t.sy) * f;
  }
  if (Math.abs(sx) < 0.001) sx = 0.001 * Math.sign(sx || 1);
  if (Math.abs(sy) < 0.001) sy = 0.001 * Math.sign(sy || 1);

  if (alt) return { ...t, sx, sy };
  const v = rotate({ x: (hx * t.w * sx) / 2, y: (hy * t.h * sy) / 2 }, t.rot);
  return { ...t, sx, sy, cx: anchor.x + v.x, cy: anchor.y + v.y };
}

export function rotateTo(t: TState, p: Point, snap: boolean): TState {
  let rot = Math.atan2(p.y - t.cy, p.x - t.cx) + Math.PI / 2;
  if (snap) {
    const step = Math.PI / 12; // 15°
    rot = Math.round(rot / step) * step;
  }
  return { ...t, rot };
}

/** O ponto está dentro do retângulo transformado? */
export function contains(t: TState, p: Point): boolean {
  const d = rotate({ x: p.x - t.cx, y: p.y - t.cy }, -t.rot);
  return Math.abs(d.x) <= Math.abs((t.w * t.sx) / 2) && Math.abs(d.y) <= Math.abs((t.h * t.sy) / 2);
}
