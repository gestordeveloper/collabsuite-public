/**
 * Data model for the freeform Design Studio canvas (the "Canva clone").
 * Framework-agnostic (no React/DOM) so it can be imported from both the
 * client (canvas/editor components) and the server (validation, duplication).
 */

export type ElementKind = "text" | "image" | "shape" | "icon";

/** Shapes drawn with a plain CSS background (border-radius covers their curvature). */
export type BasicShapeKind = "rect" | "ellipse" | "line";
/** Shapes drawn via `clip-path: polygon(...)` — see SHAPE_CLIP_PATHS. */
export type PolygonShapeKind =
  | "triangle" | "diamond" | "pentagon" | "hexagon" | "star"
  | "arrow-right" | "arrow-left" | "arrow-up" | "arrow-down"
  | "speech-bubble" | "heart";
export type ShapeKind = BasicShapeKind | PolygonShapeKind;

export const SHAPE_CLIP_PATHS: Record<PolygonShapeKind, string> = {
  triangle: "polygon(50% 0%, 0% 100%, 100% 100%)",
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  pentagon: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
  hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
  "arrow-right": "polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%)",
  "arrow-left": "polygon(100% 20%, 40% 20%, 40% 0%, 0% 50%, 40% 100%, 40% 80%, 100% 80%)",
  "arrow-up": "polygon(20% 100%, 20% 40%, 0% 40%, 50% 0%, 100% 40%, 80% 40%, 80% 100%)",
  "arrow-down": "polygon(20% 0%, 80% 0%, 80% 60%, 100% 60%, 50% 100%, 0% 60%, 20% 60%)",
  "speech-bubble": "polygon(0% 0%, 100% 0%, 100% 70%, 40% 70%, 25% 100%, 25% 70%, 0% 70%)",
  heart: "polygon(50% 15%, 61% 3%, 76% 0%, 90% 6%, 98% 20%, 98% 35%, 90% 52%, 50% 90%, 10% 52%, 2% 35%, 2% 20%, 10% 6%, 24% 0%, 39% 3%)",
};

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "Retângulo", ellipse: "Círculo", line: "Linha",
  triangle: "Triângulo", diamond: "Losango", pentagon: "Pentágono", hexagon: "Hexágono", star: "Estrela",
  "arrow-right": "Seta direita", "arrow-left": "Seta esquerda", "arrow-up": "Seta cima", "arrow-down": "Seta baixo",
  "speech-bubble": "Balão de fala", heart: "Coração",
};

/** Pre-defined image masks ("frames"), in addition to the free rectangular/rounded default. */
export type FrameKind = "circle" | Exclude<PolygonShapeKind, "arrow-right" | "arrow-left" | "arrow-up" | "arrow-down">;

export const FRAME_KINDS: FrameKind[] = ["circle", "triangle", "diamond", "pentagon", "hexagon", "star", "heart", "speech-bubble"];

export const FRAME_LABELS: Record<FrameKind, string> = {
  circle: "Círculo", triangle: "Triângulo", diamond: "Losango", pentagon: "Pentágono",
  hexagon: "Hexágono", star: "Estrela", heart: "Coração", "speech-bubble": "Balão",
};

export function frameToClipPath(frame: FrameKind | undefined): string | undefined {
  if (!frame) return undefined;
  if (frame === "circle") return "circle(50% at 50% 50%)";
  return SHAPE_CLIP_PATHS[frame];
}

export type TextAlign = "left" | "center" | "right";

interface BaseElement {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity?: number;
}

export interface TextElement extends BaseElement {
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  color: string;
  align: TextAlign;
}

export interface ImageElement extends BaseElement {
  kind: "image";
  url: string;
  objectFit: "cover" | "contain";
  borderRadius?: number;
  /** Pre-defined mask shape; omitted/undefined means free rectangular (borderRadius still applies). */
  frame?: FrameKind;
}

export interface ShapeElement extends BaseElement {
  kind: "shape";
  shape: ShapeKind;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
}

export interface IconElement extends BaseElement {
  kind: "icon";
  name: string; // lucide-react icon key, e.g. "Star"
  color: string;
}

export type DesignElement = TextElement | ImageElement | ShapeElement | IconElement;

export type BackgroundSize = "cover" | "contain" | "repeat";

export interface SolidBackground {
  type: "solid";
  color: string;
}

export interface GradientBackground {
  type: "gradient";
  angle: number;
  from: string;
  to: string;
}

export interface ImageBackground {
  type: "image";
  url: string;
  size: BackgroundSize;
}

export interface TransparentBackground {
  type: "transparent";
}

export type PageBackground = SolidBackground | GradientBackground | ImageBackground | TransparentBackground;

export const DEFAULT_BACKGROUND: SolidBackground = { type: "solid", color: "#ffffff" };

/** Plain CSS declarations — kept as a local shape instead of importing React's CSSProperties. */
export interface CssBackground {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
}

