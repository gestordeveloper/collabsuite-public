/**
 * Filtros destrutivos — ports de crates/algo/src (blur, sharpen, noise, stylize) do PhotoCraft.
 * Trabalham num ImageData de 8 bits (alfa direto). Os borrões operam em alfa pré-multiplicado e
 * repetem a borda da camada (o canvas da camada é o "documento" do filtro).
 */

export type FilterId =
  | "gaussian" | "box" | "motion"
  | "unsharp" | "smart-sharpen" | "high-pass"
  | "noise" | "median"
  | "mosaic"
  | "emboss" | "find-edges" | "solarize";

export interface ParamDef {
  key: string;
  label: string;
  type: "range" | "select" | "check";
  min?: number;
  max?: number;
  step?: number;
  default: number;
  suffix?: string;
  options?: { value: number; label: string }[];
}

export interface FilterDef {
  id: FilterId;
  label: string;
  group: string;
  params: ParamDef[];
}

export const FILTERS: FilterDef[] = [
  { id: "gaussian", label: "Desfoque gaussiano", group: "Desfoque", params: [{ key: "radius", label: "Raio", type: "range", min: 0, max: 250, step: 0.1, default: 5, suffix: "px" }] },
  { id: "box", label: "Desfoque de caixa", group: "Desfoque", params: [{ key: "radius", label: "Raio", type: "range", min: 0, max: 250, step: 1, default: 5, suffix: "px" }] },
  {
    id: "motion", label: "Desfoque de movimento", group: "Desfoque",
    params: [
      { key: "angle", label: "Ângulo", type: "range", min: -90, max: 90, step: 1, default: 0, suffix: "°" },
      { key: "distance", label: "Distância", type: "range", min: 1, max: 300, step: 1, default: 20, suffix: "px" },
    ],
  },
  {
    id: "unsharp", label: "Máscara de nitidez", group: "Nitidez",
    params: [
      { key: "amount", label: "Quantidade", type: "range", min: 1, max: 500, step: 1, default: 100, suffix: "%" },
      { key: "radius", label: "Raio", type: "range", min: 0.1, max: 250, step: 0.1, default: 2, suffix: "px" },
      { key: "threshold", label: "Limiar", type: "range", min: 0, max: 255, step: 1, default: 0 },
    ],
  },
  {
    id: "smart-sharpen", label: "Nitidez inteligente", group: "Nitidez",
    params: [
      { key: "amount", label: "Quantidade", type: "range", min: 1, max: 500, step: 1, default: 100, suffix: "%" },
      { key: "radius", label: "Raio", type: "range", min: 0.1, max: 64, step: 0.1, default: 1.5, suffix: "px" },
      { key: "reduceNoise", label: "Reduzir ruído", type: "range", min: 0, max: 100, step: 1, default: 10, suffix: "%" },
    ],
  },
  { id: "high-pass", label: "Passa-alta", group: "Nitidez", params: [{ key: "radius", label: "Raio", type: "range", min: 0.1, max: 250, step: 0.1, default: 10, suffix: "px" }] },
  {
    id: "noise", label: "Adicionar ruído", group: "Ruído",
    params: [
      { key: "amount", label: "Quantidade", type: "range", min: 0, max: 400, step: 0.1, default: 12, suffix: "%" },
      { key: "dist", label: "Distribuição", type: "select", default: 0, options: [{ value: 0, label: "Uniforme" }, { value: 1, label: "Gaussiana" }] },
      { key: "mono", label: "Monocromático", type: "check", default: 0 },
      { key: "seed", label: "Semente", type: "range", min: 0, max: 999, step: 1, default: 1 },
    ],
  },
  {
    id: "median", label: "Mediana", group: "Ruído",
    params: [
      { key: "radius", label: "Raio", type: "range", min: 1, max: 10, step: 1, default: 2, suffix: "px" },
      { key: "threshold", label: "Limiar (0 = sempre)", type: "range", min: 0, max: 255, step: 1, default: 0 },
    ],
  },
  { id: "mosaic", label: "Mosaico", group: "Pixelizar", params: [{ key: "cell", label: "Tamanho da célula", type: "range", min: 2, max: 200, step: 1, default: 12, suffix: "px" }] },
  {
    id: "emboss", label: "Relevo", group: "Estilizar",
    params: [
      { key: "angle", label: "Ângulo", type: "range", min: -180, max: 180, step: 1, default: 135, suffix: "°" },
      { key: "height", label: "Altura", type: "range", min: 1, max: 10, step: 1, default: 3, suffix: "px" },
      { key: "amount", label: "Quantidade", type: "range", min: 1, max: 500, step: 1, default: 100, suffix: "%" },
    ],
  },
  { id: "find-edges", label: "Detectar bordas", group: "Estilizar", params: [] },
  { id: "solarize", label: "Solarizar", group: "Estilizar", params: [] },
];

