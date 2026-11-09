import { create } from "zustand";
import { DEFAULT_BRUSH, type BrushSettings, type StrokeResult } from "@/src/lib/photosuite/brush";
import {
  cloneCanvas, createCanvas, createMaskCanvas, ensureLayerCanvas, getPixels, markDirty, maskKey,
  maskedSource, compositeOnto, renderDocument, setPixels,
} from "@/src/lib/photosuite/engine";
import {
  collectIds, findLayer, insertLayer, isDescendant, mapLayer, newId, nextLayerName, removeLayers, walk,
} from "@/src/lib/photosuite/tree";
import type { BlendMode, GroupLayer, Layer, RasterLayer } from "@/src/lib/photosuite/types";
import {
  all as selectionAll, boundsOf, blurred, combine, fromCoverage, getSelection, grow, invert as invertSelectionCanvas,
  setClip, setSelectionCanvas, type Rect, type SelMode,
} from "@/src/lib/photosuite/selection";
import { floodMask, paintGradient, lumaToAlpha, type GradientType } from "@/src/lib/photosuite/fill";
import { ADJUSTMENT_LABELS, defaultAdjustment, type Adjustment, type AdjustmentKind } from "@/src/lib/photosuite/adjustments";
import { bbox, drawTransformed, type TState } from "@/src/lib/photosuite/transform";
import { canvasToBlob, setGlobalLight, setLiveTransform } from "@/src/lib/photosuite/engine";
import { reidentify } from "@/src/lib/photosuite/formats/native";
import type { ImportResult } from "@/src/lib/photosuite/formats/types";
import { DEFAULT_LIGHT, type GlobalLight, type LayerStyles } from "@/src/lib/photosuite/effects";
import { DEFAULT_TEXT, TEXT_PAD, anchorFactor, ensureTextFont, renderText, type TextData } from "@/src/lib/photosuite/text";
import { DEFAULT_STROKE, cloneShape, deleteAnchor, mapShape, rasterizeShape, translateShape, type FillSpec, type ShapeData, type StrokeSpec } from "@/src/lib/photosuite/vector";

export type Tool =
  | "move" | "marquee" | "ellipse" | "lasso" | "wand" | "crop"
  | "brush" | "eraser" | "clone" | "bucket" | "gradient"
  | "text" | "pen" | "direct" | "shape"
  | "eyedropper" | "hand" | "zoom";

export interface DocMeta {
  isOwner: boolean;
  projectId: number | null;
  visibility: "private" | "project";
  shareToken: string | null;
}

export type ShapeKind = "rect" | "rounded" | "ellipse" | "polygon" | "star" | "line";

export interface ShapeOpts {
  kind: ShapeKind;
  radius: number;
  sides: number;
  /** raio interno da estrela / raio externo */
  starInner: number;
  fill: FillSpec | null;
  stroke: StrokeSpec | null;
}

export const DEFAULT_SHAPE_OPTS: ShapeOpts = {
  kind: "rect", radius: 24, sides: 5, starInner: 0.5, fill: { kind: "color", color: "#ec1889" }, stroke: null,
};

export type TextStyle = Omit<TextData, "text" | "box">;
const { text: _t, box: _b, ...DEFAULT_TEXT_STYLE } = DEFAULT_TEXT;
void _t; void _b;

export interface ToolOpts {
  selMode: SelMode;
  feather: number;
  wandTolerance: number;
  wandContiguous: boolean;
  wandSampleAll: boolean;
  bucketTolerance: number;
  bucketContiguous: boolean;
  bucketSampleAll: boolean;
  bucketOpacity: number;
  gradientType: GradientType;
  gradientToTransparent: boolean;
  gradientOpacity: number;
  cloneAligned: boolean;
}

export const DEFAULT_OPTS: ToolOpts = {
  selMode: "new", feather: 0,
  wandTolerance: 32, wandContiguous: true, wandSampleAll: false,
  bucketTolerance: 32, bucketContiguous: true, bucketSampleAll: false, bucketOpacity: 1,
  gradientType: "linear", gradientToTransparent: false, gradientOpacity: 1,
  cloneAligned: true,
};

/** Troca de canvas inteiro (mesclar/achatar mudam o tamanho, o que um patch de pixels não expressa). */
interface Swap {
  key: string;
  before: HTMLCanvasElement | undefined;
  after: HTMLCanvasElement | undefined;
}

interface Patch {
  key: string;
  x: number;
  y: number;
  before: ImageData;
  after: ImageData;
}

interface HistoryEntry {
  label: string;
  before: Layer[];
  after: Layer[];
  patches: Patch[];
  swaps: Swap[];
  /** Mudança de seleção (canvases imutáveis, então guardar a referência basta). */
  sel?: { before: HTMLCanvasElement | null; after: HTMLCanvasElement | null };
  /** Mudança do tamanho do documento (recortar, redimensionar, girar a tela). */
  size?: { before: { w: number; h: number }; after: { w: number; h: number } };
  /** Ajustes contínuos (slider de opacidade) com a mesma chave viram um único passo. */
  key?: string;
  at: number;
}

const HISTORY_LIMIT = 80;
const COALESCE_MS = 900;

export type ViewCommand = { id: number; type: "fit" | "actual" | "in" | "out" };

export interface ViewState {
  zoom: number;
  /** posição do canto superior esquerdo do documento dentro da viewport (px de tela) */
  x: number;
  y: number;
}

interface PhotosuiteState {
  docId: number | null;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  activeId: string | null;
  selectedIds: string[];
  /** editar os pixels da camada ou a máscara dela */
  target: "layer" | "mask";

  tool: Tool;
  fg: string;
  bg: string;
  brush: BrushSettings;
  view: ViewState;
  /** comando de zoom disparado por menu/atalho; o Viewport (que conhece o tamanho da tela) executa */
  viewCommand: ViewCommand | null;

  opts: ToolOpts;
  textStyle: TextStyle;
  /** camada de texto sendo digitada agora */
  textEdit: { id: string } | null;
  shapeOpts: ShapeOpts;
  globalLight: GlobalLight;
  /** âncoras selecionadas da camada de forma (ferramenta de seleção direta) */
  anchorSel: { id: string; items: { path: number; index: number }[] } | null;
  /** diálogo flutuante de Estilo de camada */
  styleDialogOpen: boolean;
  /** quem pode ver/editar e o link público (vem do servidor ao abrir) */
  docMeta: DocMeta;
  hasSelection: boolean;
  selectionRev: number;
  transform: TState | null;
  crop: Rect | null;

  past: HistoryEntry[];
  future: HistoryEntry[];
  /** muda a cada alteração visual — dispara a recomposição */
  revision: number;
  /** muda a cada alteração que precisa ser salva — dispara o autosave */
  changes: number;

  // ciclo de vida
  load: (init: { docId: number; name: string; width: number; height: number; layers: Layer[]; globalLight?: GlobalLight }) => void;
  reset: () => void;
  setName: (name: string) => void;

  // ferramentas / vista
  setTool: (tool: Tool) => void;
  setFg: (c: string) => void;
  setBg: (c: string) => void;
  swapColors: () => void;
  resetColors: () => void;
  setBrush: (patch: Partial<BrushSettings>) => void;
  setView: (view: Partial<ViewState>) => void;
  requestView: (type: ViewCommand["type"]) => void;
  bump: () => void;

  // seleção
  selectLayer: (id: string, additive?: boolean) => void;
  setTarget: (t: "layer" | "mask") => void;

  // camadas
  addLayer: () => string;
  addLayerFromCanvas: (canvas: HTMLCanvasElement, name: string, x?: number, y?: number) => string;
  duplicateLayer: (id?: string) => void;
  deleteSelected: () => void;
  updateLayer: (id: string, patch: Partial<Layer>, opts?: { label?: string; coalesce?: string }) => void;
  moveLayer: (id: string, targetId: string, pos: "above" | "below" | "inside") => void;
  moveLayerBy: (id: string, delta: 1 | -1) => void;
  translateLayers: (ids: string[], dx: number, dy: number) => void;
  /** Arrasto em andamento: troca a árvore sem criar passo de histórico. */
  setLayersLive: (layers: Layer[]) => void;
  /** Fecha um arrasto: `before` é a árvore de quando começou. */
  commitLive: (label: string, before: Layer[]) => void;
  groupSelected: () => void;
  ungroup: (id: string) => void;
  addMask: (id: string, reveal: boolean) => void;
  deleteMask: (id: string) => void;
  applyMask: (id: string) => void;
  mergeDown: () => void;
  flatten: () => void;
  stampVisible: () => void;

  // opções das ferramentas
  setOpts: (patch: Partial<ToolOpts>) => void;

