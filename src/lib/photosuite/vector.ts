/**
 * Formas vetoriais: caminhos de Bézier editáveis (caneta, seleção direta, formas prontas) que viram
 * os pixels de uma camada. Os pontos ficam nas coordenadas do canvas da camada: depois de cada
 * rasterização o caminho é "rebaseado" para que o canto do canvas seja (0,0), então mover a camada
 * (x, y) move a forma sem mexer nos pontos.
 */
import { paintGradientCanvas, type GradientSpec } from "./gradient";

/** Âncora com alças guardadas como deslocamento da própria âncora. */
export interface Anchor {
  x: number;
  y: number;
  ix: number;
  iy: number;
  ox: number;
  oy: number;
}

export interface SubPath {
  points: Anchor[];
  closed: boolean;
}

export type FillSpec = { kind: "color"; color: string } | { kind: "gradient"; gradient: GradientSpec };

export interface StrokeSpec {
  color: string;
  width: number;
  align: "center" | "inside" | "outside";
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  /** tracejado: comprimento do traço e do vão em múltiplos da espessura; `null` = contínuo */
  dash: number | null;
}

export interface ShapeData {
  paths: SubPath[];
  fill: FillSpec | null;
  stroke: StrokeSpec | null;
  evenOdd: boolean;
}

export const DEFAULT_STROKE: StrokeSpec = { color: "#000000", width: 4, align: "center", cap: "butt", join: "miter", dash: null };

export const corner = (x: number, y: number): Anchor => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });

const cloneAnchor = (a: Anchor): Anchor => ({ ...a });
export const cloneShape = (s: ShapeData): ShapeData => ({
  ...s,
  paths: s.paths.map((p) => ({ closed: p.closed, points: p.points.map(cloneAnchor) })),
  fill: s.fill ? (s.fill.kind === "color" ? { ...s.fill } : { kind: "gradient", gradient: structuredClone(s.fill.gradient) }) : null,
  stroke: s.stroke ? { ...s.stroke } : null,
});

// ---------------------------------------------------------------------------------------------
// Geometria dos segmentos
// ---------------------------------------------------------------------------------------------

type Pt = { x: number; y: number };

/** Os quatro pontos de controle do segmento de `a` para `b`. */
function segment(a: Anchor, b: Anchor): [Pt, Pt, Pt, Pt] {
  return [
    { x: a.x, y: a.y },
    { x: a.x + a.ox, y: a.y + a.oy },
    { x: b.x + b.ix, y: b.y + b.iy },
    { x: b.x, y: b.y },
  ];
}

const bez = (p: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return { x: w0 * p[0].x + w1 * p[1].x + w2 * p[2].x + w3 * p[3].x, y: w0 * p[0].y + w1 * p[1].y + w2 * p[2].y + w3 * p[3].y };
};

/** Pares (a, b) consecutivos de um subcaminho (inclui o de fechamento). */
function segments(p: SubPath): [Anchor, Anchor, number][] {
  const out: [Anchor, Anchor, number][] = [];
  for (let i = 0; i < p.points.length - 1; i++) out.push([p.points[i], p.points[i + 1], i]);
  if (p.closed && p.points.length > 1) out.push([p.points[p.points.length - 1], p.points[0], p.points.length - 1]);
  return out;
}

export function toPath2D(paths: SubPath[]): Path2D {
  const path = new Path2D();
  for (const sp of paths) {
    if (sp.points.length === 0) continue;
    path.moveTo(sp.points[0].x, sp.points[0].y);
    for (const [a, b] of segments(sp)) path.bezierCurveTo(a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y);
    if (sp.closed) path.closePath();
  }
  return path;
}

