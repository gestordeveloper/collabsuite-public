/**
 * Formato nativo `.photosuite`: o documento inteiro (camadas, grupos, máscaras, texto, formas, estilos,
 * ajustes e luz global) num JSON comprimido com gzip, com os pixels embutidos em PNG (data URL).
 * Abre sem servidor e sem perda — é o formato para levar um documento de uma conta para outra.
 */
import type { GlobalLight } from "../effects";
import { createCanvas } from "../engine";
import { maskKey } from "../engine";
import { newId, rasterLayers } from "../tree";
import type { Layer } from "../types";
import type { ExportResult, ImportResult } from "./types";

const FORMAT = "photosuite";

interface NativeFile {
  format: typeof FORMAT;
  version: 1;
  name: string;
  width: number;
  height: number;
  globalLight?: GlobalLight;
  layers: Layer[];
  /** id da camada (ou `${id}:mask`) → PNG em data URL */
  pixels: Record<string, string>;
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function exportNative(
  doc: { name: string; width: number; height: number; layers: Layer[]; globalLight?: GlobalLight },
  getCanvas: (key: string) => HTMLCanvasElement | undefined,
): Promise<ExportResult> {
  const pixels: Record<string, string> = {};
  for (const l of rasterLayers(doc.layers)) {
    // texto e formas são refeitos dos dados; ajustes não têm pixels
    if (!l.text && !l.shape && !l.adjustment) {
      const c = getCanvas(l.id);
      if (c) pixels[l.id] = c.toDataURL("image/png");
    }
    if (l.mask) {
      const m = getCanvas(maskKey(l.id));
      if (m) pixels[maskKey(l.id)] = m.toDataURL("image/png");
    }
  }
  // as camadas vão sem `src`: os pixels estão embutidos
  const strip = (ls: Layer[]): Layer[] =>
    ls.map((l) => (l.type === "group" ? { ...l, children: strip(l.children) } : { ...l, src: null, mask: l.mask ? { ...l.mask, src: null } : null }));
  const file: NativeFile = { format: FORMAT, version: 1, name: doc.name, width: doc.width, height: doc.height, globalLight: doc.globalLight, layers: strip(doc.layers), pixels };
  return { blob: await gzip(JSON.stringify(file)), warnings: [] };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Pixels do arquivo estão corrompidos."));
    i.src = url;
  });
}

export async function importNative(blob: Blob, fileName: string): Promise<ImportResult> {
  let text: string;
  try {
    text = await gunzip(blob);
  } catch {
    text = await blob.text(); // aceita também o JSON sem compressão
  }
  let file: NativeFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("Arquivo .photosuite inválido.");
  }
  if (file.format !== FORMAT || !Array.isArray(file.layers)) throw new Error("Arquivo .photosuite inválido.");
  const canvases = new Map<string, HTMLCanvasElement>();
  await Promise.all(
    Object.entries(file.pixels ?? {}).map(async ([key, url]) => {
      const img = await loadImage(url);
      const c = createCanvas(img.width, img.height);
      c.getContext("2d")!.drawImage(img, 0, 0);
      canvases.set(key, c);
    }),
  );
  return {
    name: file.name || fileName.replace(/\.[^.]+$/, ""),
    width: file.width,
    height: file.height,
    layers: file.layers,
    canvases,
    warnings: file.version > 1 ? ["O arquivo foi criado numa versão mais nova; alguns recursos podem não aparecer."] : [],
    globalLight: file.globalLight,
  };
}

/** Dá ids novos a todas as camadas (para inserir um arquivo dentro de um documento sem colidir). */
export function reidentify(r: ImportResult): ImportResult {
  const canvases = new Map<string, HTMLCanvasElement>();
  const redo = (ls: Layer[]): Layer[] =>
    ls.map((l) => {
      const id = newId();
      if (l.type === "group") return { ...l, id, children: redo(l.children) };
      const c = r.canvases.get(l.id);
      const m = r.canvases.get(maskKey(l.id));
      if (c) canvases.set(id, c);
      if (m) canvases.set(maskKey(id), m);
      return { ...l, id };
    });
  return { ...r, layers: redo(r.layers), canvases };
}
