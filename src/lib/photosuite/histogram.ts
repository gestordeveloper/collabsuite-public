import { createCanvas, renderDocument } from "./engine";
import type { Layer } from "./types";

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
}

/** Histograma (por canal e luminosidade) do documento composto com `layers`. */
export function computeHistogram(width: number, height: number, layers: Layer[]): Histogram {
  const c = createCanvas(width, height);
  renderDocument({ width, height, layers }, c);
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
  const hist: Histogram = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    hist.r[d[i]]++;
    hist.g[d[i + 1]]++;
    hist.b[d[i + 2]]++;
    hist.l[Math.round(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2])]++;
  }
  return hist;
}

/** Camadas que ficam abaixo de `id` (o que o ajuste "enxerga"). */
export function belowLayers(layers: Layer[], id: string): Layer[] | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === id) return layers.slice(0, i);
    if (l.type === "group") {
      const inner = belowLayers(l.children, id);
      if (inner) return [...layers.slice(0, i), { ...l, children: inner }];
    }
  }
  return null;
}
