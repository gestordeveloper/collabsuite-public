import { useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { NODE_MIN_DIMENSIONS, type FlowNodeData } from "./types";

const HANDLE_SIDES: { position: Position; side: string }[] = [
  { position: Position.Top, side: "top" },
  { position: Position.Right, side: "right" },
  { position: Position.Bottom, side: "bottom" },
  { position: Position.Left, side: "left" },
];

const handleDotClass =
  "!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400 dark:!border-slate-900 !opacity-0 group-hover:!opacity-100 transition-opacity";

function FourWayHandles() {
  return (
    <>
      {HANDLE_SIDES.map(({ position, side }) => (
        <div key={side}>
          <Handle type="target" position={position} id={`${side}-target`} className={handleDotClass} />
          <Handle type="source" position={position} id={`${side}-source`} className={handleDotClass} />
        </div>
      ))}
    </>
  );
}

function autoGrowTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function EditableLabel({ id, label, className }: { id: string; label: string; className?: string }) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(label);
  }, [label]);

  useEffect(() => {
    const el = textareaRef.current;
    if (editing && el) {
      el.focus();
      el.select();
      autoGrowTextarea(el);
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== label) {
      updateNodeData(id, { label: trimmed });
    } else {
      setValue(label);
    }
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autoGrowTextarea(e.target);
        }}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setValue(label);
            setEditing(false);
          }
        }}
        title="Enter para salvar, Shift+Enter para quebrar linha"
        className={`nodrag w-full resize-none overflow-hidden bg-transparent text-center outline-none ${className ?? ""}`}
      />
    );
  }

  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={`block w-full cursor-text whitespace-pre-wrap break-words text-center ${className ?? ""}`}
      title="Duplo clique para editar"
    >
      {label}
    </span>
  );
}

const markdownComponents: Components = {
  p: ({ node: _node, ...props }) => <p className="mb-1.5 last:mb-0" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold" {...props} />,
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  h1: ({ node: _node, ...props }) => <h1 className="mb-1 text-sm font-bold" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="mb-1 text-sm font-bold" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="mb-1 text-xs font-bold" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4" {...props} />,
  li: ({ node: _node, ...props }) => <li {...props} />,
  a: ({ node: _node, ...props }) => (
    <a className="text-sky-600 underline dark:text-sky-400" target="_blank" rel="noreferrer" {...props} />
  ),
  code: ({ node: _node, ...props }) => (
    <code className="rounded bg-black/10 px-1 font-mono text-[11px] dark:bg-white/10" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="border-l-2 border-current/30 pl-2 italic opacity-80" {...props} />
  ),
  hr: () => <hr className="my-1.5 border-current/20" />,
};

function MarkdownEditableLabel({ id, label }: { id: string; label: string }) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(label);
  }, [label]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (value !== label) updateNodeData(id, { label: value });
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue(label);
            setEditing(false);
          }
        }}
        placeholder="Escreva em Markdown..."
        className="nodrag h-full w-full flex-1 resize-none bg-transparent font-mono text-[11px] leading-snug outline-none placeholder:italic placeholder:text-muted-foreground"
      />
    );
  }

  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className="nodrag h-full w-full flex-1 cursor-text overflow-auto text-xs leading-snug"
      title="Duplo clique para editar em Markdown"
    >
      {value.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {value}
        </ReactMarkdown>
      ) : (
        <span className="italic text-muted-foreground">Duplo clique para editar em Markdown…</span>
      )}
    </div>
  );
}

export function TerminalNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={`group relative flex h-full min-h-[40px] w-full items-center justify-center rounded-full border-2 bg-gradient-to-br from-emerald-500 to-teal-600 px-5 py-1.5 text-white shadow-sm transition-shadow ${
        selected ? "ring-2 ring-emerald-300 ring-offset-2" : "border-emerald-700/40"
      }`}
    >
      <NodeResizer
        minWidth={NODE_MIN_DIMENSIONS.terminal.width}
        minHeight={NODE_MIN_DIMENSIONS.terminal.height}
        isVisible={selected}
      />
      <FourWayHandles />
      <EditableLabel id={id} label={data.label} className="text-sm font-semibold" />
    </div>
  );
}

export function ProcessNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={`group relative flex h-full min-h-[52px] w-full items-center justify-center rounded-lg border-2 bg-card px-4 py-2 shadow-sm transition-shadow ${
        selected ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-300 dark:border-slate-700"
      }`}
    >
      <NodeResizer
        minWidth={NODE_MIN_DIMENSIONS.process.width}
        minHeight={NODE_MIN_DIMENSIONS.process.height}
        isVisible={selected}
      />
      <FourWayHandles />
      <EditableLabel id={id} label={data.label} className="text-sm font-medium text-foreground" />
    </div>
  );
}

