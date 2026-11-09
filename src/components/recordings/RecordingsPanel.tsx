import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Search, Loader2, AlertTriangle, ListTodo, Clock, Cloud } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { useDashboard } from "@/src/context/dashboard.context";
import * as recordingService from "@/src/services/recording.service";
import { isProcessing, formatDuration } from "@/src/services/recording.service";
import type { Recording } from "@/src/services/recording.service";
import { NewRecordingDialog } from "./NewRecordingDialog";
import { RecordingDetailDialog } from "./RecordingDetailDialog";

interface Props {
  /** Dentro de um projeto: lista só as gravações dele. Sem isto, lista tudo o que o usuário enxerga. */
  projectId?: number;
}

export function RecordingsPanel({ projectId }: Props) {
  const { projects } = useDashboard();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [newOpen, setNewOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const effectiveProject = projectId ?? (projectFilter ? Number(projectFilter) : undefined);

  const load = useCallback(async () => {
    try {
      setRecordings(await recordingService.fetchRecordings({ projectId: effectiveProject, q: queryRef.current.trim() }));
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar as gravações.");
    } finally {
      setLoading(false);
    }
  }, [effectiveProject]);

  useEffect(() => {
    setLoading(true);
    const t = window.setTimeout(load, query ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);

  // Mantém a lista viva enquanto alguma gravação está sendo processada pela IA.
  const anyProcessing = recordings.some(isProcessing);
  useEffect(() => {
    if (!anyProcessing) return;
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [anyProcessing, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar em títulos, resumos e transcrições…"
            className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
          />
        </div>
        {projectId == null && (
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none"
          >
            <option value="">Todos os projetos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <Button className="gap-2" onClick={() => setNewOpen(true)}>
          <Mic className="h-4 w-4" /> Nova gravação
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && recordings.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : recordings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <Cloud className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{query ? "Nenhuma gravação encontrada." : "Nenhuma gravação ainda."}</p>
            {!query && (
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                Grave uma reunião ou envie um áudio. Ele vai para a sua conta AWS, é transcrito e a IA extrai as ações para enviar ao backlog.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {recordings.map((r) => {
            const pending = r.actions.filter((a) => a.status === "pending").length;
            return (
              <button
                key={r.id}
                onClick={() => setOpenId(r.id)}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {isProcessing(r) ? <Loader2 className="h-4 w-4 animate-spin" /> : r.status === "error" ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{r.title}</h3>
                    <Badge variant="outline">{r.tipo}</Badge>
                    {r.category && <Badge variant="outline">{r.category}</Badge>}
                    {projectId == null && r.project && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ background: r.project.color || "#EC1889" }} /> {r.project.name}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {isProcessing(r)
                      ? r.progress_label || "Processando…"
                      : r.status === "error"
                        ? r.error || "Falha ao processar."
                        : r.summary || "Sem resumo."}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{new Date(r.recorded_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(r.duration_seconds)}</span>
                    {r.status === "done" && r.actions.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <ListTodo className="h-3 w-3" /> {pending > 0 ? `${pending} ações a enviar` : `${r.actions.length} ações`}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <NewRecordingDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projects={projects}
        fixedProjectId={projectId}
        onCreated={(created) => {
          load();
          setOpenId(created.id);
        }}
      />
      <RecordingDetailDialog recordingId={openId} projects={projects} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}
