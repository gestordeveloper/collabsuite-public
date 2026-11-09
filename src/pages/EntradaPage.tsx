import { useState, useEffect, useMemo, useRef } from "react";
import { FolderPlus, NotebookPen, Plus, X } from "lucide-react";
import { useTaskStore } from "@/src/store/task.store";
import { useDashboard } from "@/src/context/dashboard.context";
import * as taskService from "@/src/services/task.service";
import * as folderService from "@/src/services/folder.service";
import { NoteEditorPane } from "@/src/components/notes/NoteEditorPane";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { formatShortDate } from "@/src/lib/task-view";
import type { Task, Folder as FolderType } from "@/src/types";
import { cn } from "@/src/lib/utils";

type FolderFilter = number | "all" | "none";

const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const getPreview = (html: string | null | undefined) => (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function formatListDate(value: string): string {
  const d = new Date(value);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `Hoje, ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return formatShortDate(d);
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const listener = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return isDesktop;
}

/** Anotações: lista à esquerda (cadernos = pastas) e editor com salvamento automático à direita. */
export function EntradaPage() {
  const { tasks, loadTasks, removeTask, updateTaskInState, isLoading } = useTaskStore();
  const { openNewTask, searchQuery } = useDashboard();
  const isDesktop = useIsDesktop();

  const [folders, setFolders] = useState<FolderType[]>([]);
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [folderLoading, setFolderLoading] = useState(false);

  const loadFolders = async () => {
    try {
      setFolders(await folderService.fetchFolders());
    } catch (e) {
      console.error("Failed to load folders:", e);
    }
  };

  useEffect(() => {
    loadTasks();
    loadFolders();
    localStorage.removeItem("active_entrada_folder_id");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anotações = itens fora de projetos (sem funil/etapa).
  const inboxTasks = useMemo(
    () => tasks.filter((t) => !t.deleted_at && (t.funnel_id == null || t.funnel_id === 0) && (t.stage_id == null || t.stage_id === 0)),
    [tasks]
  );

  const notes = useMemo(() => {
    const q = fold(searchQuery.trim());
    return inboxTasks
      .filter((t) => {
        if (folderFilter === "none" && t.folder_id != null) return false;
        if (typeof folderFilter === "number" && t.folder_id !== folderFilter) return false;
        if (!q) return true;
        return fold(t.title || "").includes(q) || fold(getPreview(t.description)).includes(q);
      })
      .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime());
  }, [inboxTasks, searchQuery, folderFilter]);

  // Uma nota nova (criada agora, pelo botão "+") abre direto no editor.
  const newestRef = useRef<number | null>(null);
  useEffect(() => {
    const newest = [...inboxTasks].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
    if (newest && newestRef.current !== null && newest.id !== newestRef.current && Date.now() - new Date(newest.created_at).getTime() < 20000) {
      setFolderFilter("all");
      setSelectedId(newest.id);
    }
    if (newest) newestRef.current = newest.id;
    else newestRef.current = 0;
  }, [inboxTasks]);

  // No desktop, sempre há uma nota aberta (a primeira da lista); no celular a lista vem primeiro.
  const activeId = selectedId !== null && notes.some((n) => n.id === selectedId) ? selectedId : isDesktop ? notes[0]?.id ?? null : null;
  const active: Task | null = notes.find((n) => n.id === activeId) ?? null;

  const counts = useMemo(() => {
    const byFolder = new Map<number, number>();
    inboxTasks.forEach((t) => t.folder_id != null && byFolder.set(t.folder_id, (byFolder.get(t.folder_id) ?? 0) + 1));
    return { all: inboxTasks.length, none: inboxTasks.filter((t) => t.folder_id == null).length, byFolder };
  }, [inboxTasks]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      setFolderLoading(true);
      await folderService.createFolder(newFolderName);
      setNewFolderName("");
      setIsFolderModalOpen(false);
      await loadFolders();
    } catch {
      alert("Erro ao criar pasta.");
    } finally {
      setFolderLoading(false);
    }
  };

  const handleDeleteFolder = async (folder: FolderType) => {
    if (!confirm(`Excluir a pasta "${folder.name}"? As notas associadas continuarão existindo.`)) return;
    try {
      await folderService.deleteFolder(folder.id);
      if (folderFilter === folder.id) setFolderFilter("all");
      loadFolders();
      loadTasks();
    } catch {
      alert("Erro ao excluir pasta.");
    }
  };

  const handleMoveToFolder = async (task: Task, folderId: number | null) => {
    try {
      updateTaskInState(await taskService.updateTask(task.id, { folder_id: folderId }));
    } catch {
      alert("Erro ao mover nota.");
    }
  };

  const handleDelete = async (task: Task) => {
    if (!confirm("Tem certeza que deseja excluir esta nota?")) return;
    try {
      await taskService.deleteTask(task.id);
      removeTask(task.id);
      setSelectedId(null);
    } catch {
      alert("Erro ao excluir nota.");
    }
  };

  const chip = (active: boolean) =>
    cn(
      "flex h-[26px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
      active ? "border-primary/40 bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
    );

  const showEditor = isDesktop || selectedId !== null;

  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[320px_minmax(0,1fr)]">
      {/* Lista */}
      <div className={cn("min-h-0 flex-col overflow-hidden border-r", showEditor && !isDesktop ? "hidden" : "flex")}>
        <div className="flex flex-col gap-3.5 px-[18px] pb-3 pt-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Anotações</h2>
            <button
              type="button"
              onClick={() => openNewTask()}
              title="Nova anotação"
              className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-primary text-white transition-colors hover:bg-[var(--primary-hover)]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setFolderFilter("all")} className={chip(folderFilter === "all")}>
              Todas <span className="font-mono text-[10px] text-subtle">{counts.all}</span>
            </button>
            <button type="button" onClick={() => setFolderFilter("none")} className={chip(folderFilter === "none")}>
              Sem pasta <span className="font-mono text-[10px] text-subtle">{counts.none}</span>
            </button>
            {folders.map((f) => (
              <span key={f.id} className={cn(chip(folderFilter === f.id), "group cursor-pointer pr-2")} onClick={() => setFolderFilter(f.id)}>
                {f.name} <span className="font-mono text-[10px] text-subtle">{counts.byFolder.get(f.id) ?? 0}</span>
                <button
                  type="button"
                  title="Excluir pasta"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFolder(f);
                  }}
                  className="hidden text-subtle hover:text-destructive group-hover:inline-flex"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button type="button" onClick={() => setIsFolderModalOpen(true)} className="flex h-[26px] items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-subtle transition-colors hover:text-foreground">
              <FolderPlus className="h-3 w-3" /> Pasta
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4">
          {isLoading && notes.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-muted-foreground">Carregando anotações...</p>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-14 text-center">
              <NotebookPen className="h-9 w-9 text-muted-foreground/40" />
              <span className="text-xs font-medium text-muted-foreground">
                {searchQuery ? "Nenhuma anotação encontrada." : "Esta pasta está vazia."}
              </span>
              <Button onClick={() => openNewTask()} variant="secondary" size="sm" className="mt-1 gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Criar anotação
              </Button>
            </div>
          ) : (
            notes.map((note) => {
              const excerpt = getPreview(note.description);
              const isActive = note.id === activeId;
              const folder = folders.find((f) => f.id === note.folder_id);
              return (
                <div
                  key={note.id}
                  onClick={() => setSelectedId(note.id)}
                  className={cn(
                    "flex cursor-pointer flex-col gap-[5px] rounded-[10px] border p-3 transition-colors",
                    isActive ? "border-input bg-elevated" : "border-transparent hover:bg-accent/60"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{note.title || "Sem título"}</span>
                    <span className="shrink-0 text-[11px] text-subtle">{formatListDate(note.updated_at ?? note.created_at)}</span>
                  </div>
                  {excerpt && <span className="line-clamp-2 text-[13px] leading-[1.45] text-muted-foreground">{excerpt}</span>}
                  <span className="text-[11px] text-subtle">{folder?.name ?? "Sem pasta"}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Editor */}
      <div className={cn("min-h-0 min-w-0 flex-col", showEditor ? "flex" : "hidden md:flex")}>
        {active ? (
          <NoteEditorPane
            key={active.id}
            task={active}
            folders={folders}
            onBack={() => setSelectedId(null)}
            onDelete={handleDelete}
            onMoveToFolder={handleMoveToFolder}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <NotebookPen className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm">Selecione ou crie uma anotação.</p>
          </div>
        )}
      </div>

      {/* Modal: Nova Pasta */}
      <Dialog open={isFolderModalOpen} onOpenChange={(o) => !o && setIsFolderModalOpen(false)}>
        <DialogContent className="max-w-md p-6">
          <DialogTitle className="text-lg font-bold">Nova pasta</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Crie uma pasta (caderno) para organizar suas anotações.
          </DialogDescription>
          <form onSubmit={handleCreateFolder} className="mt-3 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="folder-name" className="text-[13px] font-medium text-muted-foreground">Nome da pasta</label>
              <input
                id="folder-name"
                type="text"
                placeholder="Ex: Trabalho, Pessoal, Ideias"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="h-[38px] w-full rounded-md border border-input bg-surface px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary/25"
                autoFocus
                disabled={folderLoading}
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsFolderModalOpen(false)} disabled={folderLoading}>
                Cancelar
              </Button>
              <Button type="submit" disabled={folderLoading}>
                {folderLoading ? "Criando..." : "Criar pasta"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
