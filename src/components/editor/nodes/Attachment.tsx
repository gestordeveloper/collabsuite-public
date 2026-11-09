import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState, useEffect, useRef } from "react";
import { Paperclip, Upload, X, Download, File as FileIcon, ImageIcon, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { FilePreviewDialog, canPreviewFile } from "@/src/components/common/FilePreviewDialog";
import { createDocumentFromImageUrl } from "@/src/lib/photosuite/fromUrl";
import type { TaskAttachment } from "@/src/types";

interface AttachmentStorage {
  attachments: TaskAttachment[];
  onUploadFile: ((file: File) => Promise<TaskAttachment | null>) | null;
  onDeleteAttachment: ((attachmentId: number) => Promise<void>) | null;
}

const fileIcon = (fileType: string) => {
  if (fileType.startsWith("image/")) return "🖼️";
  if (fileType.startsWith("video/")) return "🎬";
  if (fileType.startsWith("audio/")) return "🎵";
  if (fileType.includes("pdf")) return "📕";
  if (fileType.includes("zip") || fileType.includes("compressed")) return "🗜️";
  if (fileType.includes("excel") || fileType.includes("spreadsheet")) return "📊";
  if (fileType.includes("word") || fileType.includes("document")) return "📄";
  if (fileType.includes("json")) return "⚙️";
  return "📎";
};

const formatSize = (bytes: number) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const AttachmentComponent = ({ editor }: NodeViewProps) => {
  const storage = (editor.storage as any).attachment as AttachmentStorage;
  const { attachments, onUploadFile, onDeleteAttachment } = storage;
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [, forceUpdate] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);

  /** Abre a imagem anexada como documento novo no Photosuite. */
  async function editInPhotosuite(att: TaskAttachment) {
    setOpeningId(att.id);
    try {
      const id = await createDocumentFromImageUrl(att.file_url, att.file_name);
      navigate(`/photosuite/${id}`);
    } catch (err) {
      console.error("Falha ao abrir no Photosuite", err);
      alert("Não foi possível abrir essa imagem no Photosuite.");
    } finally {
      setOpeningId(null);
    }
  }

  useEffect(() => {
    const handleTransaction = () => forceUpdate((x) => x + 1);
    editor.on("transaction", handleTransaction);
    return () => { editor.off("transaction", handleTransaction); };
  }, [editor]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !onUploadFile) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await onUploadFile(file);
    }
    setUploading(false);
  }

  return (
    <NodeViewWrapper>
      <div
        contentEditable={false}
        className="notion-attachment my-4 select-none"
        onDragOver={(e) => { if (!editor.isEditable) return; e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!editor.isEditable) return;
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Anexos</span>
          {attachments.length > 0 && (
            <span className="ml-auto text-[10px] font-medium text-muted-foreground">{attachments.length} arquivo(s)</span>
          )}
        </div>

        <div className="space-y-1.5">
          {attachments.map((att: TaskAttachment) => (
            <div key={att.id} className="group rounded-lg border bg-card px-3 py-2.5 transition-all hover:border-primary/40 hover:shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">
                  {fileIcon(att.file_type)}
                </div>
                <button
                  type="button"
                  onClick={() => canPreviewFile({ name: att.file_name, type: att.file_type }) && setPreview(att)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium">{att.file_name}</p>
                  <p className="text-[10px] text-muted-foreground">{formatSize(att.file_size)}</p>
                </button>
                <div className="flex items-center gap-1 opacity-0 transition-all group-hover:opacity-100 max-md:opacity-100">
                  {canPreviewFile({ name: att.file_name, type: att.file_type }) && (
                    <button
                      type="button"
                      onClick={() => setPreview(att)}
                      title="Visualizar"
                      aria-label="Visualizar"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {att.file_type.startsWith("image/") && !att.file_type.includes("svg") && (
                    <button
                      onClick={() => editInPhotosuite(att)}
                      disabled={openingId === att.id}
                      title="Editar no Photosuite"
                      aria-label="Editar no Photosuite"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <a
                    href={att.file_url}
                    download={att.file_name}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  {editor.isEditable && (
                    <button
                      onClick={() => onDeleteAttachment?.(att.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {att.file_type.startsWith("audio/") && (
                <audio controls preload="none" src={att.file_url} className="mt-2 h-9 w-full" />
              )}
            </div>
          ))}

          {attachments.length === 0 && !dragging && (
            <p className="py-2 text-sm text-muted-foreground">Nenhum anexo ainda.</p>
          )}
        </div>

        {editor.isEditable && (
          <div
            className={`mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed py-4 text-sm transition-all ${
              dragging ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span>Enviando...</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                <span>Arraste arquivos aqui ou clique para enviar</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        )}
      </div>

      {preview && (
        <FilePreviewDialog
          file={{ url: preview.file_url, name: preview.file_name, type: preview.file_type }}
          onClose={() => setPreview(null)}
        />
      )}
    </NodeViewWrapper>
  );
};

export const AttachmentExtension = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {};
  },

  addStorage() {
    return {
      attachments: [] as TaskAttachment[],
      onUploadFile: null as ((file: File) => Promise<TaskAttachment | null>) | null,
      onDeleteAttachment: null as ((attachmentId: number) => Promise<void>) | null,
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='attachment']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "attachment", ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentComponent);
  },
});