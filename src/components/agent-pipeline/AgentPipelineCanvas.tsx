import { useCallback, useEffect, useRef, useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import { pipelineNodeTypes, type AgentPipelineNodeData } from "./pipeline-nodes";
import { LabeledEdge } from "@/src/components/flowchart/edges";
import { Button } from "@/src/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import type { Agent } from "@/src/services/agent.service";
import type { PipelineNode, PipelineEdge } from "@/src/services/agent-pipeline.service";

const edgeTypes = { labeled: LabeledEdge };
const DEFAULT_MARKER = { type: MarkerType.ArrowClosed, color: "#64748b", width: 18, height: 18 };

let nodeCounter = 0;
function nextNodeId() {
  nodeCounter += 1;
  return `agent-node-${Date.now()}-${nodeCounter}`;
}

function toFlowNode(n: PipelineNode, agentsById: Record<number, Agent>): Node<AgentPipelineNodeData> {
  const agent = agentsById[n.data.agentId];
  return {
    id: n.id,
    type: "agent",
    position: n.position,
    data: {
      agentId: n.data.agentId,
      name: agent?.name || "Agente removido",
      provider: agent?.provider || "?",
      avatarEmoji: agent?.avatar_emoji,
      avatarColor: agent?.avatar_color,
    },
  };
}

export interface AgentPipelineCanvasProps {
  initialNodes: PipelineNode[];
  initialEdges: PipelineEdge[];
  agents: Agent[];
  nodeStatuses?: Record<string, "pending" | "running" | "done" | "error">;
  onChange: (nodes: PipelineNode[], edges: PipelineEdge[]) => void;
  readOnly?: boolean;
}

function AgentPipelineCanvasInner({ initialNodes, initialEdges, agents, nodeStatuses, onChange, readOnly }: AgentPipelineCanvasProps) {
  const darkMode = useThemeStore((s) => s.darkMode);
  const agentsById = Object.fromEntries(agents.map((a) => [a.id, a]));
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentPipelineNodeData>>(
    initialNodes.map((n) => toFlowNode(n, agentsById))
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges as Edge[]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!nodeStatuses) return;
    setNodes((nds) => nds.map((n) => (nodeStatuses[n.id] ? { ...n, data: { ...n.data, status: nodeStatuses[n.id] } } : n)));
  }, [nodeStatuses, setNodes]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const outNodes: PipelineNode[] = nodes.map((n) => ({
        id: n.id,
        type: "agent",
        position: n.position,
        data: { agentId: n.data.agentId },
      }));
      const outEdges: PipelineEdge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type }));
      onChangeRef.current(outNodes, outEdges);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nodes, edges]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: "labeled", data: {}, markerEnd: DEFAULT_MARKER }, eds));
    },
    [setEdges]
  );

  const addAgentNode = useCallback(() => {
    const agentId = parseInt(selectedAgentId);
    const agent = agentsById[agentId];
    if (!agent) return;
    const bounds = wrapperRef.current?.getBoundingClientRect();
    const center = bounds
      ? screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
      : { x: 200, y: 200 };
    const newNode: Node<AgentPipelineNodeData> = {
      id: nextNodeId(),
      type: "agent",
      position: { x: center.x - 112, y: center.y - 32 },
      data: {
        agentId: agent.id,
        name: agent.name,
        provider: agent.provider,
        avatarEmoji: agent.avatar_emoji,
        avatarColor: agent.avatar_color,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [selectedAgentId, agentsById, screenToFlowPosition, setNodes]);

  const hasSelection = nodes.some((n) => n.selected) || edges.some((e) => e.selected);
  const deleteSelection = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  return (
    <div className="flex h-full flex-col">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-card p-2">
          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="Escolher agente..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.avatar_emoji || "🤖"} {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={addAgentNode} disabled={!selectedAgentId}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar ao canvas
          </Button>
          {hasSelection && (
            <Button size="sm" variant="ghost" onClick={deleteSelection}>
              <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Remover seleção
            </Button>
          )}
        </div>
      )}
      <div ref={wrapperRef} className="relative flex-1">
        <ReactFlow
          colorMode={darkMode ? "dark" : "light"}
          nodes={nodes}
          edges={edges}
          onNodesChange={readOnly ? undefined : onNodesChange}
          onEdgesChange={readOnly ? undefined : onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
          nodeTypes={pipelineNodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          defaultEdgeOptions={{ type: "labeled", markerEnd: DEFAULT_MARKER }}
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-background" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function AgentPipelineCanvas(props: AgentPipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <AgentPipelineCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
