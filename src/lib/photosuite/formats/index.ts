/**
 * Orquestra os formatos de arquivo: detecta o tipo, converte para `ImportResult`, grava no servidor
 * (cria o documento) ou insere num documento aberto.
 */
import * as photosuiteService from "@/src/services/photosuite.service";
import { canvasToBlob, createCanvas, getPixels, maskKey, uploadBlob } from "../engine";
import { rasterLayers } from "../tree";
import type { Layer, RasterLayer } from "../types";
import { exportNative, importNative } from "./native";
import { exportPsd, importPsd } from "./psd";
import { exportSvg, importSvg } from "./svg";
import type { ExportResult, ImportResult } from "./types";
import { newId } from "../tree";

export type { ImportResult, ExportResult } from "./types";
export { reidentify } from "./native";

export const OPEN_ACCEPT = ".psd,.svg,.photosuite,image/*";

export type FileKind = "psd" | "svg" | "photosuite" | "image";

export function kindOf(file: File): FileKind | null {
  const n = file.name.toLowerCase();
  if (n.endsWith(".psd")) return "psd";
  if (n.endsWith(".svg") || file.type === "image/svg+xml") return "svg";
  if (n.endsWith(".photosuite")) return "photosuite";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

async function importImage(file: File): Promise<ImportResult> {
  const bmp = await createImageBitmap(file);
  const c = createCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  const name = file.name.replace(/\.[^.]+$/, "") || "Imagem";
  const layer: RasterLayer = { id: newId(), type: "raster", name, visible: true, locked: false, opacity: 1, blend: "normal", x: 0, y: 0, width: c.width, height: c.height, fill: null, src: null, mask: null };
  bmp.close();
  return { name, width: c.width, height: c.height, layers: [layer], canvases: new Map([[layer.id, c]]), warnings: [] };
}

/** Lê qualquer arquivo suportado. */
export async function readFile(file: File): Promise<ImportResult> {
  const kind = kindOf(file);
  if (!kind) throw new Error(`Formato não suportado: ${file.name}. Use PSD, SVG, .photosuite ou uma imagem.`);
  if (kind === "psd") return importPsd(await file.arrayBuffer(), file.name);
  if (kind === "svg") return importSvg(await file.text(), file.name);
  if (kind === "photosuite") return importNative(file, file.name);
  return importImage(file);
}

/**
 * Envia os pixels ao servidor e cria o documento. Texto e formas não sobem como PNG (são refeitos dos
 * dados); camadas de ajuste só enviam a máscara.
 */
export async function persistImport(r: ImportResult, projectId: number | null = null): Promise<number> {
  const jobs: { key: string; run: () => Promise<void> }[] = [];
  const withSrc = (ls: Layer[]): Layer[] =>
    ls.map((l) => {
      if (l.type === "group") return { ...l, children: withSrc(l.children) };
      const out: RasterLayer = { ...l, src: null, mask: l.mask ? { ...l.mask, src: null } : null };
      if (!l.text && !l.shape && !l.adjustment) {
        const c = r.canvases.get(l.id);
        if (c) jobs.push({ key: l.id, run: async () => { out.src = await uploadBlob(await canvasToBlob(c), `${l.id}.png`); } });
      }
      if (l.mask) {
        const m = r.canvases.get(maskKey(l.id));
        if (m) jobs.push({ key: maskKey(l.id), run: async () => { out.mask!.src = await uploadBlob(await canvasToBlob(m), `${l.id}-mask.png`); } });
      }
      return out;
    });
  const layers = withSrc(r.layers);

  const queue = [...jobs];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) await queue.shift()!.run();
  }));

  const created = await photosuiteService.createDocument({
    name: r.name.slice(0, 200) || "Sem título",
    project_id: projectId,
    width: r.width,
    height: r.height,
    doc: JSON.stringify({ version: 1, width: r.width, height: r.height, layers, globalLight: r.globalLight }),
  });
  if (r.warnings.length) {
    try {
      sessionStorage.setItem(`photosuite-warnings-${created.id}`, JSON.stringify(r.warnings));
    } catch {
      /* sessionStorage indisponível: os avisos só não aparecem */
    }
  }
  return created.id;
}

// ---------------------------------------------------------------------------------------------
// Exportação do documento aberto
// ---------------------------------------------------------------------------------------------

export type VectorExportFormat = "psd" | "svg" | "photosuite";

export const EXPORT_EXT: Record<VectorExportFormat, string> = { psd: "psd", svg: "svg", photosuite: "photosuite" };

export async function exportDocumentAs(
  format: VectorExportFormat,
  doc: { name: string; width: number; height: number; layers: Layer[]; globalLight?: { angle: number; altitude: number } },
): Promise<ExportResult> {
  const get = (k: string) => getPixels(k);
  if (format === "psd") return exportPsd(doc, get);
  if (format === "svg") return exportSvg(doc, get);
  return exportNative(doc, get);
}

export { rasterLayers };
