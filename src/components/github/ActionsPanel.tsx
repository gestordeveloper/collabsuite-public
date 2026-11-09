import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Play, RefreshCw, RotateCcw, Square } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import * as gh from "@/src/services/github.service";
import { BranchSelect } from "./BranchSelect";
import { Avatar, Empty, ErrorBox, Loading, RunStatus, Segmented, runLabel, timeAgo, useLoad } from "./common";

type Filter = "all" | "completed" | "in_progress" | "failure";
const FILTERS: { value: Filter; label: string }[] = [{ value: "all", label: "Todas" }, { value: "in_progress", label: "Em execução" }, { value: "failure", label: "Falhas" }, { value: "completed", label: "Concluídas" }];

export function ActionsPanel({ projectId, link }: { projectId: number; link: gh.RepoLink }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openRun, setOpenRun] = useState<number | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const { data, loading, error, reload } = useLoad(() => gh.listRuns(projectId, { status: filter === "all" ? undefined : filter }), [projectId, filter]);

  // Enquanto houver execução em andamento, atualiza sozinho a cada 10 s.
  const active = data?.runs.some((r) => r.status !== "completed") ?? false;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void reloadRef.current(), 10_000);
    return () => clearInterval(t);
  }, [active]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Filter> value={filter} options={FILTERS} onChange={setFilter} />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void reload()} aria-label="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
          {link.can_write && <Button size="sm" onClick={() => setDispatching((d) => !d)}><Play className="h-4 w-4" /> Rodar workflow</Button>}
        </div>
      </div>

      {dispatching && <DispatchForm projectId={projectId} link={link} onDone={() => { setDispatching(false); void reload(); }} />}

      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading /> : !data || data.runs.length === 0 ? (
        <Empty>Nenhuma execução encontrada. Adicione um workflow em <code>.github/workflows/</code> para começar.</Empty>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {data.runs.map((r) => (
            <RunRow key={r.id} run={r} projectId={projectId} link={link} open={openRun === r.id} onToggle={() => setOpenRun(openRun === r.id ? null : r.id)} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RunRow({ run, projectId, link, open, onToggle, onChanged }: { run: gh.Run; projectId: number; link: gh.RepoLink; open: boolean; onToggle: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(gh.errMsg(err));
    } finally {
      setBusy(null);
    }
  }
  const running = run.status !== "completed";

  return (
    <li>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? "Recolher" : "Ver jobs"} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <RunStatus status={run.status} conclusion={run.conclusion} />
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium">{run.title || run.name}</span>
          <span className="block text-xs text-muted-foreground">
            {run.name} #{run.run_number}{run.attempt > 1 ? ` (tentativa ${run.attempt})` : ""} · {runLabel(run.status, run.conclusion)} · <span className="font-mono">{run.branch}</span> · {run.sha} · {run.event} · {timeAgo(run.updated_at)}
          </span>
        </button>
        <Avatar person={run.actor} size={20} />
        {link.can_write && (
          <div className="flex shrink-0 items-center gap-0.5">
            {running ? (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => confirm("Cancelar esta execução?") && act("cancel", () => gh.cancelRun(projectId, run.id))} aria-label="Cancelar execução"><Square className="h-4 w-4 text-destructive" /></Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act("rerun", () => gh.rerunRun(projectId, run.id, run.conclusion === "failure"))} aria-label={run.conclusion === "failure" ? "Reexecutar jobs que falharam" : "Reexecutar"} title={run.conclusion === "failure" ? "Reexecutar jobs que falharam" : "Reexecutar"}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
        <a href={run.html_url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent" aria-label="Abrir no GitHub"><ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
      {error && <div className="px-3 pb-2"><ErrorBox message={error} /></div>}
      {open && <Jobs projectId={projectId} runId={run.id} />}
    </li>
  );
}

function Jobs({ projectId, runId }: { projectId: number; runId: number }) {
  const { data, loading, error, reload } = useLoad(() => gh.getRunJobs(projectId, runId), [projectId, runId]);
  const [logJob, setLogJob] = useState<number | null>(null);
  return (
    <div className="space-y-2 border-t bg-surface/40 px-4 py-3">
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading || !data ? <Loading /> : data.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum job ainda.</p> : (
        data.map((j) => (
          <div key={j.id} className="rounded-lg border bg-card">
            <button type="button" onClick={() => setLogJob(logJob === j.id ? null : j.id)} aria-expanded={logJob === j.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-accent/40">
              <RunStatus status={j.status} conclusion={j.conclusion} />
              <span className="flex-1 font-medium">{j.name}</span>
              <span className="text-xs text-muted-foreground">{runLabel(j.status, j.conclusion)}</span>
              {logJob === j.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {logJob === j.id && (
              <div className="border-t">
                <ul className="space-y-1 px-3 py-2">
                  {j.steps.map((s) => (
                    <li key={s.number} className="flex items-center gap-2 text-xs"><RunStatus status={s.status} conclusion={s.conclusion} className="h-3.5 w-3.5" /> {s.number}. {s.name}</li>
                  ))}
                </ul>
                <Logs projectId={projectId} jobId={j.id} />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function Logs({ projectId, jobId }: { projectId: number; jobId: number }) {
  const { data, loading, error, reload } = useLoad(() => gh.getJobLogs(projectId, jobId), [projectId, jobId]);
  if (error) return <div className="p-3"><ErrorBox message={error} onRetry={reload} /></div>;
  if (loading || !data) return <Loading label="Carregando logs…" />;
  return (
    <div>
      {data.truncated && <p className="border-t bg-warning/10 px-3 py-1 text-xs text-warning">Log muito grande: mostrando só o final.</p>}
      <pre className="max-h-[420px] overflow-auto border-t bg-background p-3 font-mono text-[11.5px] leading-[1.5]" aria-label="Logs do job">{data.text || "(log vazio)"}</pre>
    </div>
  );
}

function DispatchForm({ projectId, link, onDone }: { projectId: number; link: gh.RepoLink; onDone: () => void }) {
  const { data: workflows } = useLoad(() => gh.listWorkflows(projectId), [projectId]);
  const [workflowId, setWorkflowId] = useState<number | null>(null);
  const [ref, setRef] = useState(link.default_branch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = (workflows ?? []).filter((w) => w.state === "active");
  const chosen = workflowId ?? active[0]?.id ?? null;

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (chosen === null) return;
    setBusy(true);
    setError(null);
    try {
      await gh.dispatchWorkflow(projectId, chosen, ref);
      onDone();
    } catch (err) {
      setError(gh.errMsg(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={run} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
      <div className="space-y-1">
        <label htmlFor="wf" className="text-xs text-muted-foreground">Workflow</label>
        <select id="wf" value={chosen ?? ""} onChange={(e) => setWorkflowId(Number(e.target.value))} className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none">
          {active.length === 0 && <option value="">Nenhum workflow ativo</option>}
          {active.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.path.split("/").pop()})</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <span className="block text-xs text-muted-foreground">Branch</span>
        <BranchSelect projectId={projectId} value={ref} onChange={setRef} />
      </div>
      <Button type="submit" disabled={busy || chosen === null}><Play className="h-4 w-4" /> {busy ? "Disparando…" : "Rodar"}</Button>
      <p className="w-full text-xs text-subtle">O workflow precisa ter o gatilho <code>workflow_dispatch</code> para poder ser disparado manualmente.</p>
      {error && <div className="w-full"><ErrorBox message={error} /></div>}
    </form>
  );
}
