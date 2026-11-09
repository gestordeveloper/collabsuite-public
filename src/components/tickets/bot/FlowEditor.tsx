import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Loader2, Rocket, Save } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/lib/utils";
import { useThemeStore } from "@/src/store/theme.store";
import {
  errorMessage,
  fetchBotFlow,
  publishBotFlow,
  saveBotFlow,
  type BotFlowDetail,
  type TeamMember,
  type TicketQueue,
  type TicketTag,
} from "@/src/services/ticket.service";
import { botNodeTypes, type BotFlowNode } from "./BotNode";
import { NodeConfigPanel } from "./NodeConfigPanel";
import { NODE_GROUPS, NODE_META, newId, type NodeType } from "./nodeMeta";

interface Props {
  flowId: number;
  queues: TicketQueue[];
  team: TeamMember[];
  tags: TicketTag[];
  onClose: () => void;
  onNotify: (message: string) => void;
}

interface StoredGraph {
  nodes: { id: string; type: NodeType; position?: { x: number; y: number }; data: Record<string, any> }[];
  edges: { id: string; source: string; target: string; sourceHandle?: string | null }[];
  startNodeId: string;
}

function parseGraph(raw: string | null): StoredGraph {
  try {
    const g = raw ? JSON.parse(raw) : null;
    return { nodes: g?.nodes ?? [], edges: g?.edges ?? [], startNodeId: g?.startNodeId ?? "" };
  } catch {
    return { nodes: [], edges: [], startNodeId: "" };
  }
}

const edgeDefaults = { markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 1.75 } };