export function DecisionNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div className="group relative h-full w-full">
      <NodeResizer
        minWidth={NODE_MIN_DIMENSIONS.decision.width}
        minHeight={NODE_MIN_DIMENSIONS.decision.height}
        isVisible={selected}
      />
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.08))" }}
      >
        <polygon
          points="50,4 98,50 50,96 2,50"
          vectorEffect="non-scaling-stroke"
          style={{
            fill: "#fef3c7",
            stroke: selected ? "#f59e0b" : "#d97706",
            strokeWidth: selected ? 3 : 2,
          }}
        />
      </svg>
      <FourWayHandles />
      <div className="relative z-10 flex h-full w-full items-center justify-center px-1">
        <div style={{ maxWidth: "65%" }}>
          <EditableLabel id={id} label={data.label} className="text-xs font-medium text-foreground" />
        </div>
      </div>
    </div>
  );
}

export function IoNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div className="group relative h-full w-full">
      <NodeResizer minWidth={NODE_MIN_DIMENSIONS.io.width} minHeight={NODE_MIN_DIMENSIONS.io.height} isVisible={selected} />
      <div
        className={`absolute inset-0 -skew-x-12 rounded-md border-2 bg-card shadow-sm transition-shadow ${
          selected ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-300 dark:border-slate-700"
        }`}
      />
      <FourWayHandles />
      <div className="relative flex h-full w-full items-center justify-center px-5 py-2">
        <EditableLabel id={id} label={data.label} className="text-sm font-medium text-foreground" />
      </div>
    </div>
  );
}

export function DocumentNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div className="group relative h-full w-full">
      <NodeResizer
        minWidth={NODE_MIN_DIMENSIONS.document.width}
        minHeight={NODE_MIN_DIMENSIONS.document.height}
        isVisible={selected}
      />
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.08))" }}
      >
        <path
          d="M0,0 H100 V78 C 83,94 66,64 50,78 C 34,92 17,62 0,78 Z"
          vectorEffect="non-scaling-stroke"
          style={{
            fill: "#e0e7ff",
            stroke: selected ? "#4338ca" : "#4f46e5",
            strokeWidth: selected ? 3 : 2,
          }}
        />
      </svg>
      <FourWayHandles />
      <div className="relative z-10 flex h-full w-full items-center justify-center px-4 pb-3">
        <EditableLabel id={id} label={data.label} className="text-sm font-medium text-foreground" />
      </div>
    </div>
  );
}

export function SubprocessNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={`group relative flex h-full min-h-[52px] w-full items-center justify-center rounded-lg border-2 bg-card px-6 py-2 shadow-sm transition-shadow ${
        selected ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-300 dark:border-slate-700"
      }`}
    >
      <NodeResizer
        minWidth={NODE_MIN_DIMENSIONS.subprocess.width}
        minHeight={NODE_MIN_DIMENSIONS.subprocess.height}
        isVisible={selected}
      />
      <div className="absolute inset-y-1.5 left-1.5 w-[3px] rounded-sm bg-slate-300 dark:bg-slate-600" />
      <div className="absolute inset-y-1.5 right-1.5 w-[3px] rounded-sm bg-slate-300 dark:bg-slate-600" />
      <FourWayHandles />
      <EditableLabel id={id} label={data.label} className="text-sm font-medium text-foreground" />
    </div>
  );
}

export function AnnotationNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={`group relative flex h-full w-full flex-col overflow-hidden rounded-md border-2 bg-amber-50 p-2 shadow-sm transition-shadow dark:bg-amber-950/30 ${
        selected ? "border-amber-400 ring-2 ring-amber-200 dark:ring-amber-900" : "border-amber-300/70 dark:border-amber-800/60"
      }`}
    >
      <NodeResizer
        minWidth={NODE_MIN_DIMENSIONS.annotation.width}
        minHeight={NODE_MIN_DIMENSIONS.annotation.height}
        isVisible={selected}
      />
      <FourWayHandles />
      <MarkdownEditableLabel id={id} label={data.label} />
    </div>
  );
}

export const nodeTypes = {
  terminal: TerminalNode,
  process: ProcessNode,
  decision: DecisionNode,
  io: IoNode,
  document: DocumentNode,
  subprocess: SubprocessNode,
  annotation: AnnotationNode,
};
