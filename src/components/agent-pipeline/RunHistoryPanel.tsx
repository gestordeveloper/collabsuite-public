import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Clock, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { fetchRuns, fetchRun, type AgentRun } from "@/src/services/agent-run.service";

function extractImageUrls(toolCallsJson: string | null): string[] {
  if (!toolCallsJson) return [];
  try {
    const calls = JSON.parse(toolCallsJson) as { tool: string; result: string }[];
    return calls
      .filter((c) => c.tool === "generate_image")
      .map((c) => {
        try {
          return JSON.parse(c.result)?.image_url as string | undefined;
        } catch {
          return undefined;
        }
      })
      .filter((url): url is string => !!url);
  } catch {
    return [];
  }
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  done: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
};

function RunRow({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<AgentRun | null>(null);

  async function toggle() {
    if (!expanded && !detail) {
      const full = await fetchRun(run.id);
      setDetail(full);
    }
    setExpanded((v) => !v);
  }

  return (
    <div className="rounded-lg border">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 p-2.5 text-left hover:bg-muted/40">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        {STATUS_ICON[run.status]}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{run.input || "(sem entrada)"}</p>
          <p className="text-[11px] text-muted-foreground">{new Date(run.created_at).toLocaleString("pt-BR")}</p>
        </div>
      </button>
      {expanded && detail && (
        <div className="space-y-2 border-t p-2.5">
          {detail.steps?.map((step) => {
            const imageUrls = extractImageUrls(step.tool_calls);
            return (
              <div key={step.id} className="rounded-md bg-muted/30 p-2 text-xs">
                <div className="flex items-center gap-1.5 font-medium">
                  {STATUS_ICON[step.status]}
                  <span>Etapa {step.step_order + 1}</span>
                </div>
                {step.output && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{step.output}</p>}
                {step.error && <p className="mt-1 text-destructive">{step.error}</p>}
                {imageUrls.map((url) => (
                  <img key={url} src={url} alt="Imagem gerada" className="mt-1.5 max-w-[180px] rounded-lg border" />
                ))}
              </div>
            );
          })}
          {detail.output && !detail.steps?.length && (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{detail.output}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function RunHistoryPanel({ pipelineId, agentId, refreshKey }: { pipelineId?: number; agentId?: number; refreshKey?: number }) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);

  useEffect(() => {
    fetchRuns({ pipelineId, agentId }).then(setRuns);
  }, [pipelineId, agentId, refreshKey]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Histórico de execuções</h3>
      {!runs ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma execução ainda.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