  // seleção
  applySelection: (shape: HTMLCanvasElement | null, mode: SelMode, label: string) => void;
  selectAll: () => void;
  deselect: () => void;
  invertSelection: () => void;
  featherSelection: (r: number) => void;
  growSelection: (r: number, expand: boolean) => void;
  setSelectionLive: (c: HTMLCanvasElement) => void;
  commitSelectionMove: (before: HTMLCanvasElement | null) => void;
  magicWand: (x: number, y: number, mode: SelMode) => void;

  // preenchimento / recortes
  fillSelection: (which: "fg" | "bg") => void;
  clearSelection: () => void;
  bucketFill: (x: number, y: number) => void;
  paintGradientStroke: (p0: { x: number; y: number }, p1: { x: number; y: number }, preview: boolean) => StrokeResult | null;
  layerViaCopy: (cut: boolean) => void;
  copySelection: (opts: { merged: boolean; cut: boolean }) => void;

  // transformação livre
  startTransform: () => void;
  setTransform: (t: TState) => void;
  commitTransform: () => void;
  cancelTransform: () => void;
  flipLayer: (axis: "h" | "v") => void;
  rotateLayer: (deg: 90 | -90 | 180) => void;

  // recorte e tamanho
  setCrop: (r: Rect | null) => void;
  commitCrop: () => void;
  resizeImage: (w: number, h: number) => void;
  resizeCanvas: (w: number, h: number, ax: number, ay: number) => void;
  rotateCanvas: (kind: "cw" | "ccw" | "180") => void;
  flipCanvas: (axis: "h" | "v") => void;

  // camadas de ajuste e filtros
  addAdjustmentLayer: (kind: AdjustmentKind) => void;
  setAdjustment: (id: string, adj: Adjustment) => void;
  beginPixelEdit: () => boolean;
  previewPixelEdit: (fn: (img: ImageData) => ImageData) => void;
  commitPixelEdit: (label: string) => void;
  cancelPixelEdit: () => void;

  // texto, formas e estilos de camada
  setTextStyle: (patch: Partial<TextStyle>) => void;
  setTextEdit: (id: string | null) => void;
  addTextLayer: (x: number, y: number, box: { w: number; h: number } | null) => string;
  setText: (id: string, patch: Partial<TextData>, opts?: { label?: string; coalesce?: string }) => void;
  refreshText: () => void;
  finishTextEdit: () => void;
  setShapeOpts: (patch: Partial<ShapeOpts>) => void;
  addShapeLayer: (shapeDoc: ShapeData, name: string) => string;
  setShape: (id: string, shape: ShapeData, opts?: { label?: string; coalesce?: string }) => void;
  liveBegin: () => void;
  liveCreateShape: (shapeDoc: ShapeData, name: string) => string;
  liveUpdateShape: (id: string, shape: ShapeData) => void;
  liveCommit: (label: string) => void;
  liveCancel: () => void;
  rasterizeLayer: (id?: string) => void;
  setLayerStyles: (id: string, styles: LayerStyles | undefined, opts?: { label?: string; coalesce?: string }) => void;
  setGlobalLight: (light: GlobalLight) => void;
  setAnchorSel: (sel: PhotosuiteState["anchorSel"]) => void;
  setStyleDialogOpen: (open: boolean) => void;
  setDocMeta: (patch: Partial<DocMeta>) => void;
  /** Insere as camadas de um arquivo (PSD, SVG, .photosuite) no documento aberto, dentro de um grupo. */
  insertImport: (result: ImportResult) => void;
  deleteAnchors: () => void;

  // pixels
  commitStroke: (result: StrokeResult, key: string, label: string) => void;

  undo: () => void;
  redo: () => void;
}

const initial = {
  docId: null,
  name: "",
  width: 0,
  height: 0,
  layers: [] as Layer[],
  activeId: null as string | null,
  selectedIds: [] as string[],
  target: "layer" as const,
  past: [] as HistoryEntry[],
  future: [] as HistoryEntry[],
};

