/**
 * Motor de pixels do Photosuite: registro de canvases por camada/máscara, carregamento, composição
 * (blend modes) e envio dos PNGs alterados. Os pixels ficam fora do estado React/Zustand de propósito:
 * o estado guarda só a estrutura (JSON), e este módulo guarda os canvases.
 */
import api from "@/src/services/api";
import { uploadFile as uploadFileChunked } from "@/src/services/upload.service";
import { applyAdjustment, isIdentityAdjustment } from "./adjustments";
import { blendRgb, compositePixel, NATIVE_BLEND } from "./blend";
import { rasterLayers } from "./tree";
import { DEFAULT_LIGHT, hasStyles, renderStyles, type GlobalLight, type StyledParts } from "./effects";
import { ensureTextFont, renderText } from "./text";
import { rasterizeShape } from "./vector";
import { drawTransformed, type TState } from "./transform";
import type { Layer, PhotoDoc, RasterLayer } from "./types";

/** layerId → pixels da camada; `${layerId}:mask` → máscara (valor no canal alfa). */
const pixels = new Map<string, HTMLCanvasElement>();
/** Chaves cujos pixels mudaram desde o último envio ao servidor. */
const dirty = new Set<string>();
/**
 * chave → URL do PNG no servidor. Fica fora das camadas de propósito: o histórico guarda cópias da
 * árvore, e desfazer não pode trazer de volta uma URL velha que não bate com os pixels atuais.
 */
const sources = new Map<string, string>();

/** Transformação livre em andamento: a camada é desenhada transformada, sem tocar nos pixels. */
let live: TState | null = null;
export const setLiveTransform = (t: TState | null) => {
  live = t;
};

export const sourceOf = (key: string) => sources.get(key) ?? null;

/** Versão dos pixels de cada camada: invalida o cache dos estilos quando o conteúdo muda. */
const versions = new Map<string, number>();
export const touch = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1);

let globalLight: GlobalLight = DEFAULT_LIGHT;
export const setGlobalLight = (l: GlobalLight) => {
  globalLight = l;
};
export const getGlobalLight = () => globalLight;

const styleCache = new Map<string, { key: string; parts: StyledParts }>();

export const maskKey = (layerId: string) => `${layerId}:mask`;

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export const getPixels = (key: string) => pixels.get(key);
export const setPixels = (key: string, canvas: HTMLCanvasElement) => {
  touch(key);
  return pixels.set(key, canvas);
};
export const markDirty = (key: string) => {
  touch(key);
  dirty.add(key);
};
export const isDirty = (key: string) => dirty.has(key);
export const hasDirty = () => dirty.size > 0;

export function resetEngine() {
  pixels.clear();
  dirty.clear();
  sources.clear();
  versions.clear();
  styleCache.clear();
}

/** Cópia da árvore pronta para salvar: `src` vem do registro de URLs, não do estado. */
export function serializeLayers(layers: Layer[]): Layer[] {
  return layers.map((l) => {
    if (l.type === "group") return { ...l, children: serializeLayers(l.children) };
    return {
      ...l,
      src: sources.get(l.id) ?? null,
      mask: l.mask ? { ...l.mask, src: sources.get(maskKey(l.id)) ?? null } : null,
    };
  });
}

/** Garante um canvas transparente do tamanho da camada (camadas novas, ainda sem `src`). */
export function ensureLayerCanvas(layer: RasterLayer): HTMLCanvasElement {
  let c = pixels.get(layer.id);
  if (!c) {
    c = createCanvas(layer.width, layer.height);
    pixels.set(layer.id, c);
  }
  return c;
}

