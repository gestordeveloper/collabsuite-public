import { toPng } from "html-to-image";
import { getViewportForBounds, type ReactFlowInstance } from "@xyflow/react";
import jsPDF from "jspdf";
import { getLanesTotalHeight, LANE_LABEL_WIDTH, LANE_X0, type FlowLane } from "./types";

const EXPORT_PADDING = 0.12;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
const MAX_IMAGE_WIDTH = 2400;
const MIN_IMAGE_DIM = 640;

// jsPDF's `unit: "px"` does not map 1:1 to CSS pixels (it applies its own,
// non-standard scale factor) — using `pt` with an explicit 96dpi conversion
// (1px = 0.75pt) is the reliable way to get an exact physical page size.
// Same approach as proposal-designs/pdf-export.ts.
const PX_TO_PT = 0.75;

function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

export function slugifyFilename(input: string): string {
  const slug = input
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug || "fluxograma";
}

async function captureFlowchartPng(instance: ReactFlowInstance, lanes: FlowLane[]) {
  const nodes = instance.getNodes();
  if (nodes.length === 0) {
    throw new Error("Adicione ao menos um nó ao fluxograma antes de exportar.");
  }

  const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewportEl) {
    throw new Error("Não foi possível localizar o canvas do fluxograma.");
  }

  // Deselecting avoids exporting nodes/edges with visible selection rings.
  instance.setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
  instance.setEdges((eds) => eds.map((e) => (e.selected ? { ...e, selected: false } : e)));
  await nextPaint();

  const bounds = instance.getNodesBounds(instance.getNodes());

  // The lane overlay isn't a react-flow node, so getNodesBounds() knows
  // nothing about it — widen the box to include the label column and the
  // full lane stack, otherwise the swimlane names get cropped out of frame.
  if (lanes.length > 0) {
    const laneLeft = LANE_X0;
    const laneTop = 0;
    const laneBottom = getLanesTotalHeight(lanes);
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    bounds.x = Math.min(bounds.x, laneLeft);
    bounds.y = Math.min(bounds.y, laneTop);
    bounds.width = Math.max(right, bounds.x + LANE_LABEL_WIDTH) - bounds.x;
    bounds.height = Math.max(bottom, laneBottom) - bounds.y;
  }

  const aspect = bounds.width / bounds.height || 1;
  const imageWidth = Math.min(MAX_IMAGE_WIDTH, Math.max(bounds.width, MIN_IMAGE_DIM));
  const imageHeight = Math.max(imageWidth / aspect, MIN_IMAGE_DIM / 2);

  const viewport = getViewportForBounds(bounds, imageWidth, imageHeight, MIN_ZOOM, MAX_ZOOM, EXPORT_PADDING);

  if (document.fonts?.ready) await document.fonts.ready;

  const dataUrl = await toPng(viewportEl, {
    backgroundColor: "#ffffff",
    width: imageWidth,
    height: imageHeight,
    pixelRatio: 2,
    style: {
      width: `${imageWidth}px`,
      height: `${imageHeight}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });

  return { dataUrl, imageWidth, imageHeight };
}

export async function downloadFlowchartPng(instance: ReactFlowInstance, lanes: FlowLane[], filenameBase: string) {
  const { dataUrl } = await captureFlowchartPng(instance, lanes);
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${slugifyFilename(filenameBase)}.png`;
  link.click();
}

export async function downloadFlowchartPdf(instance: ReactFlowInstance, lanes: FlowLane[], filenameBase: string) {
  const { dataUrl, imageWidth, imageHeight } = await captureFlowchartPng(instance, lanes);
  const pageWidthPt = imageWidth * PX_TO_PT;
  const pageHeightPt = imageHeight * PX_TO_PT;

  const doc = new jsPDF({
    orientation: imageWidth >= imageHeight ? "landscape" : "portrait",
    unit: "pt",
    format: [pageWidthPt, pageHeightPt],
    compress: true,
  });
  doc.addImage(dataUrl, "PNG", 0, 0, pageWidthPt, pageHeightPt);
  doc.save(`${slugifyFilename(filenameBase)}.pdf`);
}
