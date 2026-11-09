import { useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import * as gh from "@/src/services/github.service";
import { Empty, ErrorBox, IssueState, LabelChip, Loading, Segmented, timeAgo, useLoad } from "./common";
import { Body, CommentBox, Entry } from "./Discussion";

type Filter = "open" | "closed" | "all";
const FILTERS: { value: Filter; label: string }[] = [{ value: "open", label: "Abertas" }, { value: "closed", label: "Fechadas" }, { value: "all", label: "Todas" }];

export function IssuesPanel({ projectId, link }: { projectId: number; link: gh.RepoLink }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useLoad(() => gh.listIssues(projectId, filter), [projectId, filter]);

  if (selected !== null) return <IssueDetail projectId={projectId} number={selected} link={link} onBack={() => { setSelected(null); void reload(); }} />;
  if (creating) return <CreateIssue projectId={projectId} onCancel={() => setCreating(false)} onCreated={(n) => { setCreating(false); setSelected(n); }} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Filter> value={filter} options={FILTERS} onChange={setFilter} />
        {link.can_write && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova issue</Button>}
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading /> : !data || data.issues.length === 0 ? (
        <Empty>Nenhuma issue {filter === "open" ? "aberta" : filter === "closed" ? "fechada" : ""}.</Empty>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {data.issues.map((i) => (
            <li key={i.number}>
              <button type="button" onClick={() => setSelected(i.number)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent/40">
                <IssueState state={i.state} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{i.title}</span>
                    {i.labels.map((l) => <LabelChip key={l.name} {...l} />)}
                  </span>
                  <span className="block text-xs text-muted-foreground">#{i.number} · {i.user?.login ?? "alguém"} · {timeAgo(i.updated_at)}</span>
                </span>
                {i.comments > 0 && <span className="shrink-0 text-xs text-subtle">{i.comments} 💬</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateIssue({ projectId, onCancel, onCreated }: { projectId: number; onCancel: () => void; onCreated: (n: number) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated((await gh.createIssue(projectId, { title: title.trim(), body: body.trim() || undefined })).number);
    } catch (err) {
      setError(gh.errMsg(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-4">
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
      <h3 className="font-display text-base font-semibold">Nova issue</h3>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" aria-label="Título" required maxLength={250} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Descreva o problema ou a ideia…" aria-label="Descrição" className="w-full resize-y rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button type="submit" disabled={busy || !title.trim()}>{busy ? "Criando…" : "Criar issue"}</Button>
      </div>
    </form>
  );
}

function IssueDetail({ projectId, number, link, onBack }: { projectId: number; number: number; link: gh.RepoLink; onBack: () => void }) {
  const { data, loading, error, reload } = useLoad(() => gh.getIssue(projectId, number), [projectId, number]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggle() {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      await gh.updateIssue(projectId, number, { state: data.state === "open" ? "closed" : "open" });
      await reload();
    } catch (err) {
      setActionError(gh.errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="space-y-3"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar</Button><ErrorBox message={error} onRetry={reload} /></div>;
  if (loading || !data) return <Loading />;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar às issues</Button>
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start gap-2">
          <h3 className="min-w-0 flex-1 font-display text-lg font-semibold">{data.title} <span className="font-normal text-muted-foreground">#{data.number}</span></h3>
          <IssueState state={data.state} />
          <a href={data.html_url} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-muted-foreground hover:bg-accent" aria-label="Abrir no GitHub"><ExternalLink className="h-4 w-4" /></a>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">{data.labels.map((l) => <LabelChip key={l.name} {...l} />)}</div>
      </div>
      <Entry user={data.user} date={data.created_at}><Body text={data.body} /></Entry>
      {data.comment_list.map((c) => <Entry key={c.id} user={c.user} date={c.created_at}><Body text={c.body} /></Entry>)}
      {actionError && <ErrorBox message={actionError} />}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <CommentBox canWrite={link.can_write} onSend={async (b) => { await gh.addComment(projectId, number, b); await reload(); }} />
        {link.can_write && (
          <div className="border-t pt-3">
            <Button size="sm" variant="outline" disabled={busy} onClick={toggle}>
              {data.state === "open" ? <><CheckCircle2 className="h-4 w-4" /> Fechar issue</> : <><RotateCcw className="h-4 w-4" /> Reabrir issue</>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
