import { useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type EdgeProps } from "@xyflow/react";
import { EDGE_STROKE_COLOR, EDGE_STROKE_COLOR_SELECTED } from "./types";

export function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const label = typeof data?.label === "string" ? data.label : "";
  const [value, setValue] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  useEffect(() => {
    setValue(label);
  }, [label]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, label: trimmed } } : e)));
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? EDGE_STROKE_COLOR_SELECTED : EDGE_STROKE_COLOR,
          strokeWidth: selected ? 2.5 : 1.75,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="nodrag nopan pointer-events-auto absolute"
        >
          {editing ? (
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") {
                  setValue(label);
                  setEditing(false);
                }
              }}
              className="w-24 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-xs text-slate-800 shadow-sm outline-none"
            />
          ) : label ? (
            <span
              onDoubleClick={() => setEditing(true)}
              className="cursor-text rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              title="Duplo clique para editar"
            >
              {label}
            </span>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="rounded-full border border-dashed border-slate-300 bg-white/90 px-2 py-0.5 text-[10px] text-slate-400 opacity-70 shadow-sm transition-opacity hover:opacity-100 dark:border-slate-600 dark:bg-slate-900/90"
              title="Adicionar rótulo"
            >
              + rótulo
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = {
  labeled: LabeledEdge,
};
