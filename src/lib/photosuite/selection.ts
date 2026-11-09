/**
 * Seleção: um canvas do tamanho do documento cujo alfa é a cobertura (0..255). Canvases de seleção são
 * imutáveis depois de criados — toda operação gera um canvas novo — para o histórico poder guardar
 * referências sem copiar.
 */
import { createCanvas } from "./engine";

export type SelMode = "new" | "add" | "sub" | "int";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let current: HTMLCanvasElement | null = null;
export const getSelection = () => current;
export const setSelectionCanvas = (c: HTMLCanvasElement | null) => {
  current = c;
};

/** Área de cobertura ≥ 1 ou `null` se vazia. */
export function boundsOf(c: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = c;
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Cobertura (alfa) da seleção no pixel; 0 se não houver seleção. */
export function coverageAt(x: number, y: number): number {
  if (!current) return 0;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= current.width || py >= current.height) return 0;
  return current.getContext("2d", { willReadFrequently: true })!.getImageData(px, py, 1, 1).data[3];
}

/** Desenha uma forma branca (com antialias) num canvas novo, com pena opcional. */
export function fromShape(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, feather = 0): HTMLCanvasElement {
  const shape = createCanvas(w, h);
  const ctx = shape.getContext("2d")!;
  ctx.fillStyle = "#fff";
  draw(ctx);
  return feather > 0 ? blurred(shape, feather) : shape;
}

export function blurred(c: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = createCanvas(c.width, c.height);
  const ctx = out.getContext("2d")!;
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(c, 0, 0);
  return out;
}

/** Combina a seleção atual com uma forma nova segundo o modo (substituir / somar / subtrair / interseção). */
export function combine(base: HTMLCanvasElement | null, shape: HTMLCanvasElement, mode: SelMode): HTMLCanvasElement | null {
  if (mode === "new" || !base) return mode === "sub" || mode === "int" ? (base ? shape : null) : shape;
  const out = createCanvas(base.width, base.height);
  const ctx = out.getContext("2d")!;
  ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = mode === "add" ? "source-over" : mode === "sub" ? "destination-out" : "destination-in";
  ctx.drawImage(shape, 0, 0);
  return out;
}

export function all(w: number, h: number): HTMLCanvasElement {
  return fromShape(w, h, (ctx) => ctx.fillRect(0, 0, w, h));
}

export function invert(base: HTMLCanvasElement): HTMLCanvasElement {
  const out = createCanvas(base.width, base.height);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(base, 0, 0);
  return out;
}

export function shifted(base: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement {
  const out = createCanvas(base.width, base.height);
  out.getContext("2d")!.drawImage(base, Math.round(dx), Math.round(dy));
  return out;
}

/** Expande (max) ou contrai (min) a cobertura em `r` px, com janela quadrada separável. */
export function grow(base: HTMLCanvasElement, r: number, expand: boolean): HTMLCanvasElement {
  const { width: w, height: h } = base;
  const img = base.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h);
  const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3];
  const tmp = new Uint8Array(w * h);
  const pick = expand ? Math.max : Math.min;
  const init = expand ? 0 : 255;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = init;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, a[y * w + k]);
      // fora do documento conta como vazio ao contrair
      if (!expand && (x - r < 0 || x + r >= w)) v = 0;
      tmp[y * w + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = init;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]);
      if (!expand && (y - r < 0 || y + r >= h)) v = 0;
      a[y * w + x] = v;
    }
  }
  const out = createCanvas(w, h);
  const octx = out.getContext("2d")!;
  const od = octx.createImageData(w, h);
  for (let i = 0; i < a.length; i++) {
    od.data[i * 4] = od.data[i * 4 + 1] = od.data[i * 4 + 2] = 255;
    od.data[i * 4 + 3] = a[i];
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/** Canvas branco com alfa = `coverage` (0..255 por pixel). */
export function fromCoverage(w: number, h: number, coverage: Uint8Array): HTMLCanvasElement {
  const out = createCanvas(w, h);
  const ctx = out.getContext("2d")!;
  const d = ctx.createImageData(w, h);
  for (let i = 0; i < coverage.length; i++) {
    d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = 255;
    d.data[i * 4 + 3] = coverage[i];
  }
  ctx.putImageData(d, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Formigas marchando (calculadas em resolução de tela, então a borda tem sempre 1px)
// ---------------------------------------------------------------------------------------------

let antsCanvas: HTMLCanvasElement | null = null;

export function drawAnts(
  ctx: CanvasRenderingContext2D,
  sel: HTMLCanvasElement,
  view: { zoom: number; x: number; y: number },
  vw: number,
  vh: number,
  phase: number,
) {
  const W = Math.max(1, Math.round(vw));
  const H = Math.max(1, Math.round(vh));
  if (!antsCanvas) antsCanvas = createCanvas(W, H);
  if (antsCanvas.width !== W || antsCanvas.height !== H) {
    antsCanvas.width = W;
    antsCanvas.height = H;
  }
  const tctx = antsCanvas.getContext("2d", { willReadFrequently: true })!;
  tctx.clearRect(0, 0, W, H);
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(sel, view.x, view.y, sel.width * view.zoom, sel.height * view.zoom);
  const src = tctx.getImageData(0, 0, W, H);
  const a = src.data;
  const out = tctx.createImageData(W, H);
  const o = out.data;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && a[(y * W + x) * 4 + 3] >= 128;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      if (inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue;
      const i = (y * W + x) * 4;
      const v = ((x + y + phase) >> 2) & 1 ? 0 : 255;
      o[i] = o[i + 1] = o[i + 2] = v;
      o[i + 3] = 255;
    }
  }
  tctx.putImageData(out, 0, 0);
  ctx.drawImage(antsCanvas, 0, 0, W, H);
}

// ---------------------------------------------------------------------------------------------
// Área de transferência interna (o clipboard do sistema não guarda a posição de origem)
// ---------------------------------------------------------------------------------------------

export interface ClipItem {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}
let clip: ClipItem | null = null;
export const getClip = () => clip;
export const setClip = (c: ClipItem | null) => {
  clip = c;
};
