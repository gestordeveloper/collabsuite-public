import type { Node, Edge } from "@xyflow/react";

// Set inline (not via Tailwind classes) on edge paths/markers and the decision
// diamond's SVG fill/stroke — html-to-image (used for PNG/PDF export) doesn't
// reliably resolve SVG fill/stroke that comes from CSS classes, only inline
// style/attributes, so those specific colors must stay hardcoded here.
export const EDGE_STROKE_COLOR = "#64748b";
export const EDGE_STROKE_COLOR_SELECTED = "#334155";

export type FlowNodeKind = "terminal" | "process" | "decision" | "io" | "document" | "subprocess" | "annotation";

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  kind: FlowNodeKind;
}

export interface LaneColorPreset {
  id: string;
  label: string;
  fill: string;
  fillDark: string;
  accent: string;
}

export const LANE_COLOR_PRESETS: LaneColorPreset[] = [
  { id: "slate", label: "Cinza", fill: "#e2e8f0", fillDark: "#1e293b", accent: "#64748b" },
  { id: "sky", label: "Azul", fill: "#bae6fd", fillDark: "#0c4a6e", accent: "#0284c7" },
  { id: "emerald", label: "Verde", fill: "#bbf7d0", fillDark: "#064e3b", accent: "#059669" },
  { id: "amber", label: "Âmbar", fill: "#fde68a", fillDark: "#78350f", accent: "#d97706" },
  { id: "rose", label: "Rosa", fill: "#fecdd3", fillDark: "#881337", accent: "#e11d48" },
  { id: "violet", label: "Violeta", fill: "#ddd6fe", fillDark: "#4c1d95", accent: "#7c3aed" },
];

export const DEFAULT_LANE_COLOR = LANE_COLOR_PRESETS[0].id;

export function getLaneColorPreset(colorId: string | undefined): LaneColorPreset {
  return LANE_COLOR_PRESETS.find((p) => p.id === colorId) ?? LANE_COLOR_PRESETS[0];
}

export interface FlowLane {
  id: string;
  label: string;
  height: number;
  color: string;
}

// Shared with LaneOverlay (which draws the lane bands) and export.ts (which
// needs to widen the captured area so the label column isn't cropped out).
export const LANE_X0 = -60;
export const LANE_LABEL_WIDTH = 130;

// The lane bands all share one horizontal extent (a swimlane diagram reads as
// one shape only if every row spans the same width) — the user drags a handle
// on the right edge of the lanes to grow/shrink this, persisted per-flowchart.
export const DEFAULT_CANVAS_WIDTH = 3200;
export const MIN_CANVAS_WIDTH = 900;
export const MAX_CANVAS_WIDTH = 12000;

export function getLanesTotalHeight(lanes: FlowLane[]): number {
  return lanes.reduce((sum, lane) => sum + lane.height, 0);
}

export interface FlowchartState {
  lanes: FlowLane[];
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  canvasWidth: number;
}

export const NODE_DIMENSIONS: Record<FlowNodeKind, { width: number; height: number }> = {
  terminal: { width: 140, height: 48 },
  process: { width: 180, height: 64 },
  decision: { width: 170, height: 110 },
  io: { width: 180, height: 64 },
  document: { width: 180, height: 72 },
  subprocess: { width: 180, height: 64 },
  annotation: { width: 220, height: 140 },
};

// Floors for the NodeResizer drag handles — small enough to still tighten a
// node up, large enough that the shape (and its label) stays legible.
export const NODE_MIN_DIMENSIONS: Record<FlowNodeKind, { width: number; height: number }> = {
  terminal: { width: 110, height: 40 },
  process: { width: 120, height: 52 },
  decision: { width: 130, height: 90 },
  io: { width: 130, height: 52 },
  document: { width: 130, height: 60 },
  subprocess: { width: 130, height: 52 },
  annotation: { width: 160, height: 100 },
};

export const DEFAULT_FLOWCHART_STATE: FlowchartState = {
  lanes: [],
  canvasWidth: DEFAULT_CANVAS_WIDTH,
  nodes: [
    {
      id: "n-start",
      type: "terminal",
      position: { x: 260, y: 40 },
      data: { label: "Início", kind: "terminal" },
    },
    {
      id: "n-end",
      type: "terminal",
      position: { x: 260, y: 320 },
      data: { label: "Fim", kind: "terminal" },
    },
  ],
  edges: [],
};

// Older saved flowcharts predate resizable nodes and have no explicit
// width/height on the node object — NodeResizer and the nodes' `h-full`/
// `w-full` styling both need those fields set, so backfill from the kind's
// default dimensions the first time such a node is loaded.
function withNodeDimensions(node: Node<FlowNodeData>): Node<FlowNodeData> {
  const kind = (node.data?.kind ?? (node.type as FlowNodeKind)) ?? "process";
  const dims = NODE_DIMENSIONS[kind] ?? NODE_DIMENSIONS.process;
  return {
    ...node,
    width: node.width ?? dims.width,
    height: node.height ?? dims.height,
  };
}

export function parseFlowchartState(content: string | null | undefined): FlowchartState {
  if (content) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        return {
          lanes: Array.isArray(parsed.lanes)
            ? parsed.lanes.map((lane: Partial<FlowLane>, index: number) => ({
                id: lane.id ?? `lane-${index}`,
                label: lane.label ?? `Raia ${index + 1}`,
                height: lane.height ?? 160,
                color: lane.color ?? LANE_COLOR_PRESETS[index % LANE_COLOR_PRESETS.length].id,
              }))
            : [],
          nodes: parsed.nodes.map(withNodeDimensions),
          edges: parsed.edges,
          canvasWidth:
            typeof parsed.canvasWidth === "number" && parsed.canvasWidth > 0
              ? parsed.canvasWidth
              : DEFAULT_CANVAS_WIDTH,
        };
      }
    } catch {
      // falls through to default state below
    }
  }
  return DEFAULT_FLOWCHART_STATE;
}