function Editor({ flowId, queues, team, tags, onClose, onNotify }: Props) {
  const [flow, setFlow] = useState<BotFlowDetail | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BotFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [startId, setStartId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"save" | "publish" | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const darkMode = useThemeStore((s) => s.darkMode);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchBotFlow(flowId)
      .then((f) => {
        const g = parseGraph(f.draft_graph);
        setFlow(f);
        setStartId(g.startNodeId);
        setNodes(g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position ?? { x: 0, y: 0 }, data: n.data })));
        setEdges(g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, ...edgeDefaults })));
        // Os nós chegam depois da montagem: o fitView inicial do React Flow já passou, então enquadra de novo.
        setTimeout(() => void fitView({ padding: 0.25, maxZoom: 1 }), 80);
      })
      .catch((err) => {
        onNotify(errorMessage(err, "Não foi possível abrir o fluxo."));
        onClose();
      });
  }, [flowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDirty = useCallback(() => setDirty(true), []);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          __isStart: n.id === startId,
          __queueName: queues.find((q) => q.id === n.data.queueId)?.name,
          __userName: (() => {
            const u = team.find((m) => m.id === n.data.userId);
            return u ? `${u.first_name} ${u.last_name ?? ""}`.trim() : undefined;
          })(),
        },
      })),
    [nodes, startId, queues, team]
  );
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => {
        // Uma saída só leva a um destino: reconectar a mesma saída substitui a aresta anterior.
        const filtered = eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)));
        return addEdge({ ...c, id: newId("e"), ...edgeDefaults }, filtered);
      });
      markDirty();
    },
    [setEdges, markDirty]
  );

  function addNode(type: NodeType) {
    const box = wrapper.current?.getBoundingClientRect();
    const center = screenToFlowPosition({ x: (box?.left ?? 0) + (box?.width ?? 600) / 2 + (nodes.length % 4) * 24, y: (box?.top ?? 0) + (box?.height ?? 400) / 3 + (nodes.length % 4) * 24 });
    const id = newId("n");
    setNodes((ns) => [...ns, { id, type, position: { x: center.x - 120, y: center.y }, data: NODE_META[type].defaults() } as BotFlowNode]);
    if (!startId && nodes.length === 0) setStartId(id);
    setSelectedId(id);
    markDirty();
  }

  function patchSelected(patch: Record<string, unknown>) {
    if (!selected) return;
    setNodes((ns) => ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
    // Opção de menu removida → as arestas que saíam dela ficariam órfãs.
    if (selected.type === "menu" && Array.isArray(patch.options)) {
      const ids = new Set((patch.options as { id: string }[]).map((o) => o.id));
      setEdges((es) => es.filter((e) => e.source !== selected.id || (e.sourceHandle != null && ids.has(e.sourceHandle))));
    }
    markDirty();
  }

  function deleteSelected() {
    if (!selected) return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
    if (startId === selected.id) setStartId("");
    setSelectedId(null);
    markDirty();
  }

  function buildGraph(): StoredGraph {
    return {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type as NodeType, position: n.position, data: n.data })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
      startNodeId: startId,
    };
  }

  async function persist(publish: boolean) {
    setSaving(publish ? "publish" : "save");
    try {
      if (publish && !startId) throw new Error("Defina o nó de início antes de publicar.");
      let saved = await saveBotFlow(flowId, { draft_graph: buildGraph() });
      if (publish) saved = await publishBotFlow(flowId);
      setFlow(saved);
      setDirty(false);
      onNotify(publish ? "Fluxo publicado: já vale para novas conversas." : "Rascunho salvo.");
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  const unpublished = dirty || flow?.has_unpublished_changes;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center gap-3 border-b bg-surface px-3 py-2.5">
        <Button variant="ghost" size="icon" onClick={() => (!dirty || window.confirm("Há alterações não salvas. Sair mesmo assim?")) && onClose()} aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold">{flow?.name ?? "Carregando…"}</p>
          <p className="text-xs text-muted-foreground">
            {flow?.type === "entry" ? "Fluxo de entrada" : flow?.type === "queue" ? `Fluxo da fila ${flow.queue?.name ?? ""}` : "Fluxo de automação"}
          </p>
        </div>
        {unpublished ? <Badge variant="warning">Alterações não publicadas</Badge> : flow?.published_at ? <Badge variant="success">Publicado</Badge> : <Badge variant="secondary">Rascunho</Badge>}
        <Button variant="outline" size="sm" onClick={() => void persist(false)} disabled={!!saving || !flow}>
          {saving === "save" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}Salvar
        </Button>
        <Button size="sm" onClick={() => void persist(true)} disabled={!!saving || !flow}>
          {saving === "publish" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}Publicar
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r bg-surface p-3 md:block">
          {NODE_GROUPS.map((g) => (
            <div key={g.label} className="mb-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">{g.label}</p>
              <div className="space-y-1">
                {g.types.map((t) => {
                  const m = NODE_META[t];
                  return (
                    <button key={t} type="button" onClick={() => addNode(t)} title={m.hint} className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium hover:bg-accent">
                      <m.icon className="h-3.5 w-3.5 shrink-0" style={{ color: m.color }} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        <div ref={wrapper} className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            nodeTypes={botNodeTypes}
            onNodesChange={(c) => {
              onNodesChange(c);
              if (c.some((x) => x.type === "position" && x.dragging === false)) markDirty();
            }}
            onEdgesChange={(c) => {
              onEdgesChange(c);
              if (c.some((x) => x.type === "remove")) markDirty();
            }}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            colorMode={darkMode ? "dark" : "light"}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.3}
            deleteKeyCode={["Backspace", "Delete"]}
            onNodesDelete={(del) => {
              if (del.some((n) => n.id === startId)) setStartId("");
              setSelectedId(null);
              markDirty();
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {nodes.length === 0 && flow && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">Fluxo vazio. Adicione um nó pela barra à esquerda — o primeiro vira o início — e ligue as saídas aos próximos passos.</p>
            </div>
          )}
        </div>

        <aside className={cn("w-72 shrink-0 overflow-y-auto border-l bg-surface", selected ? "block" : "hidden lg:block")}>
          {selected ? (
            <NodeConfigPanel
              nodeType={selected.type as NodeType}
              data={selected.data}
              isStart={selected.id === startId}
              queues={queues}
              team={team}
              tags={tags}
              onChange={patchSelected}
              onSetStart={() => { setStartId(selected.id); markDirty(); }}
              onDelete={deleteSelected}
            />
          ) : (
            <div className="space-y-3 p-4 text-sm text-muted-foreground">
              <p className="font-display font-semibold text-foreground">Como montar o fluxo</p>
              <p>1. Adicione nós pela barra à esquerda.</p>
              <p>2. Arraste da bolinha de saída de um nó até o próximo.</p>
              <p>3. Clique em um nó para configurar.</p>
              <p>4. Salve o rascunho e <strong className="text-foreground">publique</strong> quando estiver pronto — o rascunho não afeta conversas em andamento.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