export const defaultParams = (def: FilterDef): Record<string, number> => Object.fromEntries(def.params.map((p) => [p.key, p.default]));

// ---------------------------------------------------------------------------------------------
// Utilidades de pixel
// ---------------------------------------------------------------------------------------------

/** RGBA 8 bits (alfa direto) → floats 0..1 pré-multiplicados. */
function premultiply(img: ImageData): Float32Array {
  const d = img.data;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = (d[i] / 255) * a;
    out[i + 1] = (d[i + 1] / 255) * a;
    out[i + 2] = (d[i + 2] / 255) * a;
    out[i + 3] = a;
  }
  return out;
}

/** floats pré-multiplicados → ImageData (alfa direto). */
function toImageData(f: Float32Array, w: number, h: number): ImageData {
  const out = new ImageData(w, h);
  const d = out.data;
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3];
    if (a > 1e-7) {
      d[i] = Math.round(Math.min(1, Math.max(0, f[i] / a)) * 255);
      d[i + 1] = Math.round(Math.min(1, Math.max(0, f[i + 1] / a)) * 255);
      d[i + 2] = Math.round(Math.min(1, Math.max(0, f[i + 2] / a)) * 255);
    }
    d[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function gaussianKernel(sigma: number): Float32Array {
  if (sigma < 0.05) return Float32Array.of(1);
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Convolução separável (borda repetida) sobre RGBA float. */
function convolve(src: Float32Array, w: number, h: number, kx: Float32Array, ky: Float32Array): Float32Array {
  const rx = (kx.length - 1) >> 1;
  const ry = (ky.length - 1) >> 1;
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -rx; k <= rx; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const i = row + xx * 4;
        const wt = kx[k + rx];
        r += src[i] * wt; g += src[i + 1] * wt; b += src[i + 2] * wt; a += src[i + 3] * wt;
      }
      const o = row + x * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -ry; k <= ry; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const i = (yy * w + x) * 4;
        const wt = ky[k + ry];
        r += tmp[i] * wt; g += tmp[i + 1] * wt; b += tmp[i + 2] * wt; a += tmp[i + 3] * wt;
      }
      const o = (y * w + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return out;
}

/** Caixa de raio `r` por soma deslizante (borda repetida), ao longo de um eixo. */
function boxPass(src: Float32Array, w: number, h: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 4 : w * 4;
  const lineStride = horizontal ? w * 4 : 4;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    for (let c = 0; c < 4; c++) {
      const at = (i: number) => src[base + Math.min(len - 1, Math.max(0, i)) * stride + c];
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += at(k);
      for (let i = 0; i < len; i++) {
        out[base + i * stride + c] = sum * inv;
        sum += at(i + r + 1) - at(i - r);
      }
    }
  }
  return out;
}

/** Larguras (ímpares) de `n` caixas cuja convolução tem desvio-padrão `sigma` (Kovesi 2010). */
function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl -= 1;
  wl = Math.max(wl, 1);
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.min(n, Math.max(0, Math.round(mIdeal)));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.05) return src;
  if (sigma > 4) {
    let cur = src;
    for (const width of boxesForGauss(sigma, 3)) {
      const r = (width - 1) >> 1;
      cur = boxPass(boxPass(cur, w, h, r, true), w, h, r, false);
    }
    return cur;
  }
  const k = gaussianKernel(sigma);
  return convolve(src, w, h, k, k);
}

/** Amostra bilinear com borda repetida, acumulando em `acc`. */
function addShifted(acc: Float32Array, src: Float32Array, w: number, h: number, dx: number, dy: number, weight: number) {
  const fx = Math.floor(dx);
  const fy = Math.floor(dy);
  const tx = dx - fx;
  const ty = dy - fy;
  const w00 = (1 - tx) * (1 - ty) * weight;
  const w10 = tx * (1 - ty) * weight;
  const w01 = (1 - tx) * ty * weight;
  const w11 = tx * ty * weight;
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(h - 1, Math.max(0, y + fy));
    const y1 = Math.min(h - 1, Math.max(0, y + fy + 1));
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(w - 1, Math.max(0, x + fx));
      const x1 = Math.min(w - 1, Math.max(0, x + fx + 1));
      const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) acc[o + c] += src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
    }
  }
}

