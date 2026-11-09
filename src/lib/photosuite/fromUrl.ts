import * as photosuiteService from "@/src/services/photosuite.service";
import { loadImage } from "./engine";

/** Cria um documento do Photosuite a partir de uma imagem já hospedada (ex.: anexo de tarefa) e devolve o id. */
export async function createDocumentFromImageUrl(url: string, fileName: string, projectId: number | null = null): Promise<number> {
  const img = await loadImage(url); // S3 passa pelo proxy do servidor; /uploads é direto
  const name = fileName.replace(/\.[^.]+$/, "").slice(0, 200) || "Imagem";
  const { naturalWidth: width, naturalHeight: height } = img;
  const doc = JSON.stringify({
    version: 1,
    width,
    height,
    layers: [
      { id: "bg", type: "raster", name, visible: true, locked: false, opacity: 1, blend: "normal", x: 0, y: 0, width, height, fill: null, src: url, mask: null },
    ],
  });
  const created = await photosuiteService.createDocument({ name, width, height, project_id: projectId, doc });
  return created.id;
}
