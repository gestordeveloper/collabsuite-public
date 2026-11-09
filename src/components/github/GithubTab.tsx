import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Code2, ExternalLink, GitBranch, GitCommit, GitPullRequest, Github, FileText, Link2Off, Lock, CircleDot, Play, Plus, Search, Star, GitFork, Unplug } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";
import * as gh from "@/src/services/github.service";
import { GithubConfigCard } from "./GithubConfigCard";
import { CodePanel } from "./CodePanel";
import { CommitsPanel } from "./CommitsPanel";
import { BranchesPanel } from "./BranchesPanel";
import { PullsPanel } from "./PullsPanel";
import { IssuesPanel } from "./IssuesPanel";
import { ActionsPanel } from "./ActionsPanel";
import { ReportPanel } from "./ReportPanel";
import { ErrorBox, GITHUB_AUTH_EVENT, Loading, timeAgo } from "./common";

type SubTab = "code" | "commits" | "branches" | "pulls" | "issues" | "actions" | "report";

const SUBTABS: { key: SubTab; label: string; icon: React.ReactNode }[] = [
  { key: "code", label: "Código", icon: <Code2 className="h-4 w-4" /> },
  { key: "commits", label: "Commits", icon: <GitCommit className="h-4 w-4" /> },
  { key: "branches", label: "Branches", icon: <GitBranch className="h-4 w-4" /> },
  { key: "pulls", label: "Pull requests", icon: <GitPullRequest className="h-4 w-4" /> },
  { key: "issues", label: "Issues", icon: <CircleDot className="h-4 w-4" /> },
  { key: "actions", label: "Actions", icon: <Play className="h-4 w-4" /> },
  { key: "report", label: "Relatório", icon: <FileText className="h-4 w-4" /> },
];

const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Você cancelou a autorização no GitHub.",
  invalid_state: "A tentativa de conexão expirou. Tente conectar de novo.",
  token_exchange: "O GitHub não aceitou a autorização. Confira o Client ID/secret e a callback URL do app.",
  in_use: "Essa conta do GitHub já está conectada a outra pessoa da plataforma.",
  no_code: "O GitHub não devolveu o código de autorização.",
  server_error: "Não foi possível concluir a conexão. Tente novamente.",
};

