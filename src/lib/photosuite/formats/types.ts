import type { GlobalLight } from "../effects";
import type { Layer } from "../types";

/**
 * Resultado de ler um arquivo de qualquer formato: a árvore de camadas já no modelo do Photosuite,
 * os canvases dos pixels (chave = id da camada, ou `${id}:mask` para máscaras) e os avisos de tudo
 * que não foi possível trazer fielmente.
 */
export interface ImportResult {
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  canvases: Map<string, HTMLCanvasElement>;
  warnings: string[];
  globalLight?: GlobalLight;
}

/** Resultado de uma exportação: o arquivo e o que ficou de fora. */
export interface ExportResult {
  blob: Blob;
  warnings: string[];
}
