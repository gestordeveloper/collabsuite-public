import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useThemeStore } from "@/src/store/theme.store";
import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { LaneOverlay } from "./LaneOverlay";
import { FlowchartToolbar } from "./Toolbar";
import {
  DEFAULT_CANVAS_WIDTH,
  EDGE_STROKE_COLOR,
  NODE_DIMENSIONS,
  type FlowchartState,
  type FlowLane,
  type FlowNodeData,
  type FlowNodeKind,
} from "./types";

const DEFAULT_MARKER = { type: MarkerType.ArrowClosed, color: EDGE_STROKE_COLOR, width: 18, height: 18 };

let nodeCounter = 0;
function nextNodeId() {
  nodeCounter += 1;
  return `node-${Date.now()}-${nodeCounter}`;
}

const NODE_LABELS: Record<FlowNodeKind, string> = {
  terminal: "Início/Fim",
  process: "Novo processo",
  decision: "Nova decisão?",
  io: "Entrada/Saída",
  document: "Documento",
  subprocess: "Subprocesso",
  annotation: "**Anotação**\n\nDuplo clique para editar em _Markdown_.",
};

interface FlowchartCanvasProps {
  title: string;
  initialState: FlowchartState;
  onChange: (state: FlowchartState) => void;
  readOnly?: boolean;
}

function FlowchartCanvasInner({ title, initialState, onChange, readOnly = false }: FlowchartCanvasProps) {
  const darkMode = useThemeStore((s) => s.darkMode);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(initialState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialState.edges);
  const [lanes, setLanes] = useState<FlowLane[]>(initialState.lanes);
  const [canvasWidth, setCanvasWidth] = useState<number>(initialState.canvasWidth ?? DEFAULT_CANVAS_WIDTH);
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChangeRef.current({ nodes, edges, lanes, canvasWidth });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nodes, edges, lanes, canvasWidth]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          { ...connection, type: "labeled", data: { label: "" }, markerEnd: DEFAULT_MARKER },
          eds
        )
      );
    },
    [setEdges]
  );

  const addNode = useCallback(
    (kind: FlowNodeKind) => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const center = bounds
        ? screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
        : { x: 200, y: 200 };
      const dims = NODE_DIMENSIONS[kind];
      const newNode: Node<FlowNodeData> = {
        id: nextNodeId(),
        type: kind,
        position: { x: center.x - dims.width / 2, y: center.y - dims.height / 2 },
        width: dims.width,
        height: dims.height,
        data: { label: NODE_LABELS[kind], kind },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes]
  );

  const hasSelection = useMemo(() => nodes.some((n) => n.selected) || edges.some((e) => e.selected), [nodes, edges]);

  const deleteSelection = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  return (
    <div className="flex h-full flex-col">
      <FlowchartToolbar
        title={title}
        onAddNode={addNode}
        lanes={lanes}
        onLanesChange={setLanes}
        onDeleteSelection={deleteSelection}
        hasSelection={hasSelection}
        readOnly={readOnly}
      />
      <div ref={wrapperRef} className="relative flex-1">
        <ReactFlow
          colorMode={darkMode ? "dark" : "light"}
          nodes={nodes}
          edges={edges}
          onNodesChange={readOnly ? undefined : onNodesChange}
          onEdgesChange={readOnly ? undefined : onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          defaultEdgeOptions={{ type: "labeled", markerEnd: DEFAULT_MARKER }}
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
        >
          <LaneOverlay lanes={lanes} width={canvasWidth} onWidthChange={readOnly ? undefined : setCanvasWidth} readOnly={readOnly} />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-background" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function FlowchartCanvas(props: FlowchartCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowchartCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
