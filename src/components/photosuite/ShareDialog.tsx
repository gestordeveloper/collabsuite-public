import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, Loader2, Paperclip, Users } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { uploadBlob } from "@/src/lib/photosuite/engine";
import { downloadBlob, exportImage, type ExportFormat } from "@/src/lib/photosuite/session";
import * as attachmentService from "@/src/services/attachment.service";
import * as photosuiteService from "@/src/services/photosuite.service";
import * as projectService from "@/src/services/project.service";
import * as taskService from "@/src/services/task.service";
import { usePhotosuite } from "@/src/store/photosuite.store";
import type { Project, Task } from "@/src/types";
import { cn } from "@/src/lib/utils";

type Tab = "team" | "link" | "task";

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "team", label: "Equipe", icon: Users },
  { id: "link", label: "Link público", icon: Link2 },
  { id: "task", label: "Anexar a tarefa", icon: Paperclip },
];

const sel = "h-9 w-full rounded-md border border-input bg-secondary px-2 text-sm outline-none focus:ring-1 focus:ring-primary";

/** Compartilhar: com a equipe do projeto, por link público (só leitura) ou anexando a imagem a uma tarefa. */
export function ShareDialog({ open, onOpenChange, onBeforeShare }: { open: boolean; onOpenChange: (o: boolean) => void; onBeforeShare: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>("team");
  const docId = usePhotosuite((s) => s.docId);
  const name = usePhotosuite((s) => s.name);
  const meta = usePhotosuite((s) => s.docMeta);
  const setMeta = usePhotosuite((s) => s.setDocMeta);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Compartilhar “{name}”</DialogTitle>
          <DialogDescription>Escolha quem pode ver e editar, publique um link ou envie a imagem para uma tarefa.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
        {docId != null && tab === "team" && <TeamTab docId={docId} meta={meta} setMeta={setMeta} onBeforeShare={onBeforeShare} />}
        {docId != null && tab === "link" && <LinkTab docId={docId} meta={meta} setMeta={setMeta} />}
        {docId != null && tab === "task" && <TaskTab name={name} />}
      </DialogContent>
    </Dialog>
  );
}

function TeamTab({ docId, meta, setMeta, onBeforeShare }: { docId: number; meta: ReturnType<typeof usePhotosuite.getState>["docMeta"]; setMeta: (p: Partial<typeof meta>) => void; onBeforeShare: () => Promise<void> }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectService.fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function apply(patch: { project_id?: number | null; visibility?: "private" | "project" }) {
    setBusy(true);
    setError(null);
    try {
      await onBeforeShare(); // salva antes: os colegas abrem a versão mais recente
      const updated = await photosuiteService.updateDocument(docId, patch);
      setMeta({ projectId: updated.project_id ?? null, visibility: (updated.visibility as "private" | "project") ?? "private" });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível atualizar.");
    } finally {
      setBusy(false);
    }
  }

  if (!meta.isOwner) {
    return <p className="text-sm text-muted-foreground">Este documento foi compartilhado com você pela equipe do projeto. Só o dono altera quem tem acesso.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Projeto</label>
        <select
          className={sel}
          value={meta.projectId ?? ""}
          disabled={busy}
          onChange={(e) => apply({ project_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Sem projeto</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Quem pode abrir e editar</label>
        {(
          [
            ["private", "Só eu", "Ninguém mais vê este documento."],
            ["project", "Membros do projeto", "Todos os membros do projeto escolhido abrem e editam; só você exclui e muda o acesso."],
          ] as const
        ).map(([value, title, desc]) => (
          <button
            key={value}
            disabled={busy || (value === "project" && !meta.projectId)}
            onClick={() => apply({ visibility: value })}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50",
              meta.visibility === value ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50",
            )}
          >
            <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", meta.visibility === value ? "border-primary bg-primary" : "border-input")}>
              {meta.visibility === value && <Check className="h-3 w-3 text-primary-foreground" />}
            </span>
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-muted-foreground">{desc}</span>
            </span>
          </button>
        ))}
        {!meta.projectId && <p className="text-xs text-muted-foreground">Escolha um projeto para compartilhar com os membros.</p>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function LinkTab({ docId, meta, setMeta }: { docId: number; meta: ReturnType<typeof usePhotosuite.getState>["docMeta"]; setMeta: (p: Partial<typeof meta>) => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = meta.shareToken ? `${window.location.origin}/public/photosuite/${meta.shareToken}` : null;

  /** Exporta a imagem final, envia ao storage e (re)publica o link. */
  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportImage("png");
      const imageUrl = await uploadBlob(blob, "photosuite-publico.png");
      const r = await photosuiteService.shareDocument(docId, true, imageUrl);
      setMeta({ shareToken: r.share_token });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível publicar o link.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await photosuiteService.shareDocument(docId, false);
      setMeta({ shareToken: null });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível desativar o link.");
    } finally {
      setBusy(false);
    }
  }

  if (!meta.isOwner) return <p className="text-sm text-muted-foreground">Só o dono do documento publica o link público.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Qualquer pessoa com o link vê a imagem final do documento (somente leitura, sem login). O link mostra a versão no momento da publicação.</p>
      {url ? (
        <>
          <div className="flex gap-2">
            <Input readOnly value={url} className="h-9 text-xs" onFocus={(e) => e.target.select()} />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={async () => {
                await navigator.clipboard?.writeText(url).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={publish} disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Atualizar imagem do link
            </Button>
            <Button size="sm" variant="ghost" onClick={disable} disabled={busy} className="text-destructive hover:text-destructive">Desativar link</Button>
          </div>
        </>
      ) : (
        <Button size="sm" onClick={publish} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Publicar link público
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function TaskTab({ name }: { name: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ taskId: number; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    taskService
      .fetchTasks({ limit: 300 })
      .then((r) => setTasks(r.data))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks).slice(0, 50);
  }, [tasks, query]);

  async function attach() {
    if (taskId == null) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const blob = await exportImage(format);
      const ext = format === "jpeg" ? "jpg" : format;
      const base = (name || "photosuite").replace(/[\\/:*?"<>|]+/g, "-");
      const file = new File([blob], `${base}.${ext}`, { type: blob.type || `image/${format}` });
      const up = await attachmentService.uploadFile(file);
      await attachmentService.createAttachment(taskId, { file_name: file.name, file_url: up.url, file_size: up.size, file_type: up.type });
      setDone({ taskId, title: tasks.find((t) => t.id === taskId)?.title ?? "" });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível anexar à tarefa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Envia a imagem final do documento como anexo da tarefa escolhida.</p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar tarefa…" className="h-9" />
      <div className="max-h-48 overflow-y-auto rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando tarefas…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">Nenhuma tarefa encontrada.</div>
        ) : (
          filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => setTaskId(t.id)}
              className={cn("flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left text-sm last:border-0", taskId === t.id ? "bg-primary/15" : "hover:bg-accent/50")}
            >
              <span className="truncate">{t.title}</span>
              {taskId === t.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </button>
          ))
        )}
      </div>
      <div className="flex items-center gap-2">
        <select className={cn(sel, "w-32")} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
        </select>
        <Button size="sm" onClick={attach} disabled={busy || taskId == null} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Anexar à tarefa
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => downloadBlob(await exportImage(format), `${(name || "photosuite").replace(/[\\/:*?"<>|]+/g, "-")}.${format === "jpeg" ? "jpg" : format}`)}
        >
          Só baixar
        </Button>
      </div>
      {done && (
        <p role="status" className="text-xs text-emerald-500">
          Anexado a “{done.title}”. <a className="underline" href={`/task/${done.taskId}`}>Abrir tarefa</a>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
