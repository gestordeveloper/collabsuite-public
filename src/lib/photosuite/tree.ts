import type { GroupLayer, Layer, RasterLayer } from "./types";

/** Helpers imutáveis sobre a árvore de camadas (índice 0 = camada mais baixa). */

export interface Found {
  layer: Layer;
  parent: GroupLayer | null;
  siblings: Layer[];
  index: number;
}

export function findLayer(layers: Layer[], id: string, parent: GroupLayer | null = null): Found | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === id) return { layer: l, parent, siblings: layers, index: i };
    if (l.type === "group") {
      const hit = findLayer(l.children, id, l);
      if (hit) return hit;
    }
  }
  return null;
}

export function mapLayer(layers: Layer[], id: string, fn: (l: Layer) => Layer): Layer[] {
  return layers.map((l) => {
    if (l.id === id) return fn(l);
    if (l.type === "group") {
      const children = mapLayer(l.children, id, fn);
      return children === l.children ? l : { ...l, children };
    }
    return l;
  });
}

export function removeLayers(layers: Layer[], ids: Set<string>): Layer[] {
  const out: Layer[] = [];
  for (const l of layers) {
    if (ids.has(l.id)) continue;
    out.push(l.type === "group" ? { ...l, children: removeLayers(l.children, ids) } : l);
  }
  return out;
}

/** Insere `layer` em `parentId` (null = raiz) na posição `index` (0 = base). */
export function insertLayer(layers: Layer[], layer: Layer, parentId: string | null, index: number): Layer[] {
  if (parentId === null) {
    const out = layers.slice();
    out.splice(Math.max(0, Math.min(index, out.length)), 0, layer);
    return out;
  }
  return layers.map((l) => {
    if (l.type !== "group") return l;
    if (l.id === parentId) {
      const children = l.children.slice();
      children.splice(Math.max(0, Math.min(index, children.length)), 0, layer);
      return { ...l, children };
    }
    return { ...l, children: insertLayer(l.children, layer, parentId, index) };
  });
}

export function walk(layers: Layer[], fn: (l: Layer, parent: GroupLayer | null) => void, parent: GroupLayer | null = null) {
  for (const l of layers) {
    fn(l, parent);
    if (l.type === "group") walk(l.children, fn, l);
  }
}

export function rasterLayers(layers: Layer[]): RasterLayer[] {
  const out: RasterLayer[] = [];
  walk(layers, (l) => {
    if (l.type === "raster") out.push(l);
  });
  return out;
}

export function collectIds(layer: Layer): string[] {
  const ids = [layer.id];
  if (layer.type === "group") for (const c of layer.children) ids.push(...collectIds(c));
  return ids;
}

/** `ancestorId` contém `id` em algum nível? (evita arrastar um grupo para dentro de si mesmo) */
export function isDescendant(layers: Layer[], ancestorId: string, id: string): boolean {
  const a = findLayer(layers, ancestorId);
  if (!a || a.layer.type !== "group") return false;
  return collectIds(a.layer).includes(id);
}

export function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `l-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Nome único na forma "Camada N". */
export function nextLayerName(layers: Layer[], base = "Camada"): string {
  let max = 0;
  const re = new RegExp(`^${base} (\\d+)$`);
  walk(layers, (l) => {
    const m = re.exec(l.name);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `${base} ${max + 1}`;
}
