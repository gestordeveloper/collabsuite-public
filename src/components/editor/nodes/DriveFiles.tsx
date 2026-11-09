import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { HardDrive, Plus, X, Eye, Folder, FileText, ChevronLeft, Loader2, Check } from "lucide-react";
import { FilePreviewDialog, type PreviewFile } from "@/src/components/common/FilePreviewDialog";
import { DRIVE_FOLDER_MIME_TYPE, type DriveFile } from "@/src/services/drive.service";
import * as taskDriveService from "@/src/services/taskDrive.service";

/** O que fica salvo no conteúdo da tarefa — só a referência; o arquivo continua no Drive. */
export interface DriveFileRef {
  id: string;
  name: string;
  mimeType: string;
  size?: string | null;
}

interface DriveFilesStorage {
  taskId?: number;
  /** Link público do cliente: baixa o arquivo pela rota pública, sem login. */
  isPublic: boolean;
}

const GOOGLE_NATIVE = "application/vnd.google-apps.";

function errorMessage(err: any, fallback: string) {
  return err?.response?.data?.error || err?.message || fallback;
}

/** Docs/Sheets/Slides do Google chegam do servidor já exportados como PDF. */
function previewType(ref: DriveFileRef) {
  return ref.mimeType.startsWith(GOOGLE_NATIVE) ? "application/pdf" : ref.mimeType;
}

function formatSize(size?: string | null) {
  const bytes = Number(size);
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DrivePicker({ taskId, selectedIds, onConfirm, onClose }: {
  taskId: number;
  selectedIds: Set<string>;
  onConfirm: (files: DriveFileRef[]) => void;
  onClose: () => void;
}) {
  const [stack, setStack] = useState<{ id?: string; name: string }[]>([{ name: "Pasta do projeto" }]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Map<string, DriveFileRef>>(new Map());
  const current = stack[stack.length - 1];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    taskDriveService
      .fetchTaskDriveFiles(taskId, current.id)
      .then((list) => { if (!cancelled) setFiles(list); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err, "Não foi possível carregar o Drive.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId, current.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(file: DriveFile) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(file.id)) next.delete(file.id);
      else next.set(file.id, { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size ?? null });
      return next;
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          {stack.length > 1 && (
            <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} title="Voltar" className="rounded-md p-1 hover:bg-accent">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current.name}</span>
          <button type="button" onClick={onClose} title="Fechar" className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto p-2">
          {loading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {!loading && error && <p className="px-3 py-6 text-center text-sm text-destructive">{error}</p>}
          {!loading && !error && files.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Pasta vazia.</p>}
          {!loading && !error && files.map((file) => {
            if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setStack((s) => [...s, { id: file.id, name: file.name }])}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="truncate">{file.name}</span>
                </button>
              );
            }
            const already = selectedIds.has(file.id);
            const isPicked = picked.has(file.id);
            return (
              <button
                key={file.id}
                type="button"
                disabled={already}
                onClick={() => toggle(file)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isPicked || already ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
                  {(isPicked || already) && <Check className="h-3 w-3" />}
                </span>
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                {already && <span className="text-[10px] text-muted-foreground">já adicionado</span>}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">Cancelar</button>
          <button
            type="button"
            disabled={picked.size === 0}
            onClick={() => onConfirm(Array.from(picked.values()))}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {picked.size > 0 ? `Adicionar (${picked.size})` : "Adicionar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const DriveFilesComponent = ({ editor, node, updateAttributes }: NodeViewProps) => {
  const storage = (editor.storage as any).driveFiles as DriveFilesStorage;
  const files: DriveFileRef[] = node.attrs.files || [];
  const [picking, setPicking] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [, forceUpdate] = useState(0);

  // O storage (taskId/isPublic) é preenchido depois da montagem pelo editor pai.
  useEffect(() => {
    const handleTransaction = () => forceUpdate((x) => x + 1);
    editor.on("transaction", handleTransaction);
    return () => { editor.off("transaction", handleTransaction); };
  }, [editor]);

  useEffect(() => () => { if (preview?.url.startsWith("blob:")) URL.revokeObjectURL(preview.url); }, [preview]);

  async function open(ref: DriveFileRef) {
    if (!storage.taskId || openingId) return;
    setOpeningId(ref.id);
    setError("");
    try {
      const type = previewType(ref);
      if (type.startsWith("video/") || type.startsWith("audio/")) {
        // Vídeo toca em streaming: abre na hora, sem baixar o arquivo inteiro antes.
        const url = await taskDriveService.getTaskDriveStreamUrl(storage.taskId, ref.id, storage.isPublic);
        setPreview({ url, name: ref.name, type });
        return;
      }
      const blob = await taskDriveService.fetchTaskDriveFileBlob(storage.taskId, ref.id, storage.isPublic);
      setPreview({ url: URL.createObjectURL(new Blob([blob], { type })), name: ref.name, type });
    } catch (err: any) {
      setError("Não foi possível abrir este arquivo. Confira se ele ainda existe no Drive do projeto.");
    } finally {
      setOpeningId(null);
    }
  }

  function addFiles(picked: DriveFileRef[]) {
    const known = new Set(files.map((f) => f.id));
    updateAttributes({ files: [...files, ...picked.filter((f) => !known.has(f.id))] });
    setPicking(false);
  }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} className="my-4 select-none rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-sky-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Arquivos do Drive</span>
          {files.length > 0 && <span className="ml-auto text-[10px] font-medium text-muted-foreground">{files.length} arquivo(s)</span>}
        </div>

        <div className="space-y-1.5">
          {files.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nenhum arquivo selecionado.</p>}
          {files.map((f) => (
            <div key={f.id} className="group flex items-center gap-3 rounded-lg border px-3 py-2 transition-all hover:border-primary/40">
              <button type="button" onClick={() => open(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
                  {formatSize(f.size) && <span className="block text-[10px] text-muted-foreground">{formatSize(f.size)}</span>}
                </span>
              </button>
              {openingId === f.id ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <button type="button" onClick={() => open(f)} title="Visualizar" aria-label="Visualizar"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Eye className="h-3.5 w-3.5" />
                </button>
              )}
              {editor.isEditable && (
                <button type="button" onClick={() => updateAttributes({ files: files.filter((x) => x.id !== f.id) })}
                  title="Remover da tarefa" aria-label="Remover da tarefa"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 max-md:opacity-100">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        {editor.isEditable && (
          <button
            type="button"
            disabled={!storage.taskId}
            onClick={() => setPicking(true)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed py-3 text-sm text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Selecionar do Google Drive
          </button>
        )}
      </div>

      {picking && storage.taskId && (
        <DrivePicker taskId={storage.taskId} selectedIds={new Set(files.map((f) => f.id))} onConfirm={addFiles} onClose={() => setPicking(false)} />
      )}
      {preview && <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />}
    </NodeViewWrapper>
  );
};

export const DriveFilesExtension = Node.create({
  name: "driveFiles",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      files: {
        default: [] as DriveFileRef[],
        parseHTML: (el: HTMLElement) => {
          try { return JSON.parse(el.getAttribute("data-files") || "[]"); } catch { return []; }
        },
        renderHTML: (attrs: Record<string, any>) => ({ "data-files": JSON.stringify(attrs.files || []) }),
      },
    };
  },

  addStorage() {
    return { taskId: undefined as number | undefined, isPublic: false };
  },

  parseHTML() {
    return [{ tag: "div[data-type='drive-files']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "drive-files", ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DriveFilesComponent);
  },
});
