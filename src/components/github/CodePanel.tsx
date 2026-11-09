import { useEffect, useMemo, useState } from "react";
import { ChevronRight, File as FileIcon, FilePlus2, Folder, Pencil, Save, Trash2, ExternalLink, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import * as gh from "@/src/services/github.service";
import { BranchSelect } from "./BranchSelect";
import { ErrorBox, Loading, useLoad } from "./common";

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Navegar pela árvore, ler arquivos e — com a conta conectada — editar, criar e excluir com commit. */
export function CodePanel({ projectId, link, branch, onBranch }: { projectId: number; link: gh.RepoLink; branch: string; onBranch: (b: string) => void }) {
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"view" | "edit" | "new" | "delete">("view");
  const [notice, setNotice] = useState<string | null>(null);
  const { data, loading, error, reload } = useLoad(() => gh.getContents(projectId, path, branch), [projectId, path, branch]);

  // Trocar de branch/arquivo sai do modo de edição.
  useEffect(() => { setMode("view"); }, [path, branch]);

  const crumbs = useMemo(() => path.split("/").filter(Boolean), [path]);
  const dirOf = (p: string) => p.split("/").slice(0, -1).join("/");
  const currentDir = data?.type === "file" ? dirOf(data.path) : path;

  async function committed(message: string, then: () => void) {
    setNotice(message);
    then();
    await reload();
    setTimeout(() => setNotice(null), 6000);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <BranchSelect projectId={projectId} value={branch} onChange={onBranch} />
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[13px]" aria-label="Caminho">
          <button type="button" onClick={() => setPath("")} className="rounded px-1 font-medium hover:bg-accent">{link.repo}</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <ChevronRight className="h-3.5 w-3.5 text-subtle" />
              <button type="button" onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))} className="rounded px-1 hover:bg-accent">{c}</button>
            </span>
          ))}
        </nav>
        {link.can_write && mode === "view" && data?.type !== "other" && (
          <Button size="sm" variant="outline" onClick={() => setMode("new")}><FilePlus2 className="h-4 w-4" /> Novo arquivo</Button>
        )}
      </div>

      {notice && <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success" role="status">{notice}</div>}

      {mode === "new" ? (
        <NewFile projectId={projectId} branch={branch} defaultBranch={link.default_branch} dir={currentDir} onCancel={() => setMode("view")} onDone={(c, p) => committed(`Arquivo criado — commit ${c.short}.`, () => { setPath(p); setMode("view"); })} />
      ) : loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : data?.type === "dir" ? (
        <DirList entries={data.entries} onOpen={setPath} />
      ) : data?.type === "file" ? (
        mode === "edit" && data.content !== null ? (
          <EditFile projectId={projectId} file={data} branch={branch} defaultBranch={link.default_branch} onCancel={() => setMode("view")} onDone={(c) => committed(`Alterações salvas — commit ${c.short}.`, () => setMode("view"))} />
        ) : mode === "delete" ? (
          <DeleteFile projectId={projectId} file={data} branch={branch} onCancel={() => setMode("view")} onDone={(c) => committed(`Arquivo excluído — commit ${c.short}.`, () => setPath(dirOf(data.path)))} />
        ) : (
          <FileView file={data} canWrite={link.can_write} onEdit={() => setMode("edit")} onDelete={() => setMode("delete")} />
        )
      ) : (
        <p className="text-sm text-muted-foreground">Este item não pode ser exibido aqui (submódulo ou link simbólico).</p>
      )}
    </div>
  );
}