export const usePhotosuite = create<PhotosuiteState>((set, get) => {
  /** Registra uma alteração estrutural (e de pixels) como um passo do histórico. */
  function commit(
    label: string,
    layers: Layer[],
    extra: {
      patches?: Patch[]; swaps?: Swap[]; coalesce?: string; activeId?: string | null; selectedIds?: string[]; target?: "layer" | "mask";
      sel?: HistoryEntry["sel"]; size?: HistoryEntry["size"];
    } = {},
  ) {
    const s = get();
    const patches = extra.patches ?? [];
    const swaps = extra.swaps ?? [];
    const now = Date.now();
    const top = s.past[s.past.length - 1];
    let past: HistoryEntry[];
    if (extra.coalesce && top?.key === extra.coalesce && now - top.at < COALESCE_MS && !patches.length && !top.patches.length) {
      // mantém o "antes" do primeiro passo e atualiza o "depois" (inclusive dos canvases trocados)
      const merged = top.swaps.map((sw) => {
        const upd = swaps.find((n) => n.key === sw.key);
        return upd ? { ...sw, after: upd.after } : sw;
      });
      for (const n of swaps) if (!merged.some((m) => m.key === n.key)) merged.push(n);
      past = [...s.past.slice(0, -1), { ...top, after: layers, swaps: merged, at: now }];
    } else {
      past = [...s.past, { label, before: s.layers, after: layers, patches, swaps, sel: extra.sel, size: extra.size, key: extra.coalesce, at: now }].slice(-HISTORY_LIMIT);
    }
    const next: Partial<PhotosuiteState> = {
      layers,
      past,
      future: [],
      revision: s.revision + 1,
      changes: s.changes + 1,
    };
    if (extra.size) {
      next.width = extra.size.after.w;
      next.height = extra.size.after.h;
    }
    if (extra.sel) {
      next.hasSelection = !!extra.sel.after;
      next.selectionRev = s.selectionRev + 1;
    }
    if (extra.activeId !== undefined) next.activeId = extra.activeId;
    if (extra.selectedIds !== undefined) next.selectedIds = extra.selectedIds;
    if (extra.target !== undefined) next.target = extra.target;
    set(next as PhotosuiteState);
  }

  /** Pai e índice onde uma camada nova entra: logo acima da ativa. */
  function insertionPoint(): { parentId: string | null; index: number } {
    const { layers, activeId } = get();
    const found = activeId ? findLayer(layers, activeId) : null;
    if (!found) return { parentId: null, index: layers.length };
    return { parentId: found.parent?.id ?? null, index: found.index + 1 };
  }

  function rasterLayer(partial: Partial<RasterLayer> & { name: string; width: number; height: number }): RasterLayer {
    return {
      id: newId(),
      type: "raster",
      visible: true,
      locked: false,
      opacity: 1,
      blend: "normal",
      x: 0,
      y: 0,
      fill: null,
      src: null,
      mask: null,
      ...partial,
    };
  }

  /** Copia a camada (e os filhos de um grupo) com ids novos e canvases clonados. */
  function cloneLayer(layer: Layer, suffix: string): Layer {
    if (layer.type === "group") {
      return { ...layer, id: newId(), name: `${layer.name}${suffix}`, children: layer.children.map((c) => cloneLayer(c, "")) };
    }
    const copy: RasterLayer = {
      ...layer,
      id: newId(),
      name: `${layer.name}${suffix}`,
      src: null,
      mask: layer.mask ? { enabled: layer.mask.enabled, src: null } : null,
      adjustment: layer.adjustment ? structuredClone(layer.adjustment) : undefined,
      text: layer.text ? structuredClone(layer.text) : undefined,
      shape: layer.shape ? cloneShape(layer.shape) : undefined,
      styles: layer.styles ? structuredClone(layer.styles) : undefined,
    };
    const src = getPixels(layer.id);
    if (src) {
      setPixels(copy.id, cloneCanvas(src));
      markDirty(copy.id);
    }
    const m = getPixels(maskKey(layer.id));
    if (m && copy.mask) {
      setPixels(maskKey(copy.id), cloneCanvas(m));
      markDirty(maskKey(copy.id));
    }
    return copy;
  }

  function applyEntry(entry: HistoryEntry, dir: "undo" | "redo") {
    for (const sw of entry.swaps) {
      const canvas = dir === "undo" ? sw.before : sw.after;
      if (canvas) setPixels(sw.key, canvas);
      markDirty(sw.key);
    }
    for (const p of entry.patches) {
      const canvas = getPixels(p.key);
      if (!canvas) continue;
      canvas.getContext("2d")!.putImageData(dir === "undo" ? p.before : p.after, p.x, p.y);
      markDirty(p.key);
    }
  }

  function fixSelection(layers: Layer[]) {
    const { activeId, selectedIds } = get();
    const exists = (id: string | null) => !!id && !!findLayer(layers, id);
    const sel = selectedIds.filter((id) => exists(id));
    const active = exists(activeId) ? activeId : sel[sel.length - 1] ?? null;
    return { activeId: active, selectedIds: sel.length ? sel : active ? [active] : [] };
  }

  /** Renderiza `layers` achatadas num canvas do tamanho do documento. */
  function flattenToCanvas(layers: Layer[]): HTMLCanvasElement {
    const { width, height } = get();
    const out = createCanvas(width, height);
    renderDocument({ width, height, layers }, out);
    return out;
  }

  /** Seleção válida após remover camadas: a de cima que sobrou. */
  function fixSelectionFor(layers: Layer[]) {
    const top = layers[layers.length - 1];
    return { activeId: top?.id ?? null, selectedIds: top ? [top.id] : [] };
  }


  function activeRaster(): RasterLayer | null {
    const s = get();
    if (!s.activeId) return null;
    const f = findLayer(s.layers, s.activeId);
    return f && f.layer.type === "raster" ? f.layer : null;
  }

  /** Abandona edições modais (transformação/recorte), p.ex. antes de desfazer. */
  function cancelEditing() {
    if (get().transform) {
      setLiveTransform(null);
      set({ transform: null });
    }
    if (get().crop) set({ crop: null });
  }

  const lumOf = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    return (0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
  };

  /** Camada (ou máscara) em edição, se puder ser pintada. */
  function paintTarget() {
    const s = get();
    const layer = activeRaster();
    if (!layer || layer.locked || !layer.visible) return null;
    // camada de ajuste não tem pixels: só a máscara é pintável
    if (layer.adjustment && !layer.mask) return null;
    const isMask = (s.target === "mask" || !!layer.adjustment) && !!layer.mask;
    // texto/forma são re-geradas dos dados: pintar nos pixels exige rasterizar antes (a máscara pode)
    if ((layer.text || layer.shape) && !isMask) return null;
    const key = isMask ? maskKey(layer.id) : layer.id;
    const canvas = getPixels(key);
    return canvas ? { layer, key, canvas, isMask } : null;
  }

  /** Arte no espaço do documento, já recortada pela seleção. */
  function makeArt(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
    const { width: w, height: h } = get();
    const art = createCanvas(w, h);
    const actx = art.getContext("2d")!;
    draw(actx, w, h);
    const sel = getSelection();
    if (sel) {
      actx.globalCompositeOperation = "destination-in";
      actx.drawImage(sel, 0, 0);
    }
    return art;
  }

  function compositeArt(t: NonNullable<ReturnType<typeof paintTarget>>, art: HTMLCanvasElement, o: { erase?: boolean; opacity?: number; replace?: boolean }) {
    const ctx = t.canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.save();
    if (o.replace) {
      // substitui os valores sob a seleção (ou a camada toda)
      const sel = getSelection();
      ctx.globalCompositeOperation = "destination-out";
      if (sel) ctx.drawImage(sel, -t.layer.x, -t.layer.y);
      else ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(art, -t.layer.x, -t.layer.y);
    } else {
      ctx.globalAlpha = o.opacity ?? 1;
      ctx.globalCompositeOperation = o.erase ? "destination-out" : "source-over";
      ctx.drawImage(art, -t.layer.x, -t.layer.y);
    }
    ctx.restore();
  }

  /** Pinta na camada/máscara ativa dentro da seleção e registra um passo de histórico. */
  function paintActive(
    label: string,
    color: string,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number, color: string) => void,
    o: { erase?: boolean; opacity?: number } = {},
  ): boolean {
    const t = paintTarget();
    if (!t) return false;
    let erase = !!o.erase;
    let paint = color;
    if (t.isMask) {
      // Máscara: cor clara revela (branco), escura esconde (apaga).
      erase = erase || lumOf(color) < 0.5;
      paint = "#ffffff";
    }
    const ctx = t.canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, t.canvas.width, t.canvas.height);
    compositeArt(t, makeArt((c, w, h) => draw(c, w, h, paint)), { erase, opacity: o.opacity });
    const after = ctx.getImageData(0, 0, t.canvas.width, t.canvas.height);
    get().commitStroke({ rect: { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height }, before, after }, t.key, label);
    return true;
  }

  /** Pixels do documento inteiro para a varinha/balde: camada ativa (na posição dela) ou imagem final. */
  function sampleDoc(all: boolean): ImageData {
    const { width: w, height: h, layers } = get();
    const canvas = all ? flattenToCanvas(layers) : createCanvas(w, h);
    if (!all) {
      const layer = activeRaster();
      const px = layer ? getPixels(layer.id) : null;
      if (layer && px) canvas.getContext("2d")!.drawImage(px, layer.x, layer.y);
    }
    return canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h);
  }

  /** Recorta `source` (posicionado em sx,sy) pela seleção; devolve o retângulo com a seleção aplicada no alfa. */
  function extractFrom(source: HTMLCanvasElement, sx: number, sy: number) {
    const sel = getSelection();
    const r = sel ? boundsOf(sel) : { x: sx, y: sy, w: source.width, h: source.height };
    if (!r) return null;
    const x0 = Math.max(r.x, sx);
    const y0 = Math.max(r.y, sy);
    const x1 = Math.min(r.x + r.w, sx + source.width);
    const y1 = Math.min(r.y + r.h, sy + source.height);
    if (x1 <= x0 || y1 <= y0) return null;
    const out = createCanvas(x1 - x0, y1 - y0);
    const c = out.getContext("2d")!;
    c.drawImage(source, sx - x0, sy - y0);
    if (sel) {
      c.globalCompositeOperation = "destination-in";
      c.drawImage(sel, -x0, -y0);
    }
    return { canvas: out, x: x0, y: y0 };
  }

  /** Apaga da camada os pixels sob a seleção e devolve o patch para o histórico. */
  function eraseSelectionPatch(layer: RasterLayer): Patch | null {
    const canvas = getPixels(layer.id);
    const sel = getSelection();
    if (!canvas || !sel || layer.locked) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(sel, -layer.x, -layer.y);
    ctx.restore();
    markDirty(layer.id);
    return { key: layer.id, x: 0, y: 0, before, after: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  }

  /** Troca a seleção como um passo de histórico (valida vazio → nenhuma). */
  function replaceSelection(label: string, after: HTMLCanvasElement | null) {
    const before = getSelection();
    if (after && !boundsOf(after)) after = null;
    if (before === after) return;
    setSelectionCanvas(after);
    commit(label, get().layers, { sel: { before, after } });
  }

  function scaled(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
    const out = createCanvas(w, h);
    const c = out.getContext("2d")!;
    c.imageSmoothingQuality = "high";
    c.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }

  type CanvasXform = "cw" | "ccw" | "180" | "flip-h" | "flip-v";

  function xformCanvas(src: HTMLCanvasElement, kind: CanvasXform): HTMLCanvasElement {
    const { width: w, height: h } = src;
    const swap = kind === "cw" || kind === "ccw";
    const out = createCanvas(swap ? h : w, swap ? w : h);
    const c = out.getContext("2d")!;
    if (kind === "cw") { c.translate(h, 0); c.rotate(Math.PI / 2); }
    else if (kind === "ccw") { c.translate(0, w); c.rotate(-Math.PI / 2); }
    else if (kind === "180") { c.translate(w, h); c.rotate(Math.PI); }
    else if (kind === "flip-h") { c.translate(w, 0); c.scale(-1, 1); }
    else { c.translate(0, h); c.scale(1, -1); }
    c.drawImage(src, 0, 0);
    return out;
  }

  /**
   * Operação que muda o tamanho do documento e/ou todas as camadas (recorte, redimensionar, girar a tela).
   * `fn` devolve a camada nova e, se os pixels mudam, os canvases novos. A seleção é descartada.
   */
  function applyDocOp(
    label: string,
    nw: number,
    nh: number,
    fn: (l: RasterLayer) => { layer: RasterLayer; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement },
  ) {
    const s = get();
    const swaps: Swap[] = [];
    const mapAll = (ls: Layer[]): Layer[] =>
      ls.map((l) => {
        if (l.type === "group") return { ...l, children: mapAll(l.children) };
        const r = fn(l);
        if (r.canvas) {
          swaps.push({ key: l.id, before: getPixels(l.id), after: r.canvas });
          setPixels(l.id, r.canvas);
          markDirty(l.id);
        }
        if (r.mask) {
          swaps.push({ key: maskKey(l.id), before: getPixels(maskKey(l.id)), after: r.mask });
          setPixels(maskKey(l.id), r.mask);
          markDirty(maskKey(l.id));
        }
        return r.layer;
      });
    const layers = mapAll(s.layers);
    const selBefore = getSelection();
    setSelectionCanvas(null);
    commit(label, layers, {
      swaps,
      size: { before: { w: s.width, h: s.height }, after: { w: nw, h: nh } },
      sel: selBefore ? { before: selBefore, after: null } : undefined,
    });
    get().requestView("fit");
  }

  /** Camada → camada transformada por `kind` (pixels, máscara e posição), para girar/espelhar a tela. */
  function canvasOp(kind: CanvasXform) {
    const { width: ow, height: oh } = get();
    const swap = kind === "cw" || kind === "ccw";
    applyDocOp(
      kind === "cw" ? "Girar tela 90° horário" : kind === "ccw" ? "Girar tela 90° anti-horário" : kind === "180" ? "Girar tela 180°" : kind === "flip-h" ? "Espelhar tela horizontalmente" : "Espelhar tela verticalmente",
      swap ? oh : ow,
      swap ? ow : oh,
      (l) => {
        const { x, y, width: w, height: h } = l;
        let nx = x, ny = y;
        if (kind === "cw") { nx = oh - (y + h); ny = x; }
        else if (kind === "ccw") { nx = y; ny = ow - (x + w); }
        else if (kind === "180") { nx = ow - (x + w); ny = oh - (y + h); }
        else if (kind === "flip-h") nx = ow - (x + w);
        else ny = oh - (y + h);
        const canvas = getPixels(l.id);
        const mask = l.mask ? getPixels(maskKey(l.id)) : undefined;
        const out = canvas ? xformCanvas(canvas, kind) : undefined;
        return {
          layer: { ...l, x: nx, y: ny, width: out?.width ?? (swap ? h : w), height: out?.height ?? (swap ? w : h), text: undefined, shape: undefined },
          canvas: out,
          mask: mask ? xformCanvas(mask, kind) : undefined,
        };
      },
    );
  }

  /** Sessão de degradê: guarda os pixels de antes para repintar a cada movimento. */
  let grad: { key: string; before: ImageData } | null = null;


  /** Texto e forma sem se desfazer da camada: troca os pixels (e a máscara, se o tamanho mudou). */
  function swapPixels(layer: RasterLayer, canvas: HTMLCanvasElement, shiftX = 0, shiftY = 0): Swap[] {
    const track = (key: string) => {
      if (live && !live.before.has(key)) live.before.set(key, getPixels(key));
    };
    track(layer.id);
    const swaps: Swap[] = [{ key: layer.id, before: getPixels(layer.id), after: canvas }];
    setPixels(layer.id, canvas);
    const mk = maskKey(layer.id);
    const mask = layer.mask ? getPixels(mk) : null;
    if (mask && (mask.width !== canvas.width || mask.height !== canvas.height || shiftX || shiftY)) {
      // máscara acompanha o conteúdo; a área nova fica revelada
      const nm = createCanvas(canvas.width, canvas.height);
      const nctx = nm.getContext("2d")!;
      nctx.fillStyle = "#fff";
      nctx.fillRect(0, 0, nm.width, nm.height);
      nctx.clearRect(-shiftX, -shiftY, mask.width, mask.height);
      nctx.drawImage(mask, -shiftX, -shiftY);
      track(mk);
      swaps.push({ key: mk, before: mask, after: nm });
      setPixels(mk, nm);
      markDirty(mk);
    }
    return swaps;
  }

  /** Sessão "ao vivo" (caneta, formas, seleção direta): vários ajustes viram um único passo de histórico. */
  let live: { layers: Layer[]; before: Map<string, HTMLCanvasElement | undefined> } | null = null;

  /** Texto/forma na nova escala (Imagem → Tamanho da imagem): refaz a partir dos dados em vez de esticar o bitmap. */
  function resizeVector(l: RasterLayer, fx: number, fy: number): { layer: RasterLayer; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement } {
    const oldMask = l.mask ? getPixels(maskKey(l.id)) : undefined;
    if (l.text) {
      const t = l.text;
      const nt: TextData = { ...t, size: t.size * fy, leading: t.leading === null ? null : t.leading * fy, box: t.box ? { w: t.box.w * fx, h: t.box.h * fy } : null };
      const r = renderText(nt);
      const layer: RasterLayer = { ...l, text: nt, x: Math.round(l.x * fx), y: Math.round(l.y * fy), width: r.canvas.width, height: r.canvas.height };
      return { layer, canvas: r.canvas, mask: oldMask ? scaled(oldMask, layer.width, layer.height) : undefined };
    }
    const ns = mapShape(l.shape!, (x, y) => [x * fx, y * fy]);
    if (ns.stroke) ns.stroke = { ...ns.stroke, width: ns.stroke.width * ((fx + fy) / 2) };
    const r = rasterizeShape(ns);
    const layer: RasterLayer = {
      ...l,
      shape: translateShape(ns, -r.shiftX, -r.shiftY),
      x: Math.round(l.x * fx) + r.shiftX,
      y: Math.round(l.y * fy) + r.shiftY,
      width: r.canvas.width,
      height: r.canvas.height,
    };
    return { layer, canvas: r.canvas, mask: oldMask ? scaled(oldMask, layer.width, layer.height) : undefined };
  }

  const autoTextName = (t: string) => t.trim().split("\n")[0].slice(0, 40) || "Texto";

  /** Edição destrutiva com pré-visualização (filtros e ajustes aplicados aos pixels): guarda os pixels de antes. */
  let pixelEdit: { layerId: string; canvas: HTMLCanvasElement; before: ImageData; cover: Uint8ClampedArray | null } | null = null;

  return {
    ...initial,
    tool: "brush",
    fg: "#000000",
    bg: "#ffffff",
    brush: DEFAULT_BRUSH,
    view: { zoom: 1, x: 0, y: 0 },
    viewCommand: null,
    opts: DEFAULT_OPTS,
    textStyle: DEFAULT_TEXT_STYLE,
    textEdit: null,
    shapeOpts: DEFAULT_SHAPE_OPTS,
    globalLight: DEFAULT_LIGHT,
    anchorSel: null,
    styleDialogOpen: false,
    docMeta: { isOwner: true, projectId: null, visibility: "private", shareToken: null },
    hasSelection: false,
    selectionRev: 0,
    transform: null,
    crop: null,
    revision: 0,
    changes: 0,

    load: ({ docId, name, width, height, layers, globalLight }) => {
      const top = layers[layers.length - 1];
      setGlobalLight(globalLight ?? DEFAULT_LIGHT);
      set({
        ...initial,
        textEdit: null,
        globalLight: globalLight ?? DEFAULT_LIGHT,
        docId, name, width, height, layers,
        activeId: top?.id ?? null,
        selectedIds: top ? [top.id] : [],
        revision: get().revision + 1,
        changes: 0,
      });
    },
    reset: () => set({ ...initial, revision: get().revision + 1, changes: 0 }),
    setName: (name) => set({ name, changes: get().changes + 1 }),

    setTool: (tool) => set({ tool }),
    setFg: (fg) => set({ fg }),
    setBg: (bg) => set({ bg }),
    swapColors: () => set({ fg: get().bg, bg: get().fg }),
    resetColors: () => set({ fg: "#000000", bg: "#ffffff" }),
    setBrush: (patch) => set({ brush: { ...get().brush, ...patch } }),
    setView: (view) => set({ view: { ...get().view, ...view } }),
    requestView: (type) => set({ viewCommand: { id: (get().viewCommand?.id ?? 0) + 1, type } }),
    bump: () => set({ revision: get().revision + 1 }),

    selectLayer: (id, additive) => {
      const { selectedIds } = get();
      if (additive) {
        const has = selectedIds.includes(id);
        const next = has ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
        set({ selectedIds: next, activeId: has ? next[next.length - 1] ?? null : id, target: "layer" });
      } else {
        set({ selectedIds: [id], activeId: id, target: "layer" });
      }
    },
    setTarget: (target) => set({ target }),

    addLayer: () => {
      const { layers, width, height } = get();
      const layer = rasterLayer({ name: nextLayerName(layers), width, height });
      ensureLayerCanvas(layer);
      const { parentId, index } = insertionPoint();
      commit("Nova camada", insertLayer(layers, layer, parentId, index), { activeId: layer.id, selectedIds: [layer.id], target: "layer" });
      return layer.id;
    },

    addLayerFromCanvas: (canvas, name, x = 0, y = 0) => {
      const { layers } = get();
      const layer = rasterLayer({ name, width: canvas.width, height: canvas.height, x, y });
      setPixels(layer.id, canvas);
      markDirty(layer.id);
      const { parentId, index } = insertionPoint();
      commit(name, insertLayer(layers, layer, parentId, index), { activeId: layer.id, selectedIds: [layer.id], target: "layer" });
      return layer.id;
    },

    duplicateLayer: (id) => {
      const { layers, activeId } = get();
      const target = id ?? activeId;
      const found = target ? findLayer(layers, target) : null;
      if (!found) return;
      const copy = cloneLayer(found.layer, " cópia");
      commit("Duplicar camada", insertLayer(layers, copy, found.parent?.id ?? null, found.index + 1), { activeId: copy.id, selectedIds: [copy.id] });
    },

    deleteSelected: () => {
      const { layers, selectedIds } = get();
      if (!selectedIds.length) return;
      const next = removeLayers(layers, new Set(selectedIds));
      commit(selectedIds.length > 1 ? "Excluir camadas" : "Excluir camada", next, fixSelectionFor(next));
    },

    updateLayer: (id, patch, opts) => {
      const { layers } = get();
      commit(opts?.label ?? "Propriedades da camada", mapLayer(layers, id, (l) => ({ ...l, ...patch }) as Layer), { coalesce: opts?.coalesce });
    },

    moveLayer: (id, targetId, pos) => {
      const { layers } = get();
      if (id === targetId) return;
      const moving = findLayer(layers, id);
      if (!moving) return;
      if (isDescendant(layers, id, targetId)) return;
      const without = removeLayers(layers, new Set([id]));
      const target = findLayer(without, targetId);
      if (!target) return;
      let parentId: string | null;
      let index: number;
      if (pos === "inside" && target.layer.type === "group") {
        parentId = target.layer.id;
        index = target.layer.children.length;
      } else {
        parentId = target.parent?.id ?? null;
        index = pos === "above" ? target.index + 1 : target.index;
      }
      commit("Mover camada", insertLayer(without, moving.layer, parentId, index));
    },

    moveLayerBy: (id, delta) => {
      const { layers } = get();
      const found = findLayer(layers, id);
      if (!found) return;
      const to = found.index + delta;
      if (to < 0 || to >= found.siblings.length) return;
      const without = removeLayers(layers, new Set([id]));
      commit(delta > 0 ? "Trazer para frente" : "Enviar para trás", insertLayer(without, found.layer, found.parent?.id ?? null, to));
    },

    translateLayers: (ids, dx, dy) => {
      if (!dx && !dy) return;
      const { layers } = get();
      // Mover um grupo move todos os descendentes.
      const expanded = new Set<string>();
      for (const id of ids) {
        const f = findLayer(layers, id);
        if (f) collectIds(f.layer).forEach((x) => expanded.add(x));
      }
      const apply = (ls: Layer[]): Layer[] =>
        ls.map((l) => {
          if (l.type === "group") return { ...l, children: apply(l.children) };
          return expanded.has(l.id) && !l.adjustment ? { ...l, x: l.x + dx, y: l.y + dy } : l;
        });
      commit("Mover", apply(layers));
    },

    setLayersLive: (layers) => set({ layers, revision: get().revision + 1 }),

    commitLive: (label, before) => {
      const s = get();
      if (s.layers === before) return;
      set({
        past: [...s.past, { label, before, after: s.layers, patches: [], swaps: [], at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
        changes: s.changes + 1,
      });
    },

    groupSelected: () => {
      const { layers, selectedIds } = get();
      if (!selectedIds.length) return;
      const first = findLayer(layers, selectedIds[0]);
      if (!first) return;
      const members = first.siblings.filter((l) => selectedIds.includes(l.id));
      if (!members.length) return;
      const group: GroupLayer = {
        id: newId(), type: "group", name: nextLayerName(layers, "Grupo"), visible: true, locked: false,
        opacity: 1, blend: "pass-through", collapsed: false, children: members,
      };
      const lowest = Math.min(...members.map((m) => first.siblings.indexOf(m)));
      const without = removeLayers(layers, new Set(members.map((m) => m.id)));
      commit("Agrupar camadas", insertLayer(without, group, first.parent?.id ?? null, lowest), { activeId: group.id, selectedIds: [group.id] });
    },

    ungroup: (id) => {
      const { layers } = get();
      const found = findLayer(layers, id);
      if (!found || found.layer.type !== "group") return;
      const children = found.layer.children;
      let next = removeLayers(layers, new Set([id]));
      children.forEach((c, i) => {
        next = insertLayer(next, c, found.parent?.id ?? null, found.index + i);
      });
      commit("Desagrupar", next, { activeId: children[children.length - 1]?.id ?? null, selectedIds: children.map((c) => c.id) });
    },

    addMask: (id, reveal) => {
      const { layers } = get();
      const found = findLayer(layers, id);
      if (!found || found.layer.type !== "raster" || found.layer.mask) return;
      createMaskCanvas(found.layer, reveal);
      commit("Adicionar máscara", mapLayer(layers, id, (l) => ({ ...l, mask: { src: null, enabled: true } }) as Layer), { target: "mask" });
    },

    deleteMask: (id) => {
      const { layers } = get();
      commit("Excluir máscara", mapLayer(layers, id, (l) => ({ ...l, mask: null }) as Layer), { target: "layer" });
    },

    applyMask: (id) => {
      const { layers } = get();
      const found = findLayer(layers, id);
      if (!found || found.layer.type !== "raster" || !found.layer.mask) return;
      const layer = found.layer;
      const canvas = getPixels(layer.id);
      const mask = getPixels(maskKey(layer.id));
      if (!canvas || !mask) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (layer.mask.enabled) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(mask, 0, 0);
        ctx.restore();
      }
      const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
      markDirty(layer.id);
      commit("Aplicar máscara", mapLayer(layers, id, (l) => ({ ...l, mask: null }) as Layer), {
        patches: [{ key: layer.id, x: 0, y: 0, before, after }],
        target: "layer",
      });
    },

    mergeDown: () => {
      const { layers, activeId } = get();
      const found = activeId ? findLayer(layers, activeId) : null;
      if (!found || found.layer.type !== "raster" || found.index === 0) return;
      const lower = found.siblings[found.index - 1];
      if (lower.type !== "raster" || lower.adjustment || found.layer.adjustment) return;
      const upper = found.layer;

      const x0 = Math.min(lower.x, upper.x);
      const y0 = Math.min(lower.y, upper.y);
      const x1 = Math.max(lower.x + lower.width, upper.x + upper.width);
      const y1 = Math.max(lower.y + lower.height, upper.y + upper.height);
      const out = createCanvas(x1 - x0, y1 - y0);
      const ctx = out.getContext("2d")!;
      const lowerSrc = maskedSource(lower);
      if (lowerSrc) ctx.drawImage(lowerSrc, lower.x - x0, lower.y - y0);
      const upperSrc = upper.visible ? maskedSource(upper) : null;
      if (upperSrc) compositeOnto(ctx, upperSrc, upper.x - x0, upper.y - y0, upper.blend, upper.opacity);

      const swaps: Swap[] = [{ key: lower.id, before: getPixels(lower.id), after: out }];
      if (lower.mask) swaps.push({ key: maskKey(lower.id), before: getPixels(maskKey(lower.id)), after: undefined });
      setPixels(lower.id, out);
      markDirty(lower.id);

      const merged: RasterLayer = { ...lower, x: x0, y: y0, width: out.width, height: out.height, mask: null, src: null, text: undefined, shape: undefined, styles: undefined };
      let next = mapLayer(layers, lower.id, () => merged);
      next = removeLayers(next, new Set([upper.id]));
      commit("Mesclar para baixo", next, { swaps, activeId: merged.id, selectedIds: [merged.id], target: "layer" });
    },

    flatten: () => {
      const { layers, width, height } = get();
      if (!layers.length) return;
      const out = flattenToCanvas(layers);
      const swaps: Swap[] = [];
      walk(layers, (l) => {
        if (l.type === "raster") {
          swaps.push({ key: l.id, before: getPixels(l.id), after: undefined });
          if (l.mask) swaps.push({ key: maskKey(l.id), before: getPixels(maskKey(l.id)), after: undefined });
        }
      });
      const bg = rasterLayer({ name: "Fundo", width, height });
      swaps.push({ key: bg.id, before: undefined, after: out });
      setPixels(bg.id, out);
      markDirty(bg.id);
      commit("Achatar imagem", [bg], { swaps, activeId: bg.id, selectedIds: [bg.id], target: "layer" });
    },

    stampVisible: () => {
      const { layers } = get();
      const out = flattenToCanvas(layers);
      const { width, height } = get();
      const layer = rasterLayer({ name: nextLayerName(layers, "Carimbo"), width, height });
      setPixels(layer.id, out);
      markDirty(layer.id);
      commit("Carimbar visível", insertLayer(layers, layer, null, layers.length), { swaps: [{ key: layer.id, before: undefined, after: out }], activeId: layer.id, selectedIds: [layer.id], target: "layer" });
    },

    commitStroke: (result, key, label) => {
      markDirty(key);
      commit(label, get().layers, { patches: [{ key, x: result.rect.x, y: result.rect.y, before: result.before, after: result.after }] });
    },

    setOpts: (patch) => set({ opts: { ...get().opts, ...patch } }),

    // ---------------------------------------------------------------- seleção
    applySelection: (shape, mode, label) => {
      const before = getSelection();
      replaceSelection(label, shape === null ? null : combine(before, shape, mode));
    },
    selectAll: () => {
      const { width, height } = get();
      if (width) replaceSelection("Selecionar tudo", selectionAll(width, height));
    },
    deselect: () => replaceSelection("Desmarcar", null),
    invertSelection: () => {
      const b = getSelection();
      if (b) replaceSelection("Inverter seleção", invertSelectionCanvas(b));
    },
    featherSelection: (r) => {
      const b = getSelection();
      if (b && r > 0) replaceSelection("Suavizar seleção", blurred(b, r));
    },
    growSelection: (r, expand) => {
      const b = getSelection();
      if (b && r > 0) replaceSelection(expand ? "Expandir seleção" : "Contrair seleção", grow(b, Math.min(r, 200), expand));
    },
    setSelectionLive: (c) => {
      setSelectionCanvas(c);
      set({ hasSelection: true, selectionRev: get().selectionRev + 1 });
    },
    commitSelectionMove: (before) => {
      const after = getSelection();
      if (before === after) return;
      commit("Mover seleção", get().layers, { sel: { before, after } });
    },
    magicWand: (x, y, mode) => {
      const { opts, width, height } = get();
      const mask = floodMask(sampleDoc(opts.wandSampleAll), x, y, opts.wandTolerance, opts.wandContiguous);
      if (!mask) return;
      let shape = fromCoverage(width, height, mask);
      if (opts.feather > 0) shape = blurred(shape, opts.feather);
      get().applySelection(shape, mode, "Varinha mágica");
    },

    // -------------------------------------------------------- preencher / copiar
    fillSelection: (which) => {
      const s = get();
      const color = which === "fg" ? s.fg : s.bg;
      paintActive(which === "fg" ? "Preencher com a cor de frente" : "Preencher com a cor de fundo", color, (c, w, h, col) => {
        c.fillStyle = col;
        c.fillRect(0, 0, w, h);
      });
    },
    clearSelection: () => {
      if (!getSelection()) return;
      paintActive("Limpar", "#000000", (c, w, h) => c.fillRect(0, 0, w, h), { erase: true });
    },
    bucketFill: (x, y) => {
      const s = get();
      const mask = floodMask(sampleDoc(s.opts.bucketSampleAll), x, y, s.opts.bucketTolerance, s.opts.bucketContiguous);
      if (!mask) return;
      const cover = fromCoverage(s.width, s.height, mask);
      paintActive(
        "Balde de tinta",
        s.fg,
        (c, w, h, col) => {
          c.drawImage(cover, 0, 0);
          c.globalCompositeOperation = "source-in";
          c.fillStyle = col;
          c.fillRect(0, 0, w, h);
        },
        { opacity: s.opts.bucketOpacity },
      );
    },
    paintGradientStroke: (p0, p1, preview) => {
      const t = paintTarget();
      if (!t) return null;
      const s = get();
      const ctx = t.canvas.getContext("2d", { willReadFrequently: true })!;
      if (!grad || grad.key !== t.key) grad = { key: t.key, before: ctx.getImageData(0, 0, t.canvas.width, t.canvas.height) };
      ctx.putImageData(grad.before, 0, 0);
      const zero = Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1;
      if (!zero) {
        const art = makeArt((c, w, h) => {
          paintGradient(c, w, h, s.opts.gradientType, p0, p1, s.fg, s.bg, s.opts.gradientToTransparent);
          if (t.isMask) lumaToAlpha(c, w, h);
        });
        compositeArt(t, art, { replace: t.isMask, opacity: s.opts.gradientOpacity });
      }
      set({ revision: s.revision + 1 });
      if (preview) return null;
      const before = grad.before;
      grad = null;
      if (zero) return null;
      const result: StrokeResult = {
        rect: { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height },
        before,
        after: ctx.getImageData(0, 0, t.canvas.width, t.canvas.height),
      };
      get().commitStroke(result, t.key, "Degradê");
      return result;
    },
    layerViaCopy: (cut) => {
      const layer = activeRaster();
      if (!layer) return;
      if (!getSelection()) {
        if (!cut) get().duplicateLayer();
        return;
      }
      const src = maskedSource(layer) ?? getPixels(layer.id);
      const ex = src ? extractFrom(src, layer.x, layer.y) : null;
      if (!ex) return;
      const patch = cut ? eraseSelectionPatch(layer) : null;
      const { layers } = get();
      const fresh = rasterLayer({ name: nextLayerName(layers), width: ex.canvas.width, height: ex.canvas.height, x: ex.x, y: ex.y });
      setPixels(fresh.id, ex.canvas);
      markDirty(fresh.id);
      const { parentId, index } = insertionPoint();
      commit(cut ? "Camada via recorte" : "Camada via cópia", insertLayer(layers, fresh, parentId, index), {
        patches: patch ? [patch] : [],
        activeId: fresh.id,
        selectedIds: [fresh.id],
        target: "layer",
      });
    },
    copySelection: ({ merged, cut }) => {
      const s = get();
      const layer = activeRaster();
      let ex: ReturnType<typeof extractFrom> = null;
      if (merged) ex = extractFrom(flattenToCanvas(s.layers), 0, 0);
      else if (layer) {
        const src = maskedSource(layer) ?? getPixels(layer.id);
        ex = src ? extractFrom(src, layer.x, layer.y) : null;
      }
      if (!ex) return;
      setClip({ canvas: ex.canvas, x: ex.x, y: ex.y });
      // o clipboard do sistema deixa colar em outros apps; falhar (sem permissão/HTTP) não é problema
      void canvasToBlob(ex.canvas)
        .then((b) => navigator.clipboard?.write?.([new ClipboardItem({ "image/png": b })]))
        .catch(() => {});
      if (cut && layer && getSelection()) {
        const patch = eraseSelectionPatch(layer);
        if (patch) get().commitStroke({ rect: { x: 0, y: 0, w: patch.before.width, h: patch.before.height }, before: patch.before, after: patch.after }, layer.id, "Recortar");
      }
    },

    // --------------------------------------------------------- transformação livre
    startTransform: () => {
      const layer = activeRaster();
      if (!layer || layer.locked || layer.adjustment || get().transform) return;
      const t: TState = { layerId: layer.id, w: layer.width, h: layer.height, cx: layer.x + layer.width / 2, cy: layer.y + layer.height / 2, sx: 1, sy: 1, rot: 0 };
      setLiveTransform(t);
      set({ transform: t, revision: get().revision + 1 });
    },
    setTransform: (t) => {
      setLiveTransform(t);
      set({ transform: t, revision: get().revision + 1 });
    },
    cancelTransform: () => {
      setLiveTransform(null);
      set({ transform: null, revision: get().revision + 1 });
    },
    commitTransform: () => {
      const t = get().transform;
      if (!t) return;
      const found = findLayer(get().layers, t.layerId);
      const layer = found?.layer.type === "raster" ? found.layer : null;
      const canvas = layer ? getPixels(layer.id) : null;
      if (!layer || !canvas) return get().cancelTransform();
      const identity = t.sx === 1 && t.sy === 1 && t.rot === 0 && Math.abs(t.cx - (layer.x + layer.width / 2)) < 1e-6 && Math.abs(t.cy - (layer.y + layer.height / 2)) < 1e-6;
      const bb = bbox(t);
      if (identity || bb.w * bb.h > 120_000_000) return get().cancelTransform();

      if (layer.shape) {
        // formas continuam editáveis: os pontos são transformados e a forma é re-rasterizada
        const cosr = Math.cos(t.rot);
        const sinr = Math.sin(t.rot);
        const f = (x: number, y: number): [number, number] => {
          const u = (x - layer.width / 2) * t.sx;
          const v = (y - layer.height / 2) * t.sy;
          return [t.cx + u * cosr - v * sinr, t.cy + u * sinr + v * cosr];
        };
        const docShape = mapShape(layer.shape, f);
        if (docShape.stroke) docShape.stroke = { ...docShape.stroke, width: docShape.stroke.width * Math.sqrt(Math.abs(t.sx * t.sy)) };
        const r = rasterizeShape(docShape);
        const swaps: Swap[] = [{ key: layer.id, before: canvas, after: r.canvas }];
        setPixels(layer.id, r.canvas);
        const mask = layer.mask ? getPixels(maskKey(layer.id)) : null;
        if (mask) {
          const mout = createCanvas(r.canvas.width, r.canvas.height);
          drawTransformed(mout.getContext("2d")!, mask, t, r.shiftX, r.shiftY);
          swaps.push({ key: maskKey(layer.id), before: mask, after: mout });
          setPixels(maskKey(layer.id), mout);
          markDirty(maskKey(layer.id));
        }
        setLiveTransform(null);
        set({ transform: null });
        commit(
          "Transformação livre",
          mapLayer(get().layers, layer.id, (l) => ({ ...l, x: r.shiftX, y: r.shiftY, width: r.canvas.width, height: r.canvas.height, shape: translateShape(docShape, -r.shiftX, -r.shiftY) }) as Layer),
          { swaps },
        );
        return;
      }

      const render = (src: HTMLCanvasElement) => {
        const out = createCanvas(bb.w, bb.h);
        drawTransformed(out.getContext("2d")!, src, t, bb.x, bb.y);
        return out;
      };
      const swaps: Swap[] = [];
      const out = render(canvas);
      swaps.push({ key: layer.id, before: canvas, after: out });
      setPixels(layer.id, out);
      markDirty(layer.id);
      const mask = layer.mask ? getPixels(maskKey(layer.id)) : null;
      if (mask) {
        const mout = render(mask);
        swaps.push({ key: maskKey(layer.id), before: mask, after: mout });
        setPixels(maskKey(layer.id), mout);
        markDirty(maskKey(layer.id));
      }
      setLiveTransform(null);
      set({ transform: null });
      commit("Transformação livre", mapLayer(get().layers, layer.id, (l) => ({ ...l, x: bb.x, y: bb.y, width: out.width, height: out.height, text: undefined, shape: undefined }) as Layer), { swaps });
    },
    flipLayer: (axis) => {
      get().startTransform();
      const t = get().transform;
      if (!t) return;
      get().setTransform(axis === "h" ? { ...t, sx: -t.sx } : { ...t, sy: -t.sy });
      get().commitTransform();
    },
    rotateLayer: (deg) => {
      get().startTransform();
      const t = get().transform;
      if (!t) return;
      get().setTransform({ ...t, rot: t.rot + (deg * Math.PI) / 180 });
      get().commitTransform();
    },

    // ------------------------------------------------------------ recorte e tamanho
    setCrop: (r) => set({ crop: r }),
    commitCrop: () => {
      const c = get().crop;
      if (!c) return;
      const x = Math.round(c.x);
      const y = Math.round(c.y);
      const w = Math.max(1, Math.round(c.w));
      const h = Math.max(1, Math.round(c.h));
      const { width, height } = get();
      set({ crop: null });
      if (x === 0 && y === 0 && w === width && h === height) return;
      applyDocOp("Recortar", w, h, (l) => ({ layer: { ...l, x: l.x - x, y: l.y - y } }));
    },
    resizeImage: (w, h) => {
      const { width: ow, height: oh } = get();
      w = Math.max(1, Math.min(16000, Math.round(w)));
      h = Math.max(1, Math.min(16000, Math.round(h)));
      if (w === ow && h === oh) return;
      const fx = w / ow;
      const fy = h / oh;
      applyDocOp("Tamanho da imagem", w, h, (l) => {
        if (l.text || l.shape) return resizeVector(l, fx, fy);
        const nw = Math.max(1, Math.round(l.width * fx));
        const nh = Math.max(1, Math.round(l.height * fy));
        const canvas = getPixels(l.id);
        const mask = l.mask ? getPixels(maskKey(l.id)) : undefined;
        return {
          layer: { ...l, x: Math.round(l.x * fx), y: Math.round(l.y * fy), width: nw, height: nh },
          canvas: canvas ? scaled(canvas, nw, nh) : undefined,
          mask: mask ? scaled(mask, nw, nh) : undefined,
        };
      });
    },
    resizeCanvas: (w, h, ax, ay) => {
      const { width: ow, height: oh } = get();
      w = Math.max(1, Math.min(16000, Math.round(w)));
      h = Math.max(1, Math.min(16000, Math.round(h)));
      if (w === ow && h === oh) return;
      const dx = Math.round((w - ow) * ax);
      const dy = Math.round((h - oh) * ay);
      applyDocOp("Tamanho da tela", w, h, (l) => ({ layer: { ...l, x: l.x + dx, y: l.y + dy } }));
    },
    rotateCanvas: (kind) => canvasOp(kind),
    flipCanvas: (axis) => canvasOp(axis === "h" ? "flip-h" : "flip-v"),

    addAdjustmentLayer: (kind) => {
      const { layers, width, height } = get();
      const layer = rasterLayer({
        name: ADJUSTMENT_LABELS[kind],
        width,
        height,
        adjustment: defaultAdjustment(kind),
        mask: { src: null, enabled: true },
      });
      createMaskCanvas(layer, true);
      const { parentId, index } = insertionPoint();
      commit("Nova camada de ajuste", insertLayer(layers, layer, parentId, index), { activeId: layer.id, selectedIds: [layer.id], target: "mask" });
    },
    setAdjustment: (id, adj) => {
      get().updateLayer(id, { adjustment: adj } as Partial<Layer>, { label: `Ajuste: ${ADJUSTMENT_LABELS[adj.kind]}`, coalesce: `adj-${id}` });
    },
    beginPixelEdit: () => {
      const layer = activeRaster();
      if (!layer || layer.locked || layer.adjustment || layer.text || layer.shape || !layer.visible) return false;
      const canvas = getPixels(layer.id);
      if (!canvas) return false;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let cover: Uint8ClampedArray | null = null;
      const sel = getSelection();
      if (sel) {
        const tmp = createCanvas(canvas.width, canvas.height);
        tmp.getContext("2d")!.drawImage(sel, -layer.x, -layer.y);
        cover = tmp.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      pixelEdit = { layerId: layer.id, canvas, before, cover };
      return true;
    },
    previewPixelEdit: (fn) => {
      if (!pixelEdit) return;
      const { canvas, before, cover } = pixelEdit;
      const input = new ImageData(new Uint8ClampedArray(before.data), before.width, before.height);
      const result = fn(input);
      if (cover) {
        // fora da seleção fica o original; nas bordas suaves, mistura
        const b = before.data;
        const r = result.data;
        for (let i = 0; i < r.length; i += 4) {
          const w = cover[i + 3] / 255;
          if (w >= 1) continue;
          r[i] = b[i] + (r[i] - b[i]) * w;
          r[i + 1] = b[i + 1] + (r[i + 1] - b[i + 1]) * w;
          r[i + 2] = b[i + 2] + (r[i + 2] - b[i + 2]) * w;
          r[i + 3] = b[i + 3] + (r[i + 3] - b[i + 3]) * w;
        }
      }
      canvas.getContext("2d")!.putImageData(result, 0, 0);
      set({ revision: get().revision + 1 });
    },
    commitPixelEdit: (label) => {
      if (!pixelEdit) return;
      const { layerId, canvas, before } = pixelEdit;
      pixelEdit = null;
      const after = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
      get().commitStroke({ rect: { x: 0, y: 0, w: canvas.width, h: canvas.height }, before, after }, layerId, label);
    },
    cancelPixelEdit: () => {
      if (!pixelEdit) return;
      const { canvas, before } = pixelEdit;
      pixelEdit = null;
      canvas.getContext("2d")!.putImageData(before, 0, 0);
      set({ revision: get().revision + 1 });
    },

    // ----------------------------------------------------------- texto / formas / estilos
    setTextStyle: (patch) => set({ textStyle: { ...get().textStyle, ...patch } }),
    setTextEdit: (id) => set({ textEdit: id ? { id } : null }),

    addTextLayer: (x, y, box) => {
      const s = get();
      const data: TextData = { ...DEFAULT_TEXT, ...s.textStyle, color: s.fg, text: "", box };
      const r = renderText(data);
      const layer = rasterLayer({
        name: "Texto",
        x: Math.round(x - TEXT_PAD),
        y: Math.round(y - TEXT_PAD),
        width: r.canvas.width,
        height: r.canvas.height,
        text: data,
      });
      setPixels(layer.id, r.canvas);
      const { parentId, index } = insertionPoint();
      commit("Texto", insertLayer(s.layers, layer, parentId, index), {
        swaps: [{ key: layer.id, before: undefined, after: r.canvas }],
        activeId: layer.id,
        selectedIds: [layer.id],
        target: "layer",
      });
      set({ textEdit: { id: layer.id } });
      void ensureTextFont(data).then((fresh) => fresh && get().refreshText());
      return layer.id;
    },

    setText: (id, patch, opts) => {
      const found = findLayer(get().layers, id);
      if (!found || found.layer.type !== "raster" || !found.layer.text) return;
      const layer = found.layer;
      const prev = layer.text!;
      const next: TextData = { ...prev, ...patch };
      const r = renderText(next);
      // texto de ponto alinhado ao centro/direita cresce para os dois lados / para a esquerda
      const x = next.box ? layer.x : layer.x + Math.round((layer.width - r.canvas.width) * anchorFactor(next.align));
      const name = layer.name === autoTextName(prev.text) ? autoTextName(next.text) : layer.name;
      const swaps = swapPixels(layer, r.canvas);
      commit(opts?.label ?? "Texto", mapLayer(get().layers, id, (l) => ({ ...l, text: next, x, name, width: r.canvas.width, height: r.canvas.height }) as Layer), {
        swaps,
        coalesce: opts?.coalesce,
      });
      void ensureTextFont(next).then((fresh) => fresh && get().refreshText());
    },

    /** Redesenha todas as camadas de texto (uma fonte acabou de carregar) sem criar passo de histórico. */
    refreshText: () => {
      let changed = false;
      const redo = (ls: Layer[]): Layer[] =>
        ls.map((l) => {
          if (l.type === "group") return { ...l, children: redo(l.children) };
          if (!l.text) return l;
          const r = renderText(l.text);
          setPixels(l.id, r.canvas);
          changed = true;
          return r.canvas.width === l.width && r.canvas.height === l.height ? l : { ...l, width: r.canvas.width, height: r.canvas.height };
        });
      const layers = redo(get().layers);
      if (changed) set({ layers, revision: get().revision + 1 });
    },

    finishTextEdit: () => {
      const te = get().textEdit;
      if (!te) return;
      set({ textEdit: null });
      const found = findLayer(get().layers, te.id);
      if (!found || found.layer.type !== "raster" || !found.layer.text) return;
      if (found.layer.text.text.trim() === "") {
        const next = removeLayers(get().layers, new Set([te.id]));
        commit("Excluir camada", next, fixSelectionFor(next));
      }
    },

    setShapeOpts: (patch) => set({ shapeOpts: { ...get().shapeOpts, ...patch } }),

    addShapeLayer: (shapeDoc, name) => {
      const { layers } = get();
      const r = rasterizeShape(shapeDoc);
      const layer = rasterLayer({
        name: nextLayerName(layers, name),
        x: r.shiftX,
        y: r.shiftY,
        width: r.canvas.width,
        height: r.canvas.height,
        shape: translateShape(shapeDoc, -r.shiftX, -r.shiftY),
      });
      setPixels(layer.id, r.canvas);
      const { parentId, index } = insertionPoint();
      commit(name, insertLayer(layers, layer, parentId, index), {
        swaps: [{ key: layer.id, before: undefined, after: r.canvas }],
        activeId: layer.id,
        selectedIds: [layer.id],
        target: "layer",
      });
      return layer.id;
    },

    setShape: (id, shape, opts) => {
      const found = findLayer(get().layers, id);
      if (!found || found.layer.type !== "raster") return;
      const layer = found.layer;
      const r = rasterizeShape(shape);
      const swaps = swapPixels(layer, r.canvas, r.shiftX, r.shiftY);
      commit(
        opts?.label ?? "Forma",
        mapLayer(get().layers, id, (l) => ({
          ...l,
          shape: translateShape(shape, -r.shiftX, -r.shiftY),
          x: layer.x + r.shiftX,
          y: layer.y + r.shiftY,
          width: r.canvas.width,
          height: r.canvas.height,
        }) as Layer),
        { swaps, coalesce: opts?.coalesce },
      );
    },

    liveBegin: () => {
      live = { layers: get().layers, before: new Map() };
    },

    liveCreateShape: (shapeDoc, name) => {
      if (!live) live = { layers: get().layers, before: new Map() };
      const { layers } = get();
      const r = rasterizeShape(shapeDoc);
      const layer = rasterLayer({
        name: nextLayerName(layers, name),
        x: r.shiftX,
        y: r.shiftY,
        width: r.canvas.width,
        height: r.canvas.height,
        shape: translateShape(shapeDoc, -r.shiftX, -r.shiftY),
      });
      live.before.set(layer.id, undefined);
      setPixels(layer.id, r.canvas);
      const { parentId, index } = insertionPoint();
      set({ layers: insertLayer(layers, layer, parentId, index), activeId: layer.id, selectedIds: [layer.id], target: "layer", revision: get().revision + 1 });
      return layer.id;
    },

    liveUpdateShape: (id, shape) => {
      const found = findLayer(get().layers, id);
      if (!found || found.layer.type !== "raster") return;
      const layer = found.layer;
      const r = rasterizeShape(shape);
      swapPixels(layer, r.canvas, r.shiftX, r.shiftY);
      set({
        layers: mapLayer(get().layers, id, (l) => ({
          ...l,
          shape: translateShape(shape, -r.shiftX, -r.shiftY),
          x: layer.x + r.shiftX,
          y: layer.y + r.shiftY,
          width: r.canvas.width,
          height: r.canvas.height,
        }) as Layer),
        revision: get().revision + 1,
      });
    },

    liveCommit: (label) => {
      if (!live) return;
      const l = live;
      live = null;
      const s = get();
      const swaps: Swap[] = [...l.before].map(([key, before]) => ({ key, before, after: getPixels(key) }));
      if (s.layers === l.layers && swaps.length === 0) return;
      set({
        past: [...s.past, { label, before: l.layers, after: s.layers, patches: [], swaps, at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
        changes: s.changes + 1,
      });
    },

    liveCancel: () => {
      if (!live) return;
      const l = live;
      live = null;
      for (const [key, before] of l.before) if (before) setPixels(key, before);
      set({ layers: l.layers, ...fixSelection(l.layers), revision: get().revision + 1 });
    },

    /** Camada de texto/forma → camada de pixels comum (perde a edição, ganha poder pintar e filtrar). */
    rasterizeLayer: (id) => {
      const target = id ?? get().activeId;
      const found = target ? findLayer(get().layers, target) : null;
      if (!found || found.layer.type !== "raster" || (!found.layer.text && !found.layer.shape)) return;
      markDirty(found.layer.id);
      commit("Rasterizar camada", mapLayer(get().layers, found.layer.id, (l) => ({ ...l, text: undefined, shape: undefined }) as Layer));
    },

    setLayerStyles: (id, styles, opts) => {
      get().updateLayer(id, { styles } as Partial<Layer>, { label: opts?.label ?? "Estilo de camada", coalesce: opts?.coalesce ?? `styles-${id}` });
    },

    setAnchorSel: (sel) => set({ anchorSel: sel, revision: get().revision + 1 }),
    setStyleDialogOpen: (open) => set({ styleDialogOpen: open }),
    setDocMeta: (patch) => set({ docMeta: { ...get().docMeta, ...patch } }),

    insertImport: (result) => {
      const res = reidentify(result);
      const swaps: Swap[] = [];
      for (const [key, canvas] of res.canvases) {
        setPixels(key, canvas);
        markDirty(key);
        swaps.push({ key, before: undefined, after: canvas });
      }
      const { layers } = get();
      const node: Layer =
        res.layers.length === 1
          ? res.layers[0]
          : { id: newId(), type: "group", name: res.name, visible: true, locked: false, opacity: 1, blend: "pass-through", collapsed: false, children: res.layers };
      const { parentId, index } = insertionPoint();
      commit(`Inserir ${res.name}`, insertLayer(layers, node, parentId, index), { swaps, activeId: node.id, selectedIds: [node.id], target: "layer" });
    },

    /** Exclui as âncoras selecionadas (de trás para frente, para os índices não mudarem). */
    deleteAnchors: () => {
      const sel = get().anchorSel;
      if (!sel || !sel.items.length) return;
      const found = findLayer(get().layers, sel.id);
      if (!found || found.layer.type !== "raster" || !found.layer.shape) return;
      let shape = found.layer.shape;
      const ordered = [...sel.items].sort((a, b) => b.path - a.path || b.index - a.index);
      for (const it of ordered) shape = deleteAnchor(shape, it.path, it.index);
      set({ anchorSel: null });
      if (shape.paths.length === 0) {
        const next = removeLayers(get().layers, new Set([sel.id]));
        commit("Excluir camada", next, fixSelectionFor(next));
      } else {
        get().setShape(sel.id, shape, { label: "Excluir ponto" });
      }
    },

    setGlobalLight: (light) => {
      setGlobalLight(light);
      set({ globalLight: light, revision: get().revision + 1, changes: get().changes + 1 });
    },

    undo: () => {
      const { past, future } = get();
      const entry = past[past.length - 1];
      if (!entry) return;
      cancelEditing();
      applyEntry(entry, "undo");
      if (entry.sel) setSelectionCanvas(entry.sel.before);
      set({ layers: entry.before });
      const sel = fixSelection(entry.before);
      set({
        layers: entry.before,
        past: past.slice(0, -1),
        future: [entry, ...future],
        ...(entry.size ? { width: entry.size.before.w, height: entry.size.before.h } : {}),
        ...(entry.sel ? { hasSelection: !!entry.sel.before, selectionRev: get().selectionRev + 1 } : {}),
        revision: get().revision + 1,
        changes: get().changes + 1,
        ...sel,
      });
    },

    redo: () => {
      const { past, future } = get();
      const entry = future[0];
      if (!entry) return;
      cancelEditing();
      applyEntry(entry, "redo");
      if (entry.sel) setSelectionCanvas(entry.sel.after);
      set({ layers: entry.after });
      const sel = fixSelection(entry.after);
      set({
        layers: entry.after,
        past: [...past, entry],
        future: future.slice(1),
        ...(entry.size ? { width: entry.size.after.w, height: entry.size.after.h } : {}),
        ...(entry.sel ? { hasSelection: !!entry.sel.after, selectionRev: get().selectionRev + 1 } : {}),
        revision: get().revision + 1,
        changes: get().changes + 1,
        ...sel,
      });
    },
  };

});
