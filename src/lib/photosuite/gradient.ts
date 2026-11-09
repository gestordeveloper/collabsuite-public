/** Gradientes de preenchimento de forma e de sobreposição — port de gradient_t / sample_gradient do PhotoCraft. */

export type GradientStyle = "linear" | "radial" | "angle" | "reflected" | "diamond";

export interface GradientStopSpec {
  pos: number;
  color: string;
}

export interface GradientSpec {
  stops: GradientStopSpec[];
  /** paradas de opacidade (0..1); vazio = opaco */
  opacityStops: { pos: number; alpha: number }[];
  style: GradientStyle;
  /** graus, anti-horário a partir de 3 horas */
  angle: number;
  scale: number;
  reverse: boolean;
  /** deslocamento do centro, em fração do retângulo */
  offset: [number, number];
}

export const defaultGradient = (): GradientSpec => ({
  stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }],
  opacityStops: [],
  style: "linear",
  angle: 90,
  scale: 1,
  reverse: false,
  offset: [0, 0],
});

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function gradientUnits(angle: number, w: number, h: number): [number, number] {
  const a = (angle * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const len = Math.max(Math.sqrt((c * w) ** 2 + (s * h) ** 2), 1);
  const chord = Math.max(Math.min(w / Math.max(Math.abs(c), 1e-6), h / Math.max(Math.abs(s), 1e-6)), 1);
  return [chord, len];
}

/** Parâmetro t (0..1) do pixel de centro (x, y) dentro de `b`. */
export function gradientT(g: GradientSpec, b: Bounds, x: number, y: number): number {
  const w = Math.max(b.x1 - b.x0, 1);
  const h = Math.max(b.y1 - b.y0, 1);
  const cx = b.x0 + w / 2 + g.offset[0] * w;
  const cy = b.y0 + h / 2 + g.offset[1] * h;
  const a = (g.angle * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const dx = x - cx;
  const dy = y - cy;
  const along = dx * c - dy * s;
  const across = dx * s + dy * c;
  const sc = Math.max(g.scale, 1e-3);
  const [chord0, len0] = gradientUnits(g.angle, w, h);
  const chord = chord0 * sc;
  const len = len0 * sc;
  const corner = 0.5 * (c - s);
  let t: number;
  switch (g.style) {
    case "linear": t = (along - corner) / chord + 0.5; break;
    case "reflected": t = Math.abs((along - corner) / (chord / 2)); break;
    case "radial": t = Math.sqrt(dx * dx + dy * dy) / (len / 2); break;
    case "diamond": t = (Math.abs(along) + Math.abs(across)) / (len / 2); break;
    case "angle": {
      const turn = (a - Math.atan2(-dy, dx)) / (Math.PI * 2);
      t = ((turn % 1) + 1) % 1;
      break;
    }
  }
  t = Math.min(1, Math.max(0, t));
  return g.reverse ? 1 - t : t;
}

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface PreparedGradient {
  sample: (t: number, out: [number, number, number, number]) => void;
}

/** Pré-processa as paradas (ordenadas, cores em 0..1) para amostrar muitos pixels. */
export function prepareGradient(g: GradientSpec): PreparedGradient {
  const colors = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => ({ pos: s.pos, c: parse(s.color) }));
  const alphas = [...g.opacityStops].sort((a, b) => a.pos - b.pos);
  return {
    sample(t, out) {
      // cor
      if (colors.length === 0) { out[0] = out[1] = out[2] = t; }
      else if (colors.length === 1 || t <= colors[0].pos) { out[0] = colors[0].c[0]; out[1] = colors[0].c[1]; out[2] = colors[0].c[2]; }
      else {
        let done = false;
        for (let i = 0; i < colors.length - 1 && !done; i++) {
          const a = colors[i];
          const b = colors[i + 1];
          if (t <= b.pos) {
            const k = b.pos > a.pos ? (t - a.pos) / (b.pos - a.pos) : 0;
            for (let j = 0; j < 3; j++) out[j] = a.c[j] + (b.c[j] - a.c[j]) * k;
            done = true;
          }
        }
        if (!done) { const l = colors[colors.length - 1].c; out[0] = l[0]; out[1] = l[1]; out[2] = l[2]; }
      }
      // opacidade
      if (alphas.length === 0) out[3] = 1;
      else if (alphas.length === 1 || t <= alphas[0].pos) out[3] = alphas[0].alpha;
      else {
        let done = false;
        for (let i = 0; i < alphas.length - 1 && !done; i++) {
          const a = alphas[i];
          const b = alphas[i + 1];
          if (t <= b.pos) {
            const k = b.pos > a.pos ? (t - a.pos) / (b.pos - a.pos) : 0;
            out[3] = a.alpha + (b.alpha - a.alpha) * k;
            done = true;
          }
        }
        if (!done) out[3] = alphas[alphas.length - 1].alpha;
      }
    },
  };
}

/** Pinta o gradiente num canvas (w×h) tendo `b` como retângulo de referência (coordenadas do canvas). */
export function paintGradientCanvas(w: number, h: number, g: GradientSpec, b: Bounds): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  const p = prepareGradient(g);
  const out: [number, number, number, number] = [0, 0, 0, 1];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      p.sample(gradientT(g, b, x + 0.5, y + 0.5), out);
      const i = (y * c.width + x) * 4;
      img.data[i] = Math.round(out[0] * 255);
      img.data[i + 1] = Math.round(out[1] * 255);
      img.data[i + 2] = Math.round(out[2] * 255);
      img.data[i + 3] = Math.round(out[3] * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