export function pathBounds(paths: SubPath[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Pt) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const sp of paths) {
    sp.points.forEach(add);
    for (const [a, b] of segments(sp)) {
      const s = segment(a, b);
      for (let i = 1; i < 16; i++) add(bez(s, i / 16));
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------------------------
// Rasterização
// ---------------------------------------------------------------------------------------------

/** Quanto o traço ultrapassa o contorno (para dimensionar o canvas). */
function strokeReach(s: StrokeSpec | null): number {
  if (!s) return 0;
  const miter = s.join === "miter" ? 4 : 1;
  if (s.align === "inside") return 0;
  return Math.ceil(s.align === "outside" ? s.width : (s.width / 2) * miter);
}

export interface Rasterized {
  canvas: HTMLCanvasElement;
  /** o pixel (0,0) do canvas é a coordenada local (shiftX, shiftY) da forma */
  shiftX: number;
  shiftY: number;
}

export function rasterizeShape(shape: ShapeData): Rasterized {
  const b = pathBounds(shape.paths);
  const pad = strokeReach(shape.stroke) + 2;
  if (!b) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    return { canvas: c, shiftX: 0, shiftY: 0 };
  }
  const shiftX = Math.floor(b.x0 - pad);
  const shiftY = Math.floor(b.y0 - pad);
  const w = Math.max(1, Math.ceil(b.x1 + pad) - shiftX);
  const h = Math.max(1, Math.ceil(b.y1 + pad) - shiftY);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(-shiftX, -shiftY);
  const path = toPath2D(shape.paths);
  const rule: CanvasFillRule = shape.evenOdd ? "evenodd" : "nonzero";
  const anyClosed = shape.paths.some((p) => p.closed);

  if (shape.fill && anyClosed) {
    if (shape.fill.kind === "color") {
      ctx.fillStyle = shape.fill.color;
      ctx.fill(path, rule);
    } else {
      ctx.save();
      ctx.clip(path, rule);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = paintGradientCanvas(w, h, shape.fill.gradient, { x0: b.x0 - shiftX, y0: b.y0 - shiftY, x1: b.x1 - shiftX, y1: b.y1 - shiftY });
      // o clip foi definido no sistema transladado; reaplica-o antes de desenhar
      ctx.restore();
      ctx.save();
      ctx.clip(path, rule);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(g, 0, 0);
      ctx.restore();
    }
  }

  const st = shape.stroke;
  if (st && st.width > 0) {
    const apply = (c: CanvasRenderingContext2D, width: number) => {
      c.lineWidth = width;
      c.lineCap = st.cap;
      c.lineJoin = st.join;
      c.miterLimit = 10;
      c.strokeStyle = st.color;
      c.setLineDash(st.dash ? [st.dash * st.width, st.dash * st.width] : []);
    };
    if (st.align === "center" || !anyClosed) {
      apply(ctx, st.width);
      ctx.stroke(path);
    } else if (st.align === "inside") {
      ctx.save();
      ctx.clip(path, rule);
      apply(ctx, st.width * 2);
      ctx.stroke(path);
      ctx.restore();
    } else {
      // por fora: traço de 2× a espessura com o interior removido
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext("2d")!;
      tctx.translate(-shiftX, -shiftY);
      apply(tctx, st.width * 2);
      tctx.stroke(path);
      tctx.globalCompositeOperation = "destination-out";
      tctx.fillStyle = "#000";
      tctx.fill(path, rule);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    }
  }
  return { canvas, shiftX, shiftY };
}

/** Desloca todos os pontos (para rebasear depois de rasterizar). */
export function translateShape(shape: ShapeData, dx: number, dy: number): ShapeData {
  const s = cloneShape(shape);
  for (const p of s.paths) for (const a of p.points) { a.x += dx; a.y += dy; }
  return s;
}

/** Aplica `f` a cada âncora e alça (as alças viram pontos absolutos, transformam e voltam a deslocamentos). */
export function mapShape(shape: ShapeData, f: (x: number, y: number) => [number, number]): ShapeData {
  const s = cloneShape(shape);
  for (const p of s.paths) {
    for (const a of p.points) {
      const [nx, ny] = f(a.x, a.y);
      const [ix, iy] = f(a.x + a.ix, a.y + a.iy);
      const [ox, oy] = f(a.x + a.ox, a.y + a.oy);
      a.x = nx; a.y = ny;
      a.ix = ix - nx; a.iy = iy - ny;
      a.ox = ox - nx; a.oy = oy - ny;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Formas prontas
// ---------------------------------------------------------------------------------------------

const KAPPA = 0.5522847498;

export function rectPath(x: number, y: number, w: number, h: number, radius = 0): SubPath {
  const r = Math.min(Math.max(0, radius), Math.abs(w) / 2, Math.abs(h) / 2);
  if (r <= 0) {
    return { closed: true, points: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)] };
  }
  // 8 âncoras no sentido horário; cada canto é um arco entre duas âncoras (alças de r·κ rumo ao canto)
  const k = r * KAPPA;
  const pt = (px: number, py: number, ix: number, iy: number, ox: number, oy: number): Anchor => ({ x: px, y: py, ix, iy, ox, oy });
  return {
    closed: true,
    points: [
      pt(x + r, y, -k, 0, 0, 0),
      pt(x + w - r, y, 0, 0, k, 0),
      pt(x + w, y + r, 0, -k, 0, 0),
      pt(x + w, y + h - r, 0, 0, 0, k),
      pt(x + w - r, y + h, k, 0, 0, 0),
      pt(x + r, y + h, 0, 0, -k, 0),
      pt(x, y + h - r, 0, k, 0, 0),
      pt(x, y + r, 0, 0, 0, -k),
    ],
  };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): SubPath {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    points: [
      { x: cx, y: cy - ry, ix: -kx, iy: 0, ox: kx, oy: 0 },
      { x: cx + rx, y: cy, ix: 0, iy: -ky, ox: 0, oy: ky },
      { x: cx, y: cy + ry, ix: kx, iy: 0, ox: -kx, oy: 0 },
      { x: cx - rx, y: cy, ix: 0, iy: ky, ox: 0, oy: -ky },
    ],
  };
}

export function polygonPath(cx: number, cy: number, r: number, sides: number, rotation = -Math.PI / 2): SubPath {
  const n = Math.max(3, Math.round(sides));
  return { closed: true, points: Array.from({ length: n }, (_, i) => corner(cx + Math.cos(rotation + (i * 2 * Math.PI) / n) * r, cy + Math.sin(rotation + (i * 2 * Math.PI) / n) * r)) };
}

export function starPath(cx: number, cy: number, outer: number, inner: number, points: number, rotation = -Math.PI / 2): SubPath {
  const n = Math.max(3, Math.round(points));
  return {
    closed: true,
    points: Array.from({ length: n * 2 }, (_, i) => {
      const r = i % 2 === 0 ? outer : inner;
      const a = rotation + (i * Math.PI) / n;
      return corner(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }),
  };
}

export function linePath(x0: number, y0: number, x1: number, y1: number): SubPath {
  return { closed: false, points: [corner(x0, y0), corner(x1, y1)] };
}

// ---------------------------------------------------------------------------------------------
// Edição: busca, inserção, remoção e conversão de pontos
// ---------------------------------------------------------------------------------------------

export type HitKind = "anchor" | "in" | "out";
export interface AnchorHit {
  path: number;
  index: number;
  kind: HitKind;
}

/** Âncora/alça sob `p` (as alças só contam se `showHandles` estiver nessa âncora). */
export function findAnchor(shape: ShapeData, p: Pt, tol: number, handlesOf?: { path: number; index: number }[]): AnchorHit | null {
  // alças primeiro (ficam por cima das âncoras)
  if (handlesOf) {
    for (const h of handlesOf) {
      const a = shape.paths[h.path]?.points[h.index];
      if (!a) continue;
      if (Math.hypot(a.x + a.ix - p.x, a.y + a.iy - p.y) <= tol && (a.ix !== 0 || a.iy !== 0)) return { path: h.path, index: h.index, kind: "in" };
      if (Math.hypot(a.x + a.ox - p.x, a.y + a.oy - p.y) <= tol && (a.ox !== 0 || a.oy !== 0)) return { path: h.path, index: h.index, kind: "out" };
    }
  }
  let best: AnchorHit | null = null;
  let bd = tol;
  shape.paths.forEach((sp, pi) => sp.points.forEach((a, i) => {
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d <= bd) { bd = d; best = { path: pi, index: i, kind: "anchor" }; }
  }));
  return best;
}

export interface SegmentHit {
  path: number;
  /** o segmento vai da âncora `index` para a seguinte */
  index: number;
  t: number;
  distance: number;
}

export function findSegment(shape: ShapeData, p: Pt, tol: number): SegmentHit | null {
  let best: SegmentHit | null = null;
  shape.paths.forEach((sp, pi) => {
    for (const [a, b, i] of segments(sp)) {
      const s = segment(a, b);
      const N = 24;
      for (let k = 0; k <= N; k++) {
        const q = bez(s, k / N);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= tol && (!best || d < best.distance)) best = { path: pi, index: i, t: k / N, distance: d };
      }
    }
  });
  return best;
}