export function slugify(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

export function GithubTab({ projectId, projectName }: { projectId: number; projectName: string }) {
  const [status, setStatus] = useState<gh.GithubStatus | null>(null);
  const [link, setLink] = useState<gh.RepoLinkState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sub, setSub] = useState<SubTab>("code");
  const [branch, setBranch] = useState<string>("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([gh.getStatus(), gh.getLink(projectId)]);
      setStatus(s);
      setLink(l);
      if (l.linked) setBranch((b) => b || l.default_branch);
      setError(null);
    } catch (err) {
      setError(gh.errMsg(err));
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // Retorno do OAuth: ?gh_success=1 | ?gh_error=…
  useEffect(() => {
    const ok = searchParams.get("gh_success");
    const bad = searchParams.get("gh_error");
    if (!ok && !bad) return;
    setNotice(ok ? { kind: "ok", text: "Conta do GitHub conectada." } : { kind: "err", text: OAUTH_ERRORS[bad!] ?? "Não foi possível conectar o GitHub." });
    const next = new URLSearchParams(searchParams);
    next.delete("gh_success");
    next.delete("gh_error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Um painel recebeu 424 (GitHub recusou o token): atualiza o estado da conexão para mostrar o aviso com "Reconectar".
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(GITHUB_AUTH_EVENT, refresh);
    return () => window.removeEventListener(GITHUB_AUTH_EVENT, refresh);
  }, [load]);

  // O aviso some sozinho (erros ficam mais tempo, para dar tempo de ler).
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.kind === "ok" ? 6000 : 12000);
    return () => clearTimeout(t);
  }, [notice]);

  async function connect() {
    try {
      window.location.href = await gh.connectUrl(`/projects/${projectId}?tab=github`);
    } catch (err) {
      setNotice({ kind: "err", text: gh.errMsg(err) });
    }
  }

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!status || !link) return <Loading />;

  const banner = notice && (
    <div className={cn("rounded-lg border px-3 py-2 text-sm", notice.kind === "ok" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")} role="status">
      {notice.text}
    </div>
  );

  // 1) O app do GitHub ainda não foi configurado
  if (!status.configured) {
    return (
      <div className="space-y-4">
        {banner}
        <div className="rounded-xl border bg-card p-6 text-center">
          <Github className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h3 className="font-display text-lg font-semibold">Integração com o GitHub</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {status.can_configure ? "Configure o app do GitHub uma vez; depois cada pessoa conecta a própria conta com um clique." : "Peça a um administrador para configurar o app do GitHub da plataforma."}
          </p>
        </div>
        {status.can_configure && <GithubConfigCard onChanged={load} />}
      </div>
    );
  }

  // 2) Pessoa ainda não conectou a conta (e o projeto sem repositório não tem o que mostrar)
  if (!status.connected && !link.linked) {
    return (
      <div className="space-y-4">
        {banner}
        <div className="rounded-xl border bg-card p-8 text-center">
          <Github className="mx-auto mb-3 h-8 w-8" />
          <h3 className="font-display text-lg font-semibold">Conecte sua conta do GitHub</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Para criar ou vincular um repositório a este projeto, autorize a CollabSuite no GitHub.</p>
          <Button className="mt-4" onClick={connect}><Github className="h-4 w-4" /> Conectar GitHub</Button>
        </div>
        {status.can_configure && <GithubConfigCard onChanged={load} />}
      </div>
    );
  }

  // 3) Conectado, mas o projeto não tem repositório
  if (!link.linked) {
    return (
      <div className="space-y-4">
        {banner}
        <SetupRepo projectId={projectId} projectName={projectName} login={status.login} onDone={load} />
      </div>
    );
  }

  // 4) Repositório vinculado
  const activeBranch = branch || link.default_branch;
  return (
    <div className="space-y-4">
      {banner}
      {status.token_error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <span>{status.token_error} Reconecte para continuar editando.</span>
          <Button size="sm" variant="outline" onClick={connect}>Reconectar</Button>
        </div>
      )}
      {!status.connected && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">Você está só visualizando. Conecte sua conta do GitHub para editar, abrir PRs e rodar workflows.</span>
          <Button size="sm" onClick={connect}><Github className="h-4 w-4" /> Conectar</Button>
        </div>
      )}

      <RepoHeader link={link} status={status} onReport={() => setSub("report")} onUnlink={async () => { await gh.unlinkRepo(projectId); await load(); }} onDisconnect={async () => { await gh.disconnect(); await load(); }} />

      <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={sub === t.key}
            onClick={() => setSub(t.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              sub === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span className={sub === t.key ? "text-primary" : "text-subtle"}>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {sub === "code" && <CodePanel projectId={projectId} link={link} branch={activeBranch} onBranch={setBranch} />}
      {sub === "commits" && <CommitsPanel projectId={projectId} link={link} branch={activeBranch} onBranch={setBranch} />}
      {sub === "branches" && <BranchesPanel projectId={projectId} link={link} onOpen={(b) => { setBranch(b); setSub("code"); }} />}
      {sub === "pulls" && <PullsPanel projectId={projectId} link={link} branch={activeBranch} />}
      {sub === "issues" && <IssuesPanel projectId={projectId} link={link} />}
      {sub === "actions" && <ActionsPanel projectId={projectId} link={link} />}
      {sub === "report" && <ReportPanel projectId={projectId} projectName={projectName} link={link} />}
    </div>
  );
}

function RepoHeader({ link, status, onReport, onUnlink, onDisconnect }: { link: gh.RepoLink; status: gh.GithubStatus; onReport: () => void; onUnlink: () => Promise<void>; onDisconnect: () => Promise<void> }) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border bg-card p-4">
      <Github className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a href={link.html_url} target="_blank" rel="noopener noreferrer" className="font-display text-base font-semibold hover:underline">
            {link.full_name}
          </a>
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            {link.is_private ? <><Lock className="h-3 w-3" /> Privado</> : "Público"}
          </span>
          <ExternalLink className="h-3.5 w-3.5 text-subtle" />
        </div>
        {link.info?.description && <p className="mt-1 text-sm text-muted-foreground">{link.info.description}</p>}
        {link.info && (
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
            <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" /> {link.info.stars}</span>
            <span className="inline-flex items-center gap-1"><GitFork className="h-3 w-3" /> {link.info.forks}</span>
            {link.info.language && <span>{link.info.language}</span>}
            {link.info.pushed_at && <span>último push {timeAgo(link.info.pushed_at)}</span>}
          </p>
        )}
        {link.info_error && <p className="mt-1.5 text-xs text-warning">{link.info_error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {status.connected && <span className="mr-1 hidden text-xs text-subtle sm:inline">como @{status.login}</span>}
        <Button size="sm" variant="outline" title="Gerar relatório de atualizações em PDF" onClick={onReport}>
          <FileText className="h-4 w-4" /> <span className="hidden sm:inline">Gerar relatório</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Desvincular do projeto (o repositório continua no GitHub)"
          onClick={() => confirm(`Desvincular ${link.full_name} deste projeto? O repositório continua existindo no GitHub.`) && onUnlink()}
        >
          <Link2Off className="h-4 w-4" /> <span className="hidden sm:inline">Desvincular</span>
        </Button>
        {status.connected && (
          <Button size="sm" variant="ghost" title="Desconectar minha conta do GitHub" onClick={() => confirm("Desconectar sua conta do GitHub da CollabSuite?") && onDisconnect()}>
            <Unplug className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── projeto sem repositório: criar ou vincular ─────────────────────────────────

function SetupRepo({ projectId, projectName, login, onDone }: { projectId: number; projectName: string; login: string | null; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<"create" | "link">("create");
  const [name, setName] = useState(slugify(projectName));
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [org, setOrg] = useState("");
  const [orgs, setOrgs] = useState<{ login: string }[]>([]);
  const [repos, setRepos] = useState<gh.RepoOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { gh.listOrgs().then(setOrgs).catch(() => {}); }, []);
  useEffect(() => {
    if (mode === "link" && repos === null) gh.listRepos().then((r) => setRepos(r.repos)).catch((e) => { setError(gh.errMsg(e)); setRepos([]); });
  }, [mode, repos]);

  const filtered = useMemo(() => (repos ?? []).filter((r) => r.full_name.toLowerCase().includes(query.trim().toLowerCase())), [repos, query]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDone();
    } catch (err) {
      setError(gh.errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Github className="h-5 w-5" />
        <h3 className="font-display text-base font-semibold">Repositório do projeto</h3>
        {login && <span className="text-xs text-subtle">conectado como @{login}</span>}
      </div>
      <div className="mb-4 inline-flex gap-1 rounded-[9px] border bg-surface p-[3px]">
        {([["create", "Criar novo"], ["link", "Vincular existente"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMode(k)} className={cn("rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors", mode === k ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {mode === "create" ? (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => gh.createRepo(projectId, { name: name.trim(), description: description.trim() || undefined, private: isPrivate, org: org || undefined })); }} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="repo-owner">Dono</Label>
              <select id="repo-owner" value={org} onChange={(e) => setOrg(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none">
                <option value="">{login ? `@${login} (minha conta)` : "Minha conta"}</option>
                {orgs.map((o) => <option key={o.login} value={o.login}>{o.login}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repo-name">Nome do repositório</Label>
              <Input id="repo-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="meu-projeto" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repo-desc">Descrição (opcional)</Label>
            <Input id="repo-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={350} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> Repositório privado
          </label>
          <p className="text-xs text-subtle">O repositório nasce com um README e a branch principal, pronto para navegar aqui.</p>
          {error && <ErrorBox message={error} />}
          <Button type="submit" disabled={busy || !name.trim()}><Plus className="h-4 w-4" /> {busy ? "Criando…" : "Criar repositório"}</Button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar repositório…" className="pl-8" aria-label="Buscar repositório" />
          </div>
          {repos === null ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum repositório encontrado.</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {filtered.map((r) => (
                <li key={r.full_name}>
                  <button type="button" disabled={busy} onClick={() => void run(() => gh.linkRepo(projectId, r.full_name))} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/40 disabled:opacity-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.full_name}</span>
                      {r.description && <span className="block truncate text-xs text-muted-foreground">{r.description}</span>}
                    </span>
                    {r.private && <Lock className="h-3.5 w-3.5 shrink-0 text-subtle" aria-label="Privado" />}
                    <span className="shrink-0 text-[11px] text-subtle">{timeAgo(r.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <ErrorBox message={error} />}
        </div>
      )}
    </div>
  );
}
