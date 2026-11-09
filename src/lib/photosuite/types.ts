import type { Adjustment } from "./adjustments";
import type { GlobalLight, LayerStyles } from "./effects";
import type { TextData } from "./text";
import type { ShapeData } from "./vector";

/**
 * Photosuite — modelo de documento. Só metadados vão para o banco (coluna `doc`); os pixels de cada
 * camada/máscara ficam em PNGs no S3 referenciados por `src`. Camadas são guardadas de baixo para cima
 * (índice 0 = fundo), como no PhotoCraft.
 */

export const BLEND_MODES = [
  "normal", "dissolve", "darken", "multiply", "color-burn", "linear-burn", "darker-color",
  "lighten", "screen", "color-dodge", "linear-dodge", "lighter-color",
  "overlay", "soft-light", "hard-light", "vivid-light", "linear-light", "pin-light", "hard-mix",
  "difference", "exclusion", "subtract", "divide",
  "hue", "saturation", "color", "luminosity",
  // Modos do Paint.NET (sem equivalente no PSD), depois dos do Photoshop como no PhotoCraft
  "reflect", "glow", "negation", "xor", "pdn-color-burn", "pdn-color-dodge",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number] | "pass-through";

export const BLEND_LABELS: Record<BlendMode, string> = {
  "pass-through": "Pass Through",
  normal: "Normal",
  dissolve: "Dissolve",
  darken: "Darken",
  multiply: "Multiply",
  "color-burn": "Color Burn",
  "linear-burn": "Linear Burn",
  "darker-color": "Darker Color",
  lighten: "Lighten",
  screen: "Screen",
  "color-dodge": "Color Dodge",
  "linear-dodge": "Linear Dodge (Add)",
  "lighter-color": "Lighter Color",
  overlay: "Overlay",
  "soft-light": "Soft Light",
  "hard-light": "Hard Light",
  "vivid-light": "Vivid Light",
  "linear-light": "Linear Light",
  "pin-light": "Pin Light",
  "hard-mix": "Hard Mix",
  difference: "Difference",
  exclusion: "Exclusion",
  subtract: "Subtract",
  divide: "Divide",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
  reflect: "Reflect",
  glow: "Glow",
  negation: "Negation",
  xor: "XOR",
  "pdn-color-burn": "Color Burn (Paint.NET)",
  "pdn-color-dodge": "Color Dodge (Paint.NET)",
};

/** Agrupamento do menu, na ordem do Photoshop. */
export const BLEND_GROUPS: BlendMode[][] = [
  ["normal", "dissolve"],
  ["darken", "multiply", "color-burn", "linear-burn", "darker-color"],
  ["lighten", "screen", "color-dodge", "linear-dodge", "lighter-color"],
  ["overlay", "soft-light", "hard-light", "vivid-light", "linear-light", "pin-light", "hard-mix"],
  ["difference", "exclusion", "subtract", "divide"],
  ["hue", "saturation", "color", "luminosity"],
  ["reflect", "glow", "negation", "xor", "pdn-color-burn", "pdn-color-dodge"],
];

export interface LayerMask {
  /** PNG com o valor da máscara no canal alfa (branco = revela). `null` até ser salva. */
  src: string | null;
  enabled: boolean;
}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
}

export interface RasterLayer extends LayerBase {
  type: "raster";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pré-preenchimento aplicado ao carregar quando ainda não há `src` (ex.: fundo branco). */
  fill: string | null;
  src: string | null;
  mask: LayerMask | null;
  /**
   * Camada de ajuste: não tem pixels próprios; aplica `adjustment` a tudo que está abaixo dela
   * (no mesmo grupo), com a máscara, a opacidade e o modo de mesclagem da camada. `width`/`height`
   * são os do documento (o tamanho da máscara).
   */
  adjustment?: Adjustment;
  /**
   * Camada de texto: `text` é a fonte da verdade e os pixels são re-gerados dele (não vão para o
   * servidor). Para pintar/filtrar é preciso rasterizar antes (remove `text`, mantém os pixels).
   */
  text?: TextData;
  /** Camada de forma vetorial; mesmas regras de `text` (pontos em coordenadas do canvas da camada). */
  shape?: ShapeData;
  /** Estilos de camada (sombra, brilho, traço, sobreposições, cetim, chanfro). */
  styles?: LayerStyles;
}

export interface GroupLayer extends LayerBase {
  type: "group";
  collapsed: boolean;
  children: Layer[];
}

export type Layer = RasterLayer | GroupLayer;

export interface PhotoDoc {
  version: 1;
  width: number;
  height: number;
  layers: Layer[];
  /** luz global usada pelos estilos com "usar luz global" */
  globalLight?: GlobalLight;
}

export interface PhotoDocumentRecord {
  id: number;
  company_id?: number | null;
  user_id: number;
  project_id?: number | null;
  name: string;
  thumbnail_url?: string | null;
  width: number;
  height: number;
  /** "private" = só o dono; "project" = membros do projeto vinculado também abrem e editam */
  visibility?: "private" | "project";
  share_token?: string | null;
  share_image_url?: string | null;
  /** false quando o documento é de outra pessoa (compartilhado pelo projeto) */
  is_owner?: boolean;
  owner_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoDocumentFull extends PhotoDocumentRecord {
  doc: string;
}

export function parsePhotoDoc(raw: string, width: number, height: number): PhotoDoc {
  try {
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.layers)) return { version: 1, width: d.width ?? width, height: d.height ?? height, layers: d.layers, globalLight: d.globalLight };
  } catch {
    /* documento corrompido cai no vazio */
  }
  return { version: 1, width, height, layers: [] };
}