/** Insere uma âncora no ponto `t` do segmento (de Casteljau), mantendo a curva idêntica. */
export function insertAnchor(shape: ShapeData, hit: SegmentHit): ShapeData {
  const s = cloneShape(shape);
  const sp = s.paths[hit.path];
  const aIdx = hit.index;
  const bIdx = (aIdx + 1) % sp.points.length;
  const a = sp.points[aIdx];
  const b = sp.points[bIdx];
  const [p0, p1, p2, p3] = segment(a, b);
  const t = hit.t;
  const lerp = (u: Pt, v: Pt): Pt => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const p01 = lerp(p0, p1), p12 = lerp(p1, p2), p23 = lerp(p2, p3);
  const p012 = lerp(p01, p12), p123 = lerp(p12, p23);
  const m = lerp(p012, p123);
  a.ox = p01.x - a.x; a.oy = p01.y - a.y;
  b.ix = p23.x - b.x; b.iy = p23.y - b.y;
  const anchor: Anchor = { x: m.x, y: m.y, ix: p012.x - m.x, iy: p012.y - m.y, ox: p123.x - m.x, oy: p123.y - m.y };
  sp.points.splice(aIdx + 1, 0, anchor);
  return s;
}

export function deleteAnchor(shape: ShapeData, path: number, index: number): ShapeData {
  const s = cloneShape(shape);
  const sp = s.paths[path];
  sp.points.splice(index, 1);
  if (sp.points.length < 2 && !(sp.closed && sp.points.length === 0)) s.paths.splice(path, 1);
  else if (sp.points.length < 3) sp.closed = false;
  return s;
}

