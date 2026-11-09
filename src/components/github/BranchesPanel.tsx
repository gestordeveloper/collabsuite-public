import { useState } from "react";
import { GitBranch, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import * as gh from "@/src/services/github.service";
import { ErrorBox, Loading, useLoad } from "./common";

export function BranchesPanel({ projectId, link, onOpen }: { projectId: number; link: gh.RepoLink; onOpen: (branch: string) => void }) {
  const { data, loading, error, reload } = useLoad(() => gh.listBranches(projectId), [projectId]);
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("create");
    setActionError(null);
    try {
      const created = await gh.createBranch(projectId, { name: name.trim(), from: from || data?.default_branch });
      setName("");
      await reload();
      onOpen(created.name);
    } catch (err) {
      setActionError(gh.errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(b: string) {
    if (!confirm(`Excluir a branch "${b}"? Os commits só existentes nela serão perdidos se não houver PR mesclado.`)) return;
    setBusy(b);
    setActionError(null);
    try {
      await gh.deleteBranch(projectId, b);
      await reload();
    } catch (err) {
      setActionError(gh.errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  return (
    <div className="space-y-4">
      {link.can_write ? (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
          <div className="min-w-[200px] flex-1 space-y-1">
            <label htmlFor="branch-name" className="text-xs text-muted-foreground">Nova branch</label>
            <Input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/minha-ideia" className="font-mono" />
          </div>
          <div className="space-y-1">
            <label htmlFor="branch-from" className="text-xs text-muted-foreground">A partir de</label>
            <select id="branch-from" value={from || data.default_branch} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none">
              {data.branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={busy === "create" || !name.trim()}><Plus className="h-4 w-4" /> Criar branch</Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Conecte sua conta do GitHub para criar e excluir branches.</p>
      )}
      {actionError && <ErrorBox message={actionError} />}

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {data.branches.map((b) => (
          <li key={b.name} className="flex items-center gap-3 px-3 py-2.5">
            <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
            <button type="button" onClick={() => onOpen(b.name)} className="min-w-0 flex-1 truncate text-left font-mono text-[13px] hover:underline">{b.name}</button>
            {b.name === data.default_branch && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">padrão</span>}
            {b.protected && <Lock className="h-3.5 w-3.5 text-subtle" aria-label="Protegida" />}
            <code className="hidden rounded bg-muted px-1.5 py-0.5 font-mono text-xs sm:inline">{b.sha.slice(0, 7)}</code>
            {link.can_write && b.name !== data.default_branch && !b.protected && (
              <button type="button" disabled={busy === b.name} onClick={() => remove(b.name)} aria-label={`Excluir ${b.name}`} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