function DirList({ entries, onOpen }: { entries: gh.DirEntry[]; onOpen: (p: string) => void }) {
  if (entries.length === 0) return <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">Pasta vazia.</p>;
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {entries.map((e) => (
        <li key={e.path}>
          <button type="button" disabled={e.type === "other"} onClick={() => onOpen(e.path)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-accent/40 disabled:opacity-60">
            {e.type === "dir" ? <Folder className="h-4 w-4 shrink-0 text-info" /> : <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            {e.type === "file" && <span className="shrink-0 text-xs text-subtle">{fmtSize(e.size)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

type FileData = Extract<gh.Contents, { type: "file" }>;

function FileView({ file, canWrite, onEdit, onDelete }: { file: FileData; canWrite: boolean; onEdit: () => void; onDelete: () => void }) {
  const lines = file.content?.split("\n") ?? [];
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop(); // a quebra final não é uma linha a mais
  const isImage = !!file.base64 && /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(file.name);
  const mime = file.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : `image/${file.name.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}`;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{file.name}</span>
        <span className="text-xs text-subtle">{fmtSize(file.size)}{file.content !== null ? ` · ${lines.length} linhas` : ""}</span>
        <a href={file.html_url} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Abrir no GitHub" aria-label="Abrir no GitHub"><ExternalLink className="h-4 w-4" /></a>
        {canWrite && file.content !== null && <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Editar</Button>}
        {canWrite && <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Excluir arquivo"><Trash2 className="h-4 w-4 text-destructive" /></Button>}
      </div>
      {isImage ? (
        <div className="flex justify-center bg-muted/30 p-4"><img src={`data:${mime};base64,${file.base64}`} alt={file.name} className="max-h-[480px] max-w-full" /></div>
      ) : file.content !== null ? (
        <pre className="max-h-[560px] overflow-auto py-2 font-mono text-[12px] leading-[1.5]">
          {lines.map((l, i) => (
            <div key={i} className="flex">
              <span className="w-12 shrink-0 select-none pr-3 text-right text-subtle">{i + 1}</span>
              <span className="whitespace-pre pr-3">{l || " "}</span>
            </div>
          ))}
        </pre>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {file.too_large ? "Arquivo grande demais para exibir aqui." : "Arquivo binário — não há pré-visualização."}{" "}
          <a href={file.html_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Ver no GitHub</a>
        </p>
      )}
    </div>
  );
}

function CommitBar({ message, onMessage, branch, defaultBranch, busy, error, label, onCancel, disabled }: {
  message: string; onMessage: (v: string) => void; branch: string; defaultBranch: string; busy: boolean; error: string | null; label: string; onCancel: () => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-2 border-t bg-surface/50 p-3">
      <label className="block text-xs text-muted-foreground" htmlFor="commit-msg">Mensagem do commit</label>
      <Input id="commit-msg" value={message} onChange={(e) => onMessage(e.target.value)} maxLength={200} />
      <p className="text-xs text-subtle">
        O commit vai direto para <b className="font-mono">{branch}</b>.
        {branch === defaultBranch && " Para revisar antes, crie uma branch na aba Branches e abra um pull request."}
      </p>
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}><X className="h-4 w-4" /> Cancelar</Button>
        <Button type="submit" disabled={busy || disabled || !message.trim()}><Save className="h-4 w-4" /> {busy ? "Enviando…" : label}</Button>
      </div>
    </div>
  );
}

function EditFile({ projectId, file, branch, defaultBranch, onCancel, onDone }: { projectId: number; file: FileData; branch: string; defaultBranch: string; onCancel: () => void; onDone: (c: gh.Commit) => void }) {
  const [text, setText] = useState(file.content ?? "");
  const [message, setMessage] = useState(`Atualiza ${file.name}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await gh.putFile(projectId, { path: file.path, content: text, message: message.trim(), branch, sha: file.sha });
      onDone(r.commit);
    } catch (err) {
      setError(gh.errMsg(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-3 py-2 font-mono text-[13px]">{file.path}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Conteúdo do arquivo" className="block h-[420px] w-full resize-y bg-background p-3 font-mono text-[12px] leading-[1.5] outline-none" />
      <CommitBar message={message} onMessage={setMessage} branch={branch} defaultBranch={defaultBranch} busy={busy} error={error} label="Commitar" onCancel={onCancel} disabled={text === file.content} />
    </form>
  );
}

function NewFile({ projectId, branch, defaultBranch, dir, onCancel, onDone }: { projectId: number; branch: string; defaultBranch: string; dir: string; onCancel: () => void; onDone: (c: gh.Commit, path: string) => void }) {
  const [name, setName] = useState(dir ? `${dir}/` : "");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("Adiciona arquivo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const path = name.trim().replace(/^\/+/, "");
    if (!path || path.endsWith("/")) return setError("Informe o nome do arquivo (ex.: src/index.ts).");
    setBusy(true);
    setError(null);
    try {
      const r = await gh.putFile(projectId, { path, content: text, message: message.trim(), branch });
      onDone(r.commit, path);
    } catch (err) {
      setError(gh.errMsg(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={create} className="overflow-hidden rounded-xl border bg-card">
      <div className="space-y-1.5 border-b p-3">
        <label htmlFor="new-file-path" className="text-xs text-muted-foreground">Caminho do novo arquivo</label>
        <Input id="new-file-path" value={name} onChange={(e) => setName(e.target.value)} placeholder="pasta/arquivo.ts" autoFocus className="font-mono" />
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Conteúdo do arquivo" className="block h-[300px] w-full resize-y bg-background p-3 font-mono text-[12px] leading-[1.5] outline-none" />
      <CommitBar message={message} onMessage={setMessage} branch={branch} defaultBranch={defaultBranch} busy={busy} error={error} label="Criar arquivo" onCancel={onCancel} />
    </form>
  );
}

function DeleteFile({ projectId, file, branch, onCancel, onDone }: { projectId: number; file: FileData; branch: string; onCancel: () => void; onDone: (c: gh.Commit) => void }) {
  const [message, setMessage] = useState(`Remove ${file.name}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone((await gh.deleteFile(projectId, { path: file.path, message: message.trim(), branch, sha: file.sha })).commit);
    } catch (err) {
      setError(gh.errMsg(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={remove} className="overflow-hidden rounded-xl border border-destructive/30 bg-card">
      <p className="px-4 py-3 text-sm">Excluir <b className="font-mono">{file.path}</b> da branch <b className="font-mono">{branch}</b>? Isso cria um commit de remoção.</p>
      <CommitBar message={message} onMessage={setMessage} branch={branch} defaultBranch="" busy={busy} error={error} label="Excluir arquivo" onCancel={onCancel} />
    </form>
  );
}
