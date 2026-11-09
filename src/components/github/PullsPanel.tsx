import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink, GitMerge, MessageSquareWarning, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import * as gh from "@/src/services/github.service";
import { Avatar, DiffView, Empty, ErrorBox, LabelChip, Loading, PullState, Segmented, timeAgo, useLoad } from "./common";
import { Body, CommentBox, Entry } from "./Discussion";

type Filter = "open" | "closed" | "all";
const FILTERS: { value: Filter; label: string }[] = [{ value: "open", label: "Abertos" }, { value: "closed", label: "Fechados" }, { value: "all", label: "Todos" }];

export function PullsPanel({ projectId, link, branch }: { projectId: number; link: gh.RepoLink; branch: string }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useLoad(() => gh.listPulls(projectId, filter), [projectId, filter]);

  if (selected !== null) return <PullDetail projectId={projectId} number={selected} link={link} onBack={() => { setSelected(null); void reload(); }} />;
  if (creating) return <CreatePull projectId={projectId} link={link} activeBranch={branch} onCancel={() => setCreating(false)} onCreated={(n) => { setCreating(false); setSelected(n); }} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Filter> value={filter} options={FILTERS} onChange={setFilter} />
        {link.can_write && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo pull request</Button>}
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading /> : !data || data.pulls.length === 0 ? (
        <Empty>Nenhum pull request {filter === "open" ? "aberto" : filter === "closed" ? "fechado" : ""}.</Empty>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {data.pulls.map((p) => (
            <li key={p.number}>
              <button type="button" onClick={() => setSelected(p.number)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent/40">
                <PullState state={p.state} merged={p.merged} draft={p.draft} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.title}</span>
                    {p.labels.map((l) => <LabelChip key={l.name} {...l} />)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    #{p.number} · {p.user?.login ?? "alguém"} · {timeAgo(p.updated_at)} · <span className="font-mono">{p.head.ref}</span> → <span className="font-mono">{p.base.ref}</span>
                  </span>
                </span>
                {p.comments > 0 && <span className="shrink-0 text-xs text-subtle">{p.comments} 💬</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreatePull({ projectId, link, activeBranch, onCancel, onCreated }: { projectId: number; link: gh.RepoLink; activeBranch: string; onCancel: () => void; onCreated: (n: number) => void }) {
  const { data } = useLoad(() => gh.listBranches(projectId), [projectId]);
  const [head, setHead] = useState("");
  const [base, setBase] = useState(link.default_branch);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branches = data?.branches.map((b) => b.name) ?? [];
  // Origem padrão: a branch em que a pessoa estava trabalhando (se não for a de destino); senão, a primeira diferente.
  const headValue = head || (activeBranch !== base && branches.includes(activeBranch) ? activeBranch : branches.find((b) => b !== base) || "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated((await gh.createPull(projectId, { title: title.trim(), body: body.trim() || undefined, head: headValue, base, draft })).number);
    } catch (err) {
      setError(gh.errMsg(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-4">
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
      <h3 className="font-display text-base font-semibold">Novo pull request</h3>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <select aria-label="Branch de origem" value={headValue} onChange={(e) => setHead(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono outline-none">
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <select aria-label="Branch de destino" value={base} onChange={(e) => setBase(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono outline-none">
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" aria-label="Título" required maxLength={250} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Descreva as mudanças…" aria-label="Descrição" className="w-full resize-y rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
      <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Criar como rascunho</label>
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button type="submit" disabled={busy || !title.trim() || !headValue}>{busy ? "Criando…" : "Criar pull request"}</Button>
      </div>
    </form>
  );
}

function PullDetail({ projectId, number, link, onBack }: { projectId: number; number: number; link: gh.RepoLink; onBack: () => void }) {
  const { data, loading, error, reload } = useLoad(() => gh.getPull(projectId, number), [projectId, number]);
  const files = useLoad(() => gh.getPullFiles(projectId, number), [projectId, number]);
  const [tab, setTab] = useState<"talk" | "files">("talk");
  const [method, setMethod] = useState("merge");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewText, setReviewText] = useState("");

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(gh.errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="space-y-3"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar</Button><ErrorBox message={error} onRetry={reload} /></div>;
  if (loading || !data) return <Loading />;
  const open = data.state === "open";

  const reviewStyles: Record<string, string> = { APPROVED: "text-success", CHANGES_REQUESTED: "text-destructive", COMMENTED: "text-muted-foreground", DISMISSED: "text-muted-foreground" };
  const reviewLabels: Record<string, string> = { APPROVED: "aprovou", CHANGES_REQUESTED: "pediu alterações", COMMENTED: "comentou", DISMISSED: "revisão descartada" };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar aos pull requests</Button>

      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start gap-2">
          <h3 className="min-w-0 flex-1 font-display text-lg font-semibold">{data.title} <span className="font-normal text-muted-foreground">#{data.number}</span></h3>
          <PullState state={data.state} merged={data.merged} draft={data.draft} />
          <a href={data.html_url} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-muted-foreground hover:bg-accent" aria-label="Abrir no GitHub"><ExternalLink className="h-4 w-4" /></a>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Avatar person={data.user} size={16} /> {data.user?.login} quer mesclar <span className="font-mono">{data.head.ref}</span> em <span className="font-mono">{data.base.ref}</span>
          · {data.commits} commit(s) · {data.changed_files} arquivo(s) · <span className="text-success">+{data.additions}</span> <span className="text-destructive">−{data.deletions}</span>
        </p>
      </div>

      <div className="flex gap-1 border-b" role="tablist">
        {([["talk", `Conversa (${data.comment_list.length + data.reviews.length})`], ["files", `Arquivos alterados (${data.changed_files})`]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2 text-[13px] font-medium ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab === "files" ? (
        files.error ? <ErrorBox message={files.error} onRetry={files.reload} /> : files.loading || !files.data ? <Loading /> : <DiffView files={files.data} />
      ) : (
        <div className="space-y-3">
          <Entry user={data.user} date={data.created_at}><Body text={data.body} /></Entry>
          {data.reviews.map((r) => (
            <Entry key={`r${r.id}`} user={r.user} date={r.submitted_at} badge={<b className={reviewStyles[r.state]}>{reviewLabels[r.state] ?? r.state.toLowerCase()}</b>}>
              {r.body ? <Body text={r.body} /> : <p className="text-sm italic text-muted-foreground">Sem comentário.</p>}
            </Entry>
          ))}
          {data.comment_list.map((c) => <Entry key={c.id} user={c.user} date={c.created_at}><Body text={c.body} /></Entry>)}

          {actionError && <ErrorBox message={actionError} />}

          {link.can_write ? (
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <CommentBox canWrite onSend={async (b) => { await gh.addComment(projectId, number, b); await reload(); }} />
              {open && (
                <>
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">Revisão</p>
                    <Input value={reviewText} onChange={(e) => setReviewText(e.target.value)} placeholder="Comentário da revisão (obrigatório para pedir alterações)" aria-label="Comentário da revisão" />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("approve", async () => { await gh.reviewPull(projectId, number, { event: "APPROVE", body: reviewText.trim() || undefined }); setReviewText(""); })}><Check className="h-4 w-4 text-success" /> Aprovar</Button>
                      <Button size="sm" variant="outline" disabled={!!busy || !reviewText.trim()} onClick={() => act("changes", async () => { await gh.reviewPull(projectId, number, { event: "REQUEST_CHANGES", body: reviewText.trim() }); setReviewText(""); })}><MessageSquareWarning className="h-4 w-4 text-destructive" /> Pedir alterações</Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <select aria-label="Forma de mesclar" value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none">
                      <option value="merge">Merge commit</option>
                      <option value="squash">Squash e merge</option>
                      <option value="rebase">Rebase e merge</option>
                    </select>
                    <Button size="sm" disabled={!!busy || data.draft || data.mergeable === false} onClick={() => confirm(`Mesclar #${number} em ${data.base.ref}?`) && act("merge", () => gh.mergePull(projectId, number, method))}>
                      <GitMerge className="h-4 w-4" /> {busy === "merge" ? "Mesclando…" : "Mesclar"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("close", () => gh.updatePull(projectId, number, { state: "closed" }))}><X className="h-4 w-4" /> Fechar</Button>
                    {data.draft && <span className="text-xs text-muted-foreground">Rascunho: marque como pronto no GitHub para mesclar.</span>}
                    {data.mergeable === false && <span className="text-xs text-destructive">Há conflitos a resolver antes de mesclar.</span>}
                  </div>
                </>
              )}
              {!open && !data.merged && (
                <div className="border-t pt-3"><Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("reopen", () => gh.updatePull(projectId, number, { state: "open" }))}><RotateCcw className="h-4 w-4" /> Reabrir</Button></div>
              )}
              {data.merged && <p className="border-t pt-3 text-sm text-muted-foreground">Mesclado{data.merged_by ? ` por ${data.merged_by.login}` : ""}.</p>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Conecte sua conta do GitHub para comentar, revisar e mesclar.</p>
          )}
        </div>
      )}
    </div>
  );
}