export function backgroundToCss(bg: PageBackground): CssBackground {
  switch (bg.type) {
    case "gradient":
      return { backgroundImage: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})` };
    case "image":
      return bg.url
        ? {
            backgroundImage: `url(${bg.url})`,
            backgroundSize: bg.size === "repeat" ? "auto" : bg.size,
            backgroundPosition: "center",
            backgroundRepeat: bg.size === "repeat" ? "repeat" : "no-repeat",
          }
        : { backgroundColor: "#ffffff" };
    case "transparent":
      return {};
    case "solid":
    default:
      return { backgroundColor: bg.color };
  }
}

/** Checkerboard pattern standing in for "transparent" while editing — exports never call this,
 *  they use backgroundToCss directly, so a transparent page still exports with real alpha. */
export function transparentCheckerCss(size = 16): CssBackground {
  return {
    backgroundImage:
      "conic-gradient(#d1d5db 90deg, transparent 90deg 180deg, #d1d5db 180deg 270deg, transparent 270deg)",
    backgroundSize: `${size}px ${size}px`,
  };
}

/** What the editor (canvas, page thumbnails, background swatch) should paint — unlike
 *  backgroundToCss, this substitutes a visible checkerboard for a transparent background. */
export function editorBackgroundCss(bg: PageBackground): CssBackground {
  return bg.type === "transparent" ? transparentCheckerCss() : backgroundToCss(bg);
}

export interface DesignPage {
  id: string;
  width: number;
  height: number;
  background: PageBackground;
  elements: DesignElement[];
}

/** Client-side working document: parsed `Design.pages` + the record's own fields. */
export interface DesignDoc {
  id: number;
  name: string;
  width: number;
  height: number;
  pages: DesignPage[];
}

export interface PageSizePreset {
  label: string;
  width: number;
  height: number;
}

export const PAGE_SIZE_PRESETS: PageSizePreset[] = [
  { label: "Apresentação (16:9)", width: 1920, height: 1080 },
  { label: "A4 Retrato", width: 794, height: 1123 },
  { label: "A4 Paisagem", width: 1123, height: 794 },
  { label: "Post Instagram", width: 1080, height: 1080 },
  { label: "Story / Reels", width: 1080, height: 1920 },
  { label: "Post Facebook", width: 1200, height: 630 },
];

export const DEFAULT_TEXT: Omit<TextElement, "id" | "x" | "y" | "zIndex"> = {
  kind: "text",
  width: 400,
  height: 80,
  rotation: 0,
  text: "Novo texto",
  fontFamily: "Inter",
  fontSize: 32,
  fontWeight: 400,
  italic: false,
  underline: false,
  color: "#1e1b4b",
  align: "left",
};

export const DEFAULT_SHAPE: Omit<ShapeElement, "id" | "x" | "y" | "zIndex" | "shape"> = {
  kind: "shape",
  width: 240,
  height: 160,
  rotation: 0,
  fill: "#4f46e5",
  strokeWidth: 0,
  borderRadius: 0,
};

export const DEFAULT_ICON: Omit<IconElement, "id" | "x" | "y" | "zIndex"> = {
  kind: "icon",
  width: 96,
  height: 96,
  rotation: 0,
  name: "Star",
  color: "#4f46e5",
};

export const DEFAULT_IMAGE: Omit<ImageElement, "id" | "x" | "y" | "zIndex" | "url"> = {
  kind: "image",
  width: 480,
  height: 320,
  rotation: 0,
  objectFit: "cover",
  borderRadius: 0,
};

export function emptyPage(id: string, width = 1920, height = 1080): DesignPage {
  return { id, width, height, background: { ...DEFAULT_BACKGROUND }, elements: [] };
}

/** Upgrades a page from an older, pre-per-page-size/background shape (plain `background: string`, no width/height). */
function normalizePage(raw: any, fallbackWidth: number, fallbackHeight: number): DesignPage {
  const background: PageBackground =
    typeof raw?.background === "string"
      ? { type: "solid", color: raw.background || "#ffffff" }
      : raw?.background && typeof raw.background === "object"
        ? raw.background
        : { ...DEFAULT_BACKGROUND };

  return {
    id: raw?.id ?? "page-1",
    width: typeof raw?.width === "number" ? raw.width : fallbackWidth,
    height: typeof raw?.height === "number" ? raw.height : fallbackHeight,
    background,
    elements: Array.isArray(raw?.elements) ? raw.elements : [],
  };
}

export function parseDesignPages(
  pages: string | null | undefined,
  fallbackWidth = 1920,
  fallbackHeight = 1080
): DesignPage[] {
  if (!pages) return [emptyPage("page-1", fallbackWidth, fallbackHeight)];
  try {
    const parsed = JSON.parse(pages);
    if (!Array.isArray(parsed) || parsed.length === 0) return [emptyPage("page-1", fallbackWidth, fallbackHeight)];
    return parsed.map((p) => normalizePage(p, fallbackWidth, fallbackHeight));
  } catch {
    return [emptyPage("page-1", fallbackWidth, fallbackHeight)];
  }
}
