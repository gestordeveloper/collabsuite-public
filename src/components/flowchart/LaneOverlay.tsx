import { useRef } from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import { getLaneColorPreset, LANE_LABEL_WIDTH, LANE_X0, MAX_CANVAS_WIDTH, MIN_CANVAS_WIDTH, type FlowLane } from "./types";

const LABEL_WIDTH = LANE_LABEL_WIDTH;

interface LaneOverlayProps {
  lanes: FlowLane[];
  width: number;
  onWidthChange?: (width: number) => void;
  readOnly?: boolean;
}

export function LaneOverlay({ lanes, width, onWidthChange, readOnly = false }: LaneOverlayProps) {
  const { getZoom } = useReactFlow();
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  if (lanes.length === 0) return null;

  let offsetY = 0;
  const rows = lanes.map((lane) => {
    const top = offsetY;
    offsetY += lane.height;
    return { lane, top };
  });
  const totalHeight = offsetY;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onWidthChange) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: width };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !onWidthChange) return;
    const zoom = getZoom() || 1;
    const delta = (e.clientX - dragRef.current.startX) / zoom;
    const next = Math.min(MAX_CANVAS_WIDTH, Math.max(MIN_CANVAS_WIDTH, dragRef.current.startWidth + delta));
    onWidthChange(next);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <ViewportPortal>
      <div
        style={{
          position: "absolute",
          transform: `translate(${LANE_X0}px, 0px)`,
          width,
          height: totalHeight,
          pointerEvents: "none",
        }}
        className="select-none"
      >
        {rows.map(({ lane, top }) => {
          const preset = getLaneColorPreset(lane.color);
          return (
            <div
              key={lane.id}
              style={{
                position: "absolute",
                top,
                left: 0,
                width,
                height: lane.height,
                borderBottom: `1px dashed ${preset.accent}55`,
              }}
              className="flex"
            >
              <div
                style={{
                  width: LABEL_WIDTH,
                  backgroundColor: preset.fill,
                  borderRight: `2px solid ${preset.accent}`,
                  color: preset.accent,
                }}
                className="flex shrink-0 items-center justify-center px-2 text-center text-[11px] font-bold uppercase tracking-wide"
              >
                <span className="line-clamp-3">{lane.label}</span>
              </div>
              <div className="flex-1" style={{ backgroundColor: `${preset.fill}55` }} />
            </div>
          );
        })}
        <div
          style={{ position: "absolute", top: 0, left: LABEL_WIDTH, width: 2, height: totalHeight }}
          className="bg-slate-300 dark:bg-slate-700"
        />
        {!readOnly && onWidthChange && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            title="Arraste para redimensionar a largura das raias"
            className="nodrag nopan group/handle absolute top-0 flex items-center justify-center"
            style={{
              left: width - 6,
              width: 12,
              height: totalHeight,
              cursor: "ew-resize",
              pointerEvents: "auto",
            }}
          >
            <div className="h-10 w-1.5 rounded-full bg-slate-300 opacity-0 transition-opacity group-hover/handle:opacity-100 dark:bg-slate-600" />
          </div>
        )}
      </div>
    </ViewportPortal>
  );
}
