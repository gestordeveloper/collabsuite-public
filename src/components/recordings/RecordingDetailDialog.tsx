import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Download, Loader2, RotateCcw, Trash2, Send, ExternalLink, X, Check, Copy, AlertTriangle, ListTodo, Link2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/lib/utils";
import * as recordingService from "@/src/services/recording.service";
import { isProcessing, formatDuration } from "@/src/services/recording.service";
import type { RecordingDetail, RecordingAction, ActionPriority } from "@/src/services/recording.service";
import type { Project } from "@/src/types";

const PRIORITY_STYLE: Record<ActionPriority, string> = {
  P1: "bg-destructive/10 text-destructive border-destructive/30",
  P2: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  P3: "bg-muted text-muted-foreground border-border",
};

interface Props {
  recordingId: number | null;
  projects: Project[];
  onClose: () => void;
  /** Avisa a lista que algo mudou (título, projeto, ações, exclusão…). */
  onChanged: () => void;
}

export function RecordingDetailDialog({ recordingId, projects, onClose, onChanged }: Props) {
  const navigate = useNavigate();
  const [rec, setRec] = useState<RecordingDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [funnelId, setFunnelId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (recordingId == null) return;
    try {
      setRec(await recordingService.fetchRecording(recordingId));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar a gravação.");
    }
  }, [recordingId]);

  useEffect(() => {
    setRec(null);
    setAudioUrl(null);
    setError(null);
    setSelected(new Set());
    setSentMessage(null);
    setFunnelId("");
    if (recordingId == null) return;
    load();
    recordingService.fetchAudioUrl(recordingId).then(setAudioUrl).catch(() => {});
  }, [recordingId, load]);

  // Enquanto a IA trabalha, acompanha o progresso.
  useEffect(() => {
    if (!rec || !isProcessing(rec)) return;
    const t = window.setInterval(() => {
      load();
      onChanged();
    }, 3000);
    return () => window.clearInterval(t);
  }, [rec, load, onChanged]);

  const project = useMemo(() => projects.find((p) => p.id === rec?.project_id) ?? null, [projects, rec?.project_id]);
  const pendingActions = useMemo(() => (rec?.actions ?? []).filter((a) => a.status === "pending"), [rec]);
  const effectiveFunnelId = funnelId ? Number(funnelId) : (project?.funnels.find((f) => f.is_default) ?? project?.funnels[0])?.id;
  const targetFunnel = project?.funnels.find((f) => f.id === effectiveFunnelId);
  const targetStage = targetFunnel
    ? [...targetFunnel.stages].sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0)).find((s) => s.name.trim().toLowerCase() === "backlog") ??
      [...targetFunnel.stages].sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0))[0]
    : undefined;

  useEffect(() => {
    // Por padrão deixa todas as ações pendentes marcadas.
    setSelected(new Set(pendingActions.map((a) => a.id)));
  }, [pendingActions.length, rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run<T>(fn: () => Promise<T>, fallback: string): Promise<T | undefined> {
    setError(null);
    try {
      return await fn();
    } catch (err: any) {
      setError(err?.response?.data?.error || fallback);
    }
  }

  async function patchAction(action: RecordingAction, data: Parameters<typeof recordingService.updateAction>[2]) {
    if (!rec) return;
    const updated = await run(() => recordingService.updateAction(rec.id, action.id, data), "Não foi possível atualizar a ação.");
    if (updated) {
      setRec({ ...rec, actions: rec.actions.map((a) => (a.id === action.id ? updated : a)) });
      onChanged();
    }
  }

  async function sendToBacklog() {
    if (!rec) return;
    setSending(true);
    setSentMessage(null);
    const result = await run(
      () => recordingService.sendActionsToBacklog(rec.id, { actionIds: [...selected], funnelId: effectiveFunnelId }),
      "Não foi possível enviar as ações."
    );
    setSending(false);
    if (result) {
      setSentMessage(`${result.tasks.length} ${result.tasks.length === 1 ? "tarefa criada" : "tarefas criadas"} em “${targetStage?.name ?? "Backlog"}”.`);
      await load();
      onChanged();
    }
  }

  async function assignProject(value: string) {
    if (!rec) return;
    const updated = await run(() => recordingService.updateRecording(rec.id, { project_id: value ? Number(value) : null }), "Não foi possível vincular o projeto.");
    if (updated) {
      setFunnelId("");
      await load();
      onChanged();
    }
  }

  async function rename() {
    if (!rec) return;
    const next = window.prompt("Novo título da gravação:", rec.title)?.trim();
    if (!next || next === rec.title) return;
    const updated = await run(() => recordingService.updateRecording(rec.id, { title: next }), "Não foi possível renomear.");
    if (updated) {
      setRec({ ...rec, title: updated.title });
      onChanged();
    }
  }

  async function remove() {
    if (!rec || !window.confirm(`Excluir “${rec.title}”? O áudio será apagado da nuvem. As tarefas já criadas permanecem.`)) return;
    const ok = await run(() => recordingService.deleteRecording(rec.id).then(() => true), "Não foi possível excluir.");
    if (ok) {
      onChanged();
      onClose();
    }
  }

  async function reprocess() {
    if (!rec) return;
    const updated = await run(() => recordingService.reprocessRecording(rec.id), "Não foi possível reprocessar.");
    if (updated) {
      setRec(updated);
      onChanged();
    }
  }

  async function toggleShare(enable: boolean) {
    if (!rec) return;
    const token = await run(() => recordingService.setRecordingSharing(rec.id, enable), "Não foi possível alterar o compartilhamento.");
    if (token === undefined) return;
    setRec({ ...rec, share_token: token });
    if (token) {
      await navigator.clipboard.writeText(recordingService.recordingShareUrl(token)).catch(() => {});
      setCopied("link");
      setTimeout(() => setCopied(null), 2000);
    }
  }

  async function download() {
    if (!rec) return;
    const url = await run(() => recordingService.fetchAudioUrl(rec.id, true), "Não foi possível gerar o link de download.");
    if (url) window.location.href = url;
  }

  function saveText(name: string, content: string, mime = "text/plain") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  }

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedCount = pendingActions.filter((a) => selected.has(a.id)).length;
  const processing = rec ? isProcessing(rec) : false;

  return (
    <Dialog open={recordingId != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        {!rec ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            {error ? <span className="text-destructive">{error}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</>}
          </div>
        ) : (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle className="flex items-center gap-2">
                <button className="truncate text-left hover:text-primary" onClick={rename} title="Clique para renomear">{rec.title}</button>
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{new Date(rec.recorded_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                <span>{formatDuration(rec.duration_seconds)}</span>
                <Badge variant="outline">{rec.tipo}</Badge>
                {rec.category && <Badge variant="outline">{rec.category}</Badge>}
                {rec.storage === "s3" ? <span className="text-xs">☁ AWS S3</span> : <span className="text-xs text-amber-500">armazenado localmente (S3 não configurado)</span>}
                </div>
              </DialogDescription>
            </DialogHeader>

            {audioUrl ? (
              <audio controls preload="metadata" src={audioUrl} className="w-full" />
            ) : (
              <div className="h-10 rounded-md bg-muted/50" />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={rec.project_id ?? ""}
                onChange={(e) => assignProject(e.target.value)}
                className="h-8 max-w-[14rem] rounded-md border border-input bg-transparent px-2 text-xs outline-none"
              >
                <option value="">Sem projeto</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="ml-auto flex items-center gap-1">
                {rec.status === "done" && (
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => toggleShare(true)}>
                    {copied === "link" ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                    {copied === "link" ? "Link copiado" : rec.share_token ? "Copiar link" : "Compartilhar"}
                  </Button>
                )}
                {rec.share_token && (
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => toggleShare(false)}>Desativar link</Button>
                )}
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={download}><Download className="h-3.5 w-3.5" /> Áudio</Button>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={reprocess} disabled={processing}><RotateCcw className="h-3.5 w-3.5" /> Reprocessar</Button>
                <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={remove}><Trash2 className="h-3.5 w-3.5" /> Excluir</Button>
              </div>
            </div>

            {processing && (
              <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {rec.progress_label || (rec.status === "analyzing" ? "Analisando com IA…" : "Transcrevendo…")}
              </div>
            )}

            {rec.status === "error" && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{rec.error || "Falha ao processar a gravação."}</span>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            {rec.status === "done" && (
              <Tabs defaultValue="actions">
                <TabsList>
                  <TabsTrigger value="actions">Ações{pendingActions.length ? ` (${pendingActions.length})` : ""}</TabsTrigger>
                  <TabsTrigger value="summary">Resumo</TabsTrigger>
                  <TabsTrigger value="transcript">Transcrição</TabsTrigger>
                  <TabsTrigger value="report">Relatório</TabsTrigger>
                </TabsList>

                <TabsContent value="actions" className="mt-4 space-y-3">
                  {rec.actions.length === 0 && <p className="text-sm text-muted-foreground">A IA não identificou ações nesta gravação.</p>}

                  {rec.actions.map((a) => (
                    <div
                      key={a.id}
                      className={cn("flex items-start gap-3 rounded-lg border bg-card p-3", a.status !== "pending" && "opacity-60")}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={a.status !== "pending"}
                        checked={a.status === "pending" && selected.has(a.id)}
                        onChange={() => toggle(a.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm", a.status === "dismissed" && "line-through")}>{a.text}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {a.status === "pending" ? (
                            <select
                              value={a.priority}
                              onChange={(e) => patchAction(a, { priority: e.target.value as ActionPriority })}
                              className={cn("h-6 rounded border px-1.5 text-[11px] font-semibold outline-none", PRIORITY_STYLE[a.priority])}
                            >
                              <option value="P1">P1 · Crítica</option>
                              <option value="P2">P2 · Alta</option>
                              <option value="P3">P3 · Média</option>
                            </select>
                          ) : (
                            <span className={cn("rounded border px-1.5 py-0.5 text-[11px] font-semibold", PRIORITY_STYLE[a.priority])}>{a.priority}</span>
                          )}
                          {a.owner_name && <span>👤 {a.owner_name}</span>}
                          {a.due_text && <span>📅 {a.due_text}</span>}
                          {a.status === "converted" && a.task_id && (
                            <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => { onClose(); navigate(`/task/${a.task_id}`); }}>
                              <Check className="h-3 w-3" /> Tarefa criada <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                          {a.status === "converted" && !a.task_id && <span>Tarefa criada (já removida)</span>}
                          {a.status === "dismissed" && <span>Descartada</span>}
                        </div>
                      </div>
                      {a.status === "pending" && (
                        <button title="Descartar ação" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => patchAction(a, { status: "dismissed" })}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {a.status === "dismissed" && (
                        <button title="Restaurar ação" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => patchAction(a, { status: "pending" })}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {pendingActions.length > 0 && (
                    <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-lg border bg-popover p-3">
                      {!project ? (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ListTodo className="h-4 w-4" /> Vincule a gravação a um projeto (acima) para enviar as ações ao backlog.
                        </p>
                      ) : !project.funnels.length ? (
                        <p className="text-xs text-muted-foreground">Este projeto ainda não tem um funil. Crie um na aba Funis.</p>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">Enviar para</span>
                          <select
                            value={effectiveFunnelId ?? ""}
                            onChange={(e) => setFunnelId(e.target.value)}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none"
                          >
                            {project.funnels.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                          <span className="text-xs text-muted-foreground">→ etapa <strong className="text-foreground">{targetStage?.name ?? "—"}</strong></span>
                          <Button size="sm" className="ml-auto gap-1.5" disabled={!selectedCount || sending} onClick={sendToBacklog}>
                            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            Enviar {selectedCount} {selectedCount === 1 ? "ação" : "ações"} para o backlog
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {sentMessage && <p className="text-xs text-emerald-500">{sentMessage}</p>}
                </TabsContent>

                <TabsContent value="summary" className="mt-4 space-y-4 text-sm">
                  {rec.summary && <p className="leading-relaxed">{rec.summary}</p>}
                  {rec.participants.length > 0 && <Section title="Participantes">{rec.participants.join(", ")}</Section>}
                  {rec.topics.length > 0 && <Section title="Temas"><List items={rec.topics} /></Section>}
                  {rec.decisions.length > 0 && (
                    <Section title="Decisões">
                      <ul className="space-y-1">
                        {rec.decisions.map((d, i) => (
                          <li key={i} className="flex gap-2"><span>{d.checked ? "✅" : "⏳"}</span>{d.text}</li>
                        ))}
                      </ul>
                    </Section>
                  )}
                  {rec.risks.length > 0 && <Section title="Riscos"><List items={rec.risks} /></Section>}
                  {rec.next_steps.length > 0 && <Section title="Próximos passos"><List items={rec.next_steps} /></Section>}
                  {rec.ai_model && <p className="text-[11px] text-muted-foreground">Analisado por {rec.ai_provider} · {rec.ai_model}</p>}
                </TabsContent>

                <TabsContent value="transcript" className="mt-4 space-y-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => copy("t", rec.transcript || "")}>
                      {copied === "t" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copiar
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => saveText(`${rec.title}.txt`, rec.transcript || "")}>
                      <Download className="h-3.5 w-3.5" /> .txt
                    </Button>
                  </div>
                  <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border bg-card p-4 font-sans text-[13px] leading-relaxed">{rec.transcript}</pre>
                </TabsContent>

                <TabsContent value="report" className="mt-4 space-y-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => copy("r", rec.analysis_md || "")}>
                      {copied === "r" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copiar
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => saveText(`[ANÁLISE] ${rec.title}.md`, rec.analysis_md || "", "text/markdown")}>
                      <Download className="h-3.5 w-3.5" /> .md
                    </Button>
                  </div>
                  <div className="max-h-[50vh] overflow-y-auto rounded-lg border bg-card p-4 text-[13px] leading-relaxed [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:text-sm [&_h2]:font-bold [&_li]:ml-4 [&_li]:list-disc [&_table]:my-2 [&_table]:w-full [&_td]:border [&_td]:p-1.5 [&_th]:border [&_th]:p-1.5 [&_th]:text-left">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{rec.analysis_md || ""}</ReactMarkdown>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</h4>
      <div>{children}</div>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span>{t}</li>
      ))}
    </ul>
  );
}