/** Cria a máscara: branca (revela tudo) ou preta (esconde tudo) — no canal alfa, preto = alfa 0. */
export function createMaskCanvas(layer: RasterLayer, reveal: boolean): HTMLCanvasElement {
  const c = createCanvas(layer.width, layer.height);
  if (reveal) {
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  pixels.set(maskKey(layer.id), c);
  dirty.add(maskKey(layer.id));
  return c;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

/** URLs do S3 não têm CORS (o canvas ficaria "tainted"), então passam pelo proxy do servidor. */
function readableUrl(url: string): string {
  if (url.startsWith("/") || url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `/api/upload/proxy-image?url=${encodeURIComponent(url)}`;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${url}`));
    img.src = readableUrl(url);
  });
}

/** Cria os canvases de todas as camadas do documento a partir dos PNGs salvos (ou do `fill`). */
/**
 * Re-gera os pixels de uma camada de texto/forma a partir dos dados. Devolve o canvas e, para
 * formas, o deslocamento de rebase (os pontos já vêm no sistema do canvas, então é 0 ao carregar).
 */
export function renderVectorOrText(layer: RasterLayer): HTMLCanvasElement | null {
  if (layer.text) return renderText(layer.text).canvas;
  if (layer.shape) return rasterizeShape(layer.shape).canvas;
  return null;
}

/** Camadas cujo tamanho real (depois de re-gerar) difere do guardado: o texto muda se a fonte mudou. */
export type SizeFix = { id: string; width: number; height: number };

export async function hydrate(doc: PhotoDoc): Promise<SizeFix[]> {
  resetEngine();
  const fixes: SizeFix[] = [];
  const layers = rasterLayers(doc.layers);
  // fontes primeiro: o canvas só mede/desenha certo com a fonte carregada
  await Promise.all(layers.filter((l) => l.text).map((l) => ensureTextFont(l.text!)));
  await Promise.all(
    layers.map(async (layer) => {
      if (layer.text || layer.shape) {
        const canvas = renderVectorOrText(layer)!;
        pixels.set(layer.id, canvas);
        if (canvas.width !== layer.width || canvas.height !== layer.height) fixes.push({ id: layer.id, width: canvas.width, height: canvas.height });
        if (layer.mask) {
          if (layer.mask.src) sources.set(maskKey(layer.id), layer.mask.src);
          const m = createCanvas(canvas.width, canvas.height);
          if (layer.mask.src) m.getContext("2d")!.drawImage(await loadImage(layer.mask.src), 0, 0);
          pixels.set(maskKey(layer.id), m);
        }
        return;
      }
      if (layer.adjustment) {
        // sem pixels próprios: só a máscara (do tamanho do documento)
        if (layer.mask) {
          if (layer.mask.src) sources.set(maskKey(layer.id), layer.mask.src);
          const m = createCanvas(layer.width, layer.height);
          if (layer.mask.src) m.getContext("2d")!.drawImage(await loadImage(layer.mask.src), 0, 0);
          pixels.set(maskKey(layer.id), m);
        }
        return;
      }
      const canvas = createCanvas(layer.width, layer.height);
      const ctx = canvas.getContext("2d")!;
      if (layer.src) sources.set(layer.id, layer.src);
      if (layer.mask?.src) sources.set(maskKey(layer.id), layer.mask.src);
      if (layer.src) {
        const img = await loadImage(layer.src);
        ctx.drawImage(img, 0, 0);
      } else if (layer.fill) {
        ctx.fillStyle = layer.fill;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        dirty.add(layer.id); // o preenchimento ainda não existe como PNG no servidor
      }
      pixels.set(layer.id, canvas);
      if (layer.mask) {
        const m = createCanvas(layer.width, layer.height);
        if (layer.mask.src) m.getContext("2d")!.drawImage(await loadImage(layer.mask.src), 0, 0);
        pixels.set(maskKey(layer.id), m);
      }
    }),
  );
  return fixes;
}

// ---------------------------------------------------------------------------------------------
// Composição
// ---------------------------------------------------------------------------------------------

/** Pseudo-aleatório determinístico por pixel (Dissolve precisa dar o mesmo resultado a cada render). */
function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function compositeCpu(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, ox: number, oy: number, blend: Layer["blend"], opacity: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const rx = Math.max(0, Math.floor(ox));
  const ry = Math.max(0, Math.floor(oy));
  const rw = Math.min(W, Math.floor(ox) + src.width) - rx;
  const rh = Math.min(H, Math.floor(oy) + src.height) - ry;
  if (rw <= 0 || rh <= 0) return;

  const bd = ctx.getImageData(rx, ry, rw, rh);
  const sd = src.getContext("2d")!.getImageData(rx - Math.floor(ox), ry - Math.floor(oy), rw, rh);
  const b = bd.data;
  const s = sd.data;
  const dissolve = blend === "dissolve";

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = (y * rw + x) * 4;
      let sa = (s[i + 3] / 255) * (dissolve ? 1 : opacity);
      if (sa <= 0) continue;
      let mode = blend;
      if (dissolve) {
        // Dissolve: cobertura por pixel decide se o pixel entra inteiro ou não entra.
        if (hash01(rx + x, ry + y) >= (s[i + 3] / 255) * opacity) continue;
        sa = 1;
        mode = "normal";
      }
      const out = compositePixel(
        mode,
        [b[i] / 255, b[i + 1] / 255, b[i + 2] / 255, b[i + 3] / 255],
        [s[i] / 255, s[i + 1] / 255, s[i + 2] / 255, sa],
        1,
      );
      b[i] = Math.round(out[0] * 255);
      b[i + 1] = Math.round(out[1] * 255);
      b[i + 2] = Math.round(out[2] * 255);
      b[i + 3] = Math.round(out[3] * 255);
    }
  }
  ctx.putImageData(bd, rx, ry);
}

/** Compõe `src` sobre `ctx`: caminho nativo quando a fórmula coincide, referência CPU nos demais modos. */
export function compositeOnto(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, x: number, y: number, blend: Layer["blend"], opacity: number) {
  if (opacity <= 0) return;
  const native = NATIVE_BLEND[blend];
  if (native) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = native;
    ctx.drawImage(src, x, y);
    ctx.restore();
  } else {
    compositeCpu(ctx, src, x, y, blend === "pass-through" ? "normal" : blend, opacity);
  }
}

/** Pixels da camada com a máscara aplicada (se houver e estiver ativa). */
export function maskedSource(layer: RasterLayer): HTMLCanvasElement | null {
  const base = pixels.get(layer.id);
  if (!base) return null;
  const mask = layer.mask?.enabled ? pixels.get(maskKey(layer.id)) : null;
  if (!mask) return base;
  const tmp = createCanvas(base.width, base.height);
  const tctx = tmp.getContext("2d")!;
  tctx.drawImage(base, 0, 0);
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(mask, 0, 0);
  return tmp;
}

/**
 * Camada de ajuste: roda o ajuste sobre o que já foi composto abaixo e mistura o resultado com o
 * original por (opacidade × máscara), no modo de mesclagem da camada.
 */
function applyAdjustmentLayer(ctx: CanvasRenderingContext2D, layer: RasterLayer, W: number, H: number) {
  const adj = layer.adjustment!;
  if (isIdentityAdjustment(adj) || layer.opacity <= 0) return;
  const base = ctx.getImageData(0, 0, W, H);
  const bd = base.data;
  const adjusted = new Uint8ClampedArray(bd);
  applyAdjustment(adj, adjusted);

  let maskA: Uint8ClampedArray | null = null;
  const mask = layer.mask?.enabled ? pixels.get(maskKey(layer.id)) : null;
  if (mask) {
    const tmp = createCanvas(W, H);
    tmp.getContext("2d")!.drawImage(mask, layer.x, layer.y);
    maskA = tmp.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  }
  const mode = layer.blend === "normal" || layer.blend === "pass-through" ? null : layer.blend;
  const cb: [number, number, number] = [0, 0, 0];
  const cs: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < bd.length; i += 4) {
    if (bd[i + 3] === 0) continue;
    const w = layer.opacity * (maskA ? maskA[i + 3] / 255 : 1);
    if (w <= 0) continue;
    if (!mode) {
      bd[i] += (adjusted[i] - bd[i]) * w;
      bd[i + 1] += (adjusted[i + 1] - bd[i + 1]) * w;
      bd[i + 2] += (adjusted[i + 2] - bd[i + 2]) * w;
    } else {
      cb[0] = bd[i] / 255; cb[1] = bd[i + 1] / 255; cb[2] = bd[i + 2] / 255;
      cs[0] = adjusted[i] / 255; cs[1] = adjusted[i + 1] / 255; cs[2] = adjusted[i + 2] / 255;
      const b = blendRgb(mode, cb, cs);
      bd[i] += (b[0] * 255 - bd[i]) * w;
      bd[i + 1] += (b[1] * 255 - bd[i + 1]) * w;
      bd[i + 2] += (b[2] * 255 - bd[i + 2]) * w;
    }
  }
  ctx.putImageData(base, 0, 0);
}

/** Estilos da camada (do cache, se os pixels/parâmetros não mudaram). */
function stylesFor(layer: RasterLayer): StyledParts | null {
  const base = pixels.get(layer.id);
  if (!base || !layer.styles) return null;
  const key = `${versions.get(layer.id) ?? 0}|${base.width}x${base.height}|${JSON.stringify(layer.styles)}|${globalLight.angle},${globalLight.altitude}`;
  const hit = styleCache.get(layer.id);
  if (hit && hit.key === key) return hit.parts;
  const parts = renderStyles(base, layer.styles, globalLight);
  styleCache.set(layer.id, { key, parts });
  return parts;
}

/** A máscara da camada vale também para os efeitos; fora do canvas da máscara tudo aparece (como no Photoshop). */
function regionMask(layer: RasterLayer, margin: number, w: number, h: number): HTMLCanvasElement | null {
  const mask = layer.mask?.enabled ? pixels.get(maskKey(layer.id)) : null;
  if (!mask) return null;
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.clearRect(margin, margin, mask.width, mask.height);
  ctx.drawImage(mask, margin, margin);
  return c;
}

function drawStyled(ctx: CanvasRenderingContext2D, layer: RasterLayer, parts: StyledParts) {
  const { margin } = parts;
  const w = parts.content.width;
  const h = parts.content.height;
  const pm = regionMask(layer, margin, w, h);
  const masked = (src: HTMLCanvasElement) => {
    if (!pm) return src;
    const t = createCanvas(w, h);
    const tctx = t.getContext("2d")!;
    tctx.drawImage(src, 0, 0);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(pm, 0, 0);
    return t;
  };
  for (const b of parts.beneath) compositeOnto(ctx, masked(b.canvas), layer.x - margin, layer.y - margin, b.blend, layer.opacity);
  compositeOnto(ctx, masked(parts.content), layer.x - margin, layer.y - margin, layer.blend, layer.opacity);
}

function drawLayers(ctx: CanvasRenderingContext2D, layers: Layer[], W: number, H: number) {
  for (const layer of layers) {
    if (!layer.visible) continue;
    if (layer.type === "raster" && layer.adjustment) {
      applyAdjustmentLayer(ctx, layer, W, H);
      continue;
    }
    if (layer.type === "raster") {
      if (layer.styles && hasStyles(layer.styles) && !(live && live.layerId === layer.id)) {
        const parts = stylesFor(layer);
        if (parts) {
          drawStyled(ctx, layer, parts);
          continue;
        }
      }
      const src = maskedSource(layer);
      if (!src) continue;
      if (live && live.layerId === layer.id) {
        const iso = createCanvas(W, H);
        drawTransformed(iso.getContext("2d")!, src, live);
        compositeOnto(ctx, iso, 0, 0, layer.blend, layer.opacity);
      } else {
        compositeOnto(ctx, src, layer.x, layer.y, layer.blend, layer.opacity);
      }
      continue;
    }
    if (layer.blend === "pass-through" && layer.opacity >= 1) {
      drawLayers(ctx, layer.children, W, H);
      continue;
    }
    const iso = createCanvas(W, H);
    drawLayers(iso.getContext("2d")!, layer.children, W, H);
    compositeOnto(ctx, iso, 0, 0, layer.blend === "pass-through" ? "normal" : layer.blend, layer.opacity);
  }
}

/** Renderiza o documento inteiro em `target` (que é redimensionado para o tamanho do documento). */
export function renderDocument(doc: Pick<PhotoDoc, "width" | "height" | "layers">, target: HTMLCanvasElement) {
  if (target.width !== doc.width) target.width = doc.width;
  if (target.height !== doc.height) target.height = doc.height;
  const ctx = target.getContext("2d")!;
  ctx.clearRect(0, 0, doc.width, doc.height);
  drawLayers(ctx, doc.layers, doc.width, doc.height);
}

// ---------------------------------------------------------------------------------------------
// Persistência dos pixels
// ---------------------------------------------------------------------------------------------

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao codificar imagem"))), type, quality);
  });
}

export async function uploadBlob(blob: Blob, filename: string): Promise<string> {
  const { url } = await uploadFileChunked(blob, { filename });
  return url;
}

/**
 * Envia ao servidor os PNGs das camadas/máscaras alteradas. Devolve chave → URL; só marca como
 * limpas as chaves cujo envio deu certo (um erro deixa o resto sujo para a próxima tentativa).
 */
export async function uploadDirty(existing: Layer[]): Promise<{ urls: Map<string, string>; failed: number }> {
  const alive = new Set<string>();
  for (const l of rasterLayers(existing)) {
    // texto e formas são re-geradas dos dados; só a máscara precisa de PNG
    if (!l.text && !l.shape) alive.add(l.id);
    if (l.mask) alive.add(maskKey(l.id));
  }
  const keys = [...dirty].filter((k) => alive.has(k) && pixels.has(k));
  const urls = new Map<string, string>();
  const queue = keys.slice();

  let failed = 0;

  async function worker() {
    while (queue.length) {
      const key = queue.shift()!;
      try {
        const canvas = pixels.get(key)!;
        const url = await uploadBlob(await canvasToBlob(canvas), `${key.replace(":", "-")}.png`);
        urls.set(key, url);
        sources.set(key, url);
        dirty.delete(key);
      } catch (err) {
        console.error("Falha ao enviar camada", key, err);
        failed++;
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { urls, failed };
}