/** Converte a âncora: com alças → canto; sem alças → suave (alças tangentes aos vizinhos). */
export function toggleSmooth(shape: ShapeData, path: number, index: number): ShapeData {
  const s = cloneShape(shape);
  const sp = s.paths[path];
  const a = sp.points[index];
  if (a.ix !== 0 || a.iy !== 0 || a.ox !== 0 || a.oy !== 0) {
    a.ix = a.iy = a.ox = a.oy = 0;
    return s;
  }
  const n = sp.points.length;
  const prev = sp.points[sp.closed ? (index - 1 + n) % n : Math.max(0, index - 1)];
  const next = sp.points[sp.closed ? (index + 1) % n : Math.min(n - 1, index + 1)];
  let tx = next.x - prev.x;
  let ty = next.y - prev.y;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len; ty /= len;
  const dIn = Math.hypot(a.x - prev.x, a.y - prev.y) / 3;
  const dOut = Math.hypot(next.x - a.x, next.y - a.y) / 3;
  a.ix = -tx * dIn; a.iy = -ty * dIn;
  a.ox = tx * dOut; a.oy = ty * dOut;
  return s;
}

/** O ponto está dentro do preenchimento da forma? */
export function hitFill(shape: ShapeData, p: Pt): boolean {
  const c = document.createElement("canvas").getContext("2d")!;
  return c.isPointInPath(toPath2D(shape.paths), p.x, p.y, shape.evenOdd ? "evenodd" : "nonzero");
}