function motionBlur(src: Float32Array, w: number, h: number, angle: number, distance: number): Float32Array {
  const d = Math.abs(distance);
  if (d < 0.5) return src;
  const a = (angle * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const steps = Math.ceil(d);
  const acc = new Float32Array(src.length);
  const n = steps + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps - 0.5;
    addShifted(acc, src, w, h, c * d * t, -s * d * t, 1 / n);
  }
  return acc;
}

/** Hash determinístico 0..1 por coordenada (o mesmo do PhotoCraft, então o ruído não depende de blocos). */
function hash01(x: number, y: number, c: number, seed: number): number {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(c, 0xcb1ab31f) ^ Math.imul(seed, 0x9e3779b9)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / (1 << 24);
}

type P = Record<string, number>;

const lumaOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Cor "reta" (alfa direto) de floats pré-multiplicados em 0..1 → ImageData. */
function straight(img: ImageData): Float32Array {
  const d = img.data;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = d[i] / 255;
  return out;
}

function fromStraight(f: Float32Array, w: number, h: number): ImageData {
  const out = new ImageData(w, h);
  for (let i = 0; i < f.length; i++) out.data[i] = Math.round(clamp01(f[i]) * 255);
  return out;
}

/** Desfoque gaussiano de cor reta: borra em pré-multiplicado e volta para alfa direto. */
function blurredStraight(img: ImageData, sigma: number, exact = true): Float32Array {
  const { width: w, height: h } = img;
  const pm = premultiply(img);
  const k = gaussianKernel(sigma);
  const blurred = exact ? convolve(pm, w, h, k, k) : gaussianBlur(pm, w, h, sigma);
  const out = new Float32Array(blurred.length);
  for (let i = 0; i < blurred.length; i += 4) {
    const a = blurred[i + 3];
    if (a > 1e-7) { out[i] = blurred[i] / a; out[i + 1] = blurred[i + 1] / a; out[i + 2] = blurred[i + 2] / a; }
    out[i + 3] = a;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------------------------

/** Executa o filtro sobre uma cópia de `img` e devolve o resultado (o original não é tocado). */
export function runFilter(id: FilterId, p: P, img: ImageData): ImageData {
  const { width: w, height: h } = img;
  switch (id) {
    case "gaussian":
      return toImageData(gaussianBlur(premultiply(img), w, h, p.radius), w, h);

    case "box": {
      const r = Math.max(0, Math.round(p.radius));
      if (r === 0) return new ImageData(new Uint8ClampedArray(img.data), w, h);
      return toImageData(boxPass(boxPass(premultiply(img), w, h, r, true), w, h, r, false), w, h);
    }

    case "motion":
      return toImageData(motionBlur(premultiply(img), w, h, p.angle, p.distance), w, h);

    case "unsharp": {
      const o = straight(img);
      const b = blurredStraight(img, p.radius);
      const amount = p.amount / 100;
      const threshold = p.threshold / 255;
      for (let i = 0; i < o.length; i += 4) {
        if (o[i + 3] <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const d = o[i + c] - b[i + c];
          if (Math.abs(d) + 1e-6 >= threshold) o[i + c] += amount * d;
        }
      }
      return fromStraight(o, w, h);
    }

    case "smart-sharpen": {
      const o = straight(img);
      const b = blurredStraight(img, p.radius);
      const k = p.amount / 100;
      const nr = clamp01(p.reduceNoise / 100);
      for (let i = 0; i < o.length; i += 4) {
        if (o[i + 3] <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const d = o[i + c] - b[i + c];
          const keep = 1 - nr * Math.exp(-Math.abs(d) * 40);
          o[i + c] += k * d * keep;
        }
      }
      return fromStraight(o, w, h);
    }

    case "high-pass": {
      const o = straight(img);
      const b = blurredStraight(img, p.radius);
      for (let i = 0; i < o.length; i += 4) {
        if (o[i + 3] <= 0) continue;
        for (let c = 0; c < 3; c++) o[i + c] = 0.5 + (o[i + c] - b[i + c]);
      }
      return fromStraight(o, w, h);
    }

    case "noise": {
      const o = straight(img);
      const a = (Math.max(p.amount, 0) / 100) * 0.5;
      const gaussian = p.dist === 1;
      const mono = p.mono === 1;
      const seed = p.seed | 0;
      for (let i = 0; i < o.length; i += 4) {
        if (o[i + 3] <= 0) continue;
        const px = (i / 4) % w;
        const py = Math.floor(i / 4 / w);
        for (let c = 0; c < 3; c++) {
          const ch = mono ? 0 : c;
          let v: number;
          if (gaussian) {
            const u1 = Math.max(hash01(px, py, ch * 2 + 101, seed), 1e-7);
            const u2 = hash01(px, py, ch * 2 + 102, seed);
            v = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * a * 0.5;
          } else {
            v = (hash01(px, py, ch, seed) - 0.5) * 2 * a;
          }
          o[i + c] += v;
        }
      }
      return fromStraight(o, w, h);
    }

    case "median": {
      const r = Math.min(10, Math.max(1, Math.round(p.radius)));
      const t = p.threshold > 0 ? p.threshold / 255 : null;
      const src = img.data;
      const out = new ImageData(new Uint8ClampedArray(src), w, h);
      // linhas do disco: meia-largura em cada dy
      const rows: number[] = [];
      for (let dy = -r; dy <= r; dy++) rows.push(Math.floor(Math.sqrt(r * r - dy * dy) + 0.5));
      const buf = new Uint8Array((2 * r + 1) * (2 * r + 1));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          for (let c = 0; c < 4; c++) {
            let n = 0;
            for (let dy = -r; dy <= r; dy++) {
              const yy = Math.min(h - 1, Math.max(0, y + dy));
              const half = rows[dy + r];
              for (let dx = -half; dx <= half; dx++) {
                const xx = Math.min(w - 1, Math.max(0, x + dx));
                buf[n++] = src[(yy * w + xx) * 4 + c];
              }
            }
            const view = buf.subarray(0, n).sort();
            const med = view[n >> 1];
            if (t === null || Math.abs(med - src[o + c]) / 255 > t) out.data[o + c] = med;
          }
        }
      }
      return out;
    }

    case "mosaic": {
      const cs = Math.max(1, Math.round(p.cell));
      const pm = premultiply(img);
      const out = new Float32Array(pm.length);
      for (let cy = 0; cy < h; cy += cs) {
        for (let cx = 0; cx < w; cx += cs) {
          const x1 = Math.min(w, cx + cs);
          const y1 = Math.min(h, cy + cs);
          let r = 0, g = 0, b = 0, a = 0;
          for (let y = cy; y < y1; y++) for (let x = cx; x < x1; x++) { const i = (y * w + x) * 4; r += pm[i]; g += pm[i + 1]; b += pm[i + 2]; a += pm[i + 3]; }
          const n = (x1 - cx) * (y1 - cy);
          r /= n; g /= n; b /= n; a /= n;
          for (let y = cy; y < y1; y++) for (let x = cx; x < x1; x++) { const i = (y * w + x) * 4; out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a; }
        }
      }
      return toImageData(out, w, h);
    }

    case "emboss": {
      const s = straight(img);
      const a = (p.angle * Math.PI) / 180;
      const height = Math.max(p.height, 1);
      const dx = Math.round(Math.cos(a) * height);
      const dy = Math.round(-Math.sin(a) * height);
      const k = p.amount / 100;
      const lumAt = (x: number, y: number) => {
        const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
        return lumaOf(s[i], s[i + 1], s[i + 2]);
      };
      const out = new Float32Array(s.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const g = clamp01(0.5 + k * (lumAt(x + dx, y + dy) - lumAt(x - dx, y - dy)));
          out[i] = out[i + 1] = out[i + 2] = g;
          out[i + 3] = s[i + 3];
        }
      }
      return fromStraight(out, w, h);
    }

    case "find-edges": {
      const s = straight(img);
      const out = new Float32Array(s.length);
      const at = (x: number, y: number, c: number) => s[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            const gx = at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - (at(x - 1, y - 1, c) + 2 * at(x - 1, y, c) + at(x - 1, y + 1, c));
            const gy = at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - (at(x - 1, y - 1, c) + 2 * at(x, y - 1, c) + at(x + 1, y - 1, c));
            out[i + c] = 1 - clamp01(Math.sqrt(gx * gx + gy * gy));
          }
          out[i + 3] = s[i + 3];
        }
      }
      return fromStraight(out, w, h);
    }

    case "solarize": {
      const out = new ImageData(new Uint8ClampedArray(img.data), w, h);
      const d = out.data;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) if (d[i + c] / 255 > 0.5) d[i + c] = 255 - d[i + c];
      return out;
    }
  }
}
