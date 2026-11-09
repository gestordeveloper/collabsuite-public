/**
 * Ciclo de vida de um documento aberto: carregar do servidor, salvar (PNGs alterados + JSON da
 * árvore + miniatura), exportar e importar imagens.
 */
import * as photosuiteService from "@/src/services/photosuite.service";
import { usePhotosuite } from "@/src/store/photosuite.store";
import { canvasToBlob, createCanvas, hydrate, renderDocument, serializeLayers, uploadBlob, uploadDirty } from "./engine";
import { parsePhotoDoc, type Layer } from "./types";

export async function openDocument(id: number): Promise<void> {
  const record = await photosuiteService.getDocument(id);
  const doc = parsePhotoDoc(record.doc, record.width, record.height);
  const fixes = await hydrate(doc);
  // texto re-gerado pode ter outro tamanho se a fonte mudou desde que o documento foi salvo
  const fixById = new Map(fixes.map((f) => [f.id, f]));
  const patch = (ls: Layer[]): Layer[] =>
    ls.map((l) => {
      if (l.type === "group") return { ...l, children: patch(l.children) };
      const f = fixById.get(l.id);
      return f ? { ...l, width: f.width, height: f.height } : l;
    });
  usePhotosuite.getState().load({
    docId: record.id,
    name: record.name,
    width: doc.width,
    height: doc.height,
    layers: fixes.length ? patch(doc.layers) : doc.layers,
    globalLight: doc.globalLight,
  });
  usePhotosuite.getState().setDocMeta({
    isOwner: record.is_owner ?? true,
    projectId: record.project_id ?? null,
    visibility: record.visibility ?? "private",
    shareToken: record.share_token ?? null,
  });
}

const THUMB_SIZE = 480;

async function makeThumbnail(): Promise<string | null> {
  const { width, height, layers } = usePhotosuite.getState();
  const full = createCanvas(width, height);
  renderDocument({ width, height, layers }, full);
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
  const thumb = createCanvas(width * scale, height * scale);
  const ctx = thumb.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  ctx.drawImage(full, 0, 0, thumb.width, thumb.height);
  try {
    return await uploadBlob(await canvasToBlob(thumb, "image/jpeg", 0.85), "thumb.jpg");
  } catch {
    return null; // a miniatura é secundária; não falha o salvamento
  }
}

let saving: Promise<void> | null = null;

/** Salva o documento aberto. Chamadas concorrentes esperam a em andamento e salvam de novo se houve mudança. */
export async function saveDocument(): Promise<void> {
  if (saving) {
    await saving;
  }
  const run = async () => {
    const s = usePhotosuite.getState();
    if (s.docId == null) return;
    const changesAtStart = s.changes;

    const { failed } = await uploadDirty(s.layers);
    if (failed > 0) throw new Error(`${failed} camada(s) não foram enviadas`);

    const thumbnail_url = await makeThumbnail();
    const now = usePhotosuite.getState();
    await photosuiteService.updateDocument(s.docId, {
      name: now.name,
      width: now.width,
      height: now.height,
      thumbnail_url: thumbnail_url ?? undefined,
      doc: JSON.stringify({ version: 1, width: now.width, height: now.height, layers: serializeLayers(now.layers), globalLight: now.globalLight }),
    });
    lastSavedChanges = changesAtStart;
  };
  saving = run().finally(() => {
    saving = null;
  });
  return saving;
}

let lastSavedChanges = 0;
export const hasUnsavedChanges = () => usePhotosuite.getState().changes !== lastSavedChanges;
export function markClean() {
  lastSavedChanges = usePhotosuite.getState().changes;
}

export type ExportFormat = "png" | "jpeg" | "webp";

export async function exportImage(format: ExportFormat, quality = 0.92): Promise<Blob> {
  const { width, height, layers } = usePhotosuite.getState();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  if (format === "jpeg") {
    // JPEG não tem transparência: assenta sobre branco.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  const flat = createCanvas(width, height);
  renderDocument({ width, height, layers }, flat);
  ctx.drawImage(flat, 0, 0);
  return canvasToBlob(canvas, `image/${format}`, format === "png" ? undefined : quality);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Lê um arquivo de imagem para um canvas do tamanho original. */
export async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}
