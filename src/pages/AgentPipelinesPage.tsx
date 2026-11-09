import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Workflow, MoreVertical, Trash2, ArrowLeft } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/src/components/ui/dropdown-menu";
import * as pipelineService from "@/src/services/agent-pipeline.service";
import type { AgentPipeline } from "@/src/services/agent-pipeline.service";

export function AgentPipelinesPage() {
  const navigate = useNavigate();
  const [pipelines, setPipelines] = useState<AgentPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    pipelineService
      .fetchPipelines()
      .then(setPipelines)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const pipeline = await pipelineService.createPipeline({ name: "Novo pipeline", nodes: [], edges: [] });
      navigate(`/agentes/pipelines/${pipeline.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir este pipeline? Essa ação não pode ser desfeita.")) return;
    await pipelineService.deletePipeline(id);
    setPipelines((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/agentes")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Pipelines de agentes</h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Conecte agentes num canvas visual para formar cadeias de execução.
          </p>
        </div>
        <Button onClick={handleCreate} disabled={creating} className="gap-2">
          <Plus className="h-4 w-4" /> Novo pipeline
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : pipelines.length === 0 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-dashed bg-card py-20 text-center">
          <Workflow className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
          <p className="font-medium text-muted-foreground">Nenhum pipeline criado ainda.</p>
          <Button onClick={handleCreate} variant="secondary" size="sm" className="mt-4 gap-1.5" disabled={creating}>
            <Plus className="h-3.5 w-3.5" /> Criar primeiro pipeline
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pipelines.map((pipeline) => (
            <Card
              key={pipeline.id}
              className="cursor-pointer p-4 transition-all hover:shadow-md hover:border-primary/40"
              onClick={() => navigate(`/agentes/pipelines/${pipeline.id}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Workflow className="h-5 w-5 text-primary" />
                  <h3 className="text-sm font-semibold">{pipeline.name}</h3>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(pipeline.id)}>
                      <Trash2 className="h-4 w-4" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{pipeline.nodes.length} agente(s) conectado(s)</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
