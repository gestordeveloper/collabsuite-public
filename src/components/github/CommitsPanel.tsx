import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import * as gh from "@/src/services/github.service";
import { BranchSelect } from "./BranchSelect";
import { Avatar, DiffView, Empty, ErrorBox, Loading, timeAgo, useLoad } from "./common";

export function CommitsPanel({ projectId, branch, onBranch }: { projectId: number; link: gh.RepoLink; branch: string; onBranch: (b: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [all, setAll] = useState<gh.Commit[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const { data, loading, error, reload } = useLoad(() => gh.listCommits(projectId, { sha: branch, page }), [projectId, branch, page]);

  // Recomeça a lista ao trocar de branch.
  useEffect(() => { setPage(1); setAll([]); setSelected(null); }, [branch]);
  useEffect(() => {
    if (!data) return;
    setHasNext(data.has_next);
    setAll((prev) => (page === 1 ? data.commits : [...prev, ...data.commits.filter((c) => !prev.some((p) => p.sha === c.sha))]));
  }, [data, page]);

  if (selected) return <CommitDetail projectId={projectId} sha={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="space-y-3">
      <BranchSelect projectId={projectId} value={branch} onChange={onBranch} />
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading && all.length === 0 ? (
        <Loading />
      ) : all.length === 0 ? (
        <Empty>Nenhum commit nesta branch.</Empty>
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {all.map((c) => (
              <li key={c.sha}>
                <button type="button" onClick={() => setSelected(c.sha)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40">
                  <Avatar person={c.author} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.message}</span>
                    <span className="block text-xs text-muted-foreground">{c.author.login ?? c.author.name} · {timeAgo(c.date)}</span>
                  </span>
                  <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{c.short}</code>
                </button>
              </li>
            ))}
          </ul>
          {hasNext && <div className="flex justify-center"><Button variant="outline" size="sm" disabled={loading} onClick={() => setPage((p) => p + 1)}>{loading ? "Carregando…" : "Carregar mais"}</Button></div>}
        </>
      )}
    </div>
  );
}

function CommitDetail({ projectId, sha, onBack }: { projectId: number; sha: string; onBack: () => void }) {
  const { data, loading, error, reload } = useLoad(() => gh.getCommit(projectId, sha), [projectId, sha]);
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar aos commits</Button>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading || !data ? <Loading /> : (
        <>
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-display text-base font-semibold">{data.message}</h3>
            {data.full_message.includes("\n") && <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-muted-foreground">{data.full_message.split("\n").slice(1).join("\n").trim()}</pre>}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Avatar person={data.author} size={18} /> {data.author.login ?? data.author.name}</span>
              <span>{timeAgo(data.date)}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{data.short}</code>
              <a href={data.html_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3 w-3" /> GitHub</a>
            </div>
          </div>
          <DiffView files={data.files} />
        </>
      )}
    </div>
  );
}
