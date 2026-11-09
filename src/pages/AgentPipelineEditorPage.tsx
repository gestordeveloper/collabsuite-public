import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, Loader2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/src/components/ui/dialog";
import { AgentPipelineCanvas } from "@/src/components/agent-pipeline/AgentPipelineCanvas";
import { RunHistoryPanel } from "@/src/components/agent-pipeline/RunHistoryPanel";
import { useAgentRunSocket } from "@/src/hooks/useAgentRunSocket";
import * as pipelineService from "@/src/services/agent-pipeline.service";
import * as agentService from "@/src/services/agent.service";
import type { AgentPipeline, PipelineNode, PipelineEdge } from "@/src/services/agent-pipeline.service";
import type { Agent } from "@/src/services/agent.service";

type NodeStatus = "pending" | "running" | "done" | "error";

export function AgentPipelineEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [pipeline, setPipeline] = useState<AgentPipeline | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runInput, setRunInput] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({});
  const [historyKey, setHistoryKey] = useState(0);

  const isFirstLoad = useRef(true);

  useEffect(() => {
    if (!id) return;
    isFirstLoad.current = true;
    Promise.all([pipelineService.fetchPipeline(Number(id)), agentService.fetchAgents()])
      .then(([p, a]) => {
        setPipeline(p);
        setNameDraft(p.name);
        setAgents(a);
      })
      .finally(() => setLoading(false));
  }, [id]);

  function handleCanvasChange(nodes: PipelineNode[], edges: PipelineEdge[]) {
    if (!pipeline || isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    setSaving(true);
    pipelineService
      .updatePipeline(pipeline.id, { nodes, edges })
      .then((updated) => setPipeline(updated))
      .catch((err) => console.error("Falha ao salvar pipeline", err))
      .finally(() => setSaving(false));
  }

  function handleNameBlur() {
    if (!pipeline || !nameDraft.trim() || nameDraft === pipeline.name) return;
    pipelineService.updatePipeline(pipeline.id, { name: nameDraft.trim() }).then(setPipeline);
  }

  async function handleRun() {
    if (!pipeline || !runInput.trim() || running) return;
    setRunning(true);
    setRunError(null);
    const seeded: Record<string, NodeStatus> = {};
    pipeline.nodes.forEach((n) => {
      seeded[n.id] = "pending";
    });
    setNodeStatuses(seeded);
    try {
      const { run_id } = await pipelineService.runPipeline(pipeline.id, runInput.trim());
      setActiveRunId(run_id);
      setRunDialogOpen(false);
      setRunInput("");
    } catch (err: any) {
      setRunError(err?.response?.data?.error || "Não foi possível iniciar a execução.");
    } finally {
      setRunning(false);
    }
  }

  useAgentRunSocket(activeRunId, {
    onStepStarted: (e) => {
      if (e.nodeId) setNodeStatuses((s) => ({ ...s, [e.nodeId!]: "running" }));
    },
    onStepFinished: (e) => {
      if (e.nodeId) setNodeStatuses((s) => ({ ...s, [e.nodeId!]: e.error ? "error" : "done" }));
    },
    onFinished: () => {
      setHistoryKey((k) => k + 1);
      setActiveRunId(null);
    },
  });

  if (loading || !pipeline) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate("/agentes/pipelines")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={handleNameBlur}
          className="h-8 max-w-xs border-none bg-transparent px-1 text-sm font-semibold shadow-none focus-visible:ring-1"
        />
        <span className="text-xs text-muted-foreground">{saving ? "Salvando..." : "Salvo"}</span>
        <div className="flex-1" />
        <Button size="sm" className="gap-1.5" onClick={() => setRunDialogOpen(true)} disabled={activeRunId != null}>
          {activeRunId != null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {activeRunId != null ? "Executando..." : "Executar"}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <AgentPipelineCanvas
            initialNodes={pipeline.nodes}
            initialEdges={pipeline.edges}
            agents={agents}
            nodeStatuses={nodeStatuses}
            onChange={handleCanvasChange}
          />
        </div>
        <div className="hidden w-80 shrink-0 border-l bg-card md:block">
          <RunHistoryPanel pipelineId={pipeline.id} refreshKey={historyKey} />
        </div>
      </div>

      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar pipeline</DialogTitle>
          </DialogHeader>
          <Textarea
            value={runInput}
            onChange={(e) => setRunInput(e.target.value)}
            placeholder="Escreva a entrada inicial para o primeiro agente do pipeline..."
            rows={5}
          />
          {runError && <p className="text-sm text-destructive">{runError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRunDialogOpen(false)} disabled={running}>
              Cancelar
            </Button>
            <Button onClick={handleRun} disabled={running || !runInput.trim()}>
              {running ? "Iniciando..." : "Executar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
