/**
 * Pincel: carimba "dabs" ao longo do traço. `opacity` limita o traço inteiro (como no Photoshop) e
 * `flow` é o acúmulo por carimbo, então com opacity < 1 o traço é desenhado num canvas à parte e
 * recomposto sobre o snapshot da camada a cada movimento.
 */
import { createCanvas } from "./engine";

export interface BrushSettings {
  /** diâmetro em px */
  size: number;
  /** 0..1 — 1 = borda dura */
  hardness: number;
  /** 0..1 — teto do traço inteiro */
  opacity: number;
  /** 0..1 — acúmulo por carimbo */
  flow: number;
  /** fração do diâmetro entre carimbos */
  spacing: number;
}

export const DEFAULT_BRUSH: BrushSettings = { size: 40, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.25 };

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StrokeResult {
  rect: PixelRect;
  before: ImageData;
  after: ImageData;
}

const dabCache = new Map<string, HTMLCanvasElement>();

function dabSprite(size: number, hardness: number, color: string): HTMLCanvasElement {
  const d = Math.max(1, Math.round(size));
  const key = `${d}|${hardness.toFixed(2)}|${color}`;
  const hit = dabCache.get(key);
  if (hit) return hit;
  if (dabCache.size > 60) dabCache.clear();

  const c = createCanvas(d, d);
  const ctx = c.getContext("2d")!;
  const r = d / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  const inner = Math.min(0.999, Math.max(0, hardness));
  g.addColorStop(0, color);
  g.addColorStop(inner, color);
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, d, d);
  dabCache.set(key, c);
  return c;
}

/** Aceita `#rrggbb` (única forma usada pelo editor). */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Seleção como recorte do traço: `ox/oy` é a origem da camada no documento. */
export interface StrokeClip {
  canvas: HTMLCanvasElement;
  ox: number;
  oy: number;
}

/** Clonagem: cada carimbo copia os pixels de (x+dx, y+dy). */
export interface CloneSource {
  dx: number;
  dy: number;
}

export interface StrokeExtras {
  clip?: StrokeClip | null;
  clone?: CloneSource | null;
}

export class Stroke {
  private ctx: CanvasRenderingContext2D;
  private before: ImageData;
  private overlay: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private last: { x: number; y: number } | null = null;
  private carry = 0;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  /**
   * @param erase apaga (destination-out) em vez de pintar
   * @param color `#rrggbb` do pincel (ignorado ao apagar)
   */
  constructor(
    private target: HTMLCanvasElement,
    private settings: BrushSettings,
    private color: string,
    private erase: boolean,
    private extras: StrokeExtras = {},
  ) {
    this.ctx = target.getContext("2d", { willReadFrequently: true })!;
    this.before = this.ctx.getImageData(0, 0, target.width, target.height);
    if (settings.opacity < 1 || extras.clip) {
      this.overlay = createCanvas(target.width, target.height);
      this.overlayCtx = this.overlay.getContext("2d")!;
    }
  }

  begin(x: number, y: number, pressure = 1) {
    this.last = { x, y };
    this.dab(x, y, pressure);
    this.flush();
  }

  move(x: number, y: number, pressure = 1) {
    if (!this.last) return this.begin(x, y, pressure);
    const step = Math.max(1, this.settings.size * this.settings.spacing);
    let dx = x - this.last.x;
    let dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    dx /= dist;
    dy /= dist;
    let pos = step - this.carry;
    while (pos <= dist) {
      this.dab(this.last.x + dx * pos, this.last.y + dy * pos, pressure);
      pos += step;
    }
    this.carry = dist - (pos - step);
    this.last = { x, y };
    this.flush();
  }

  /** Fecha o traço; devolve o retângulo alterado com o antes/depois (para o histórico). */
  end(): StrokeResult | null {
    if (!isFinite(this.minX)) return null;
    const x = Math.max(0, Math.floor(this.minX));
    const y = Math.max(0, Math.floor(this.minY));
    const w = Math.min(this.target.width, Math.ceil(this.maxX)) - x;
    const h = Math.min(this.target.height, Math.ceil(this.maxY)) - y;
    if (w <= 0 || h <= 0) return null;
    return {
      rect: { x, y, w, h },
      before: crop(this.before, x, y, w, h),
      after: this.ctx.getImageData(x, y, w, h),
    };
  }

  private dab(x: number, y: number, pressure: number) {
    const size = Math.max(1, this.settings.size);
    let sprite = dabSprite(size, this.settings.hardness, this.erase ? "#000000" : this.color);
    if (this.extras.clone) sprite = this.cloneSprite(sprite, x, y, this.extras.clone);
    const dest = this.overlayCtx ?? this.ctx;
    dest.save();
    dest.globalAlpha = Math.max(0.01, this.settings.flow * pressure);
    // Com overlay, apagar também desenha (qualquer cor) e o recomposto aplica destination-out.
    dest.globalCompositeOperation = !this.overlayCtx && this.erase ? "destination-out" : "source-over";
    dest.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2);
    dest.restore();

    const r = size / 2 + 1;
    this.minX = Math.min(this.minX, x - r);
    this.minY = Math.min(this.minY, y - r);
    this.maxX = Math.max(this.maxX, x + r);
    this.maxY = Math.max(this.maxY, y + r);
  }

  /** Pontas do carimbo com a forma do pincel, mas com os pixels da origem do clone. */
  private cloneSprite(sprite: HTMLCanvasElement, x: number, y: number, c: CloneSource): HTMLCanvasElement {
    const out = createCanvas(sprite.width, sprite.height);
    const octx = out.getContext("2d")!;
    octx.drawImage(this.target, x + c.dx - sprite.width / 2, y + c.dy - sprite.height / 2, sprite.width, sprite.height, 0, 0, sprite.width, sprite.height);
    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(sprite, 0, 0);
    return out;
  }

  private clipped: HTMLCanvasElement | null = null;

  /** Com opacity < 1 ou seleção: restaura o snapshot e recompõe o traço inteiro (no teto de opacidade, recortado). */
  private flush() {
    if (!this.overlay) return;
    this.ctx.putImageData(this.before, 0, 0);
    let src = this.overlay;
    const clip = this.extras.clip;
    if (clip) {
      if (!this.clipped) this.clipped = createCanvas(this.overlay.width, this.overlay.height);
      const cctx = this.clipped.getContext("2d")!;
      cctx.globalCompositeOperation = "source-over";
      cctx.clearRect(0, 0, this.clipped.width, this.clipped.height);
      cctx.drawImage(this.overlay, 0, 0);
      cctx.globalCompositeOperation = "destination-in";
      cctx.drawImage(clip.canvas, -clip.ox, -clip.oy);
      src = this.clipped;
    }
    this.ctx.save();
    this.ctx.globalAlpha = this.settings.opacity;
    this.ctx.globalCompositeOperation = this.erase ? "destination-out" : "source-over";
    this.ctx.drawImage(src, 0, 0);
    this.ctx.restore();
  }
}

function crop(src: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const out = new ImageData(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * src.width + x) * 4;
    out.data.set(src.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}
