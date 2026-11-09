import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useRef, useState, useEffect, useMemo } from "react";
import { Send, MessageSquare, Paperclip, X, FileText, Download, Maximize2, Mic, Square } from "lucide-react";
import { FilePreviewDialog, canPreviewFile } from "@/src/components/common/FilePreviewDialog";
import type { TaskActivity } from "@/src/types";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import * as attachmentService from "@/src/services/attachment.service";

export interface ActivityAttachmentInput {
  url: string;
  name?: string;
  type?: string;
  size?: number;
  /** Arquivo ainda não enviado (link público): vai junto com o comentário. */
  file?: File;
}

function pickAudioMime(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function clock(totalSeconds: number) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

interface LightboxState {
  url: string;
  name?: string | null;
  type?: string | null;
}

function AttachmentPreview({
  url,
  name,
  type,
  onOpen,
}: {
  url: string;
  name?: string | null;
  type?: string | null;
  onOpen: (attachment: LightboxState) => void;
}) {
  const [filePreview, setFilePreview] = useState(false);
  if (type?.startsWith("audio/")) {
    return <audio src={url} controls preload="metadata" className="mt-1.5 h-9 w-full max-w-xs" />;
  }
  if (type?.startsWith("image/")) {
    return (
      <button
        type="button"
        onClick={() => onOpen({ url, name, type })}
        className="mt-1.5 block cursor-zoom-in overflow-hidden rounded-lg border p-0"
        title="Ver imagem"
      >
        <img src={url} alt={name || "anexo"} className="max-h-48 object-cover" />
      </button>
    );
  }
  if (type?.startsWith("video/")) {
    return (
      <div className="relative mt-1.5 inline-block">
        <video src={url} controls className="max-h-48 rounded-lg border" />
        <button
          type="button"
          onClick={() => onOpen({ url, name, type })}
          title="Ampliar vídeo"
          className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white hover:bg-black/80"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
    );
  }
  const fileName = name || "Arquivo";
  if (canPreviewFile({ name: fileName, type })) {
    return (
      <>
        <button
          type="button"
          onClick={() => setFilePreview(true)}
          className="mt-1.5 flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs hover:bg-accent"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{fileName}</span>
        </button>
        {filePreview && <FilePreviewDialog file={{ url, name: fileName, type }} onClose={() => setFilePreview(false)} />}
      </>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs hover:bg-accent"
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{fileName}</span>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

function AttachmentLightbox({ attachment, onClose }: { attachment: LightboxState; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isImage = attachment.type?.startsWith("image/");

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Baixar / abrir original"
          className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          title="Fechar"
          className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {isImage ? (
        <img
          src={attachment.url}
          alt={attachment.name || "anexo"}
          className="max-h-[85vh] max-w-full rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <video
          src={attachment.url}
          controls
          autoPlay
          className="max-h-[85vh] max-w-full rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

const CommentThreadComponent = ({ editor }: NodeViewProps) => {
  const storage = (editor.storage as any).commentThread as {
    activities: TaskActivity[];
    onAddActivity: ((content: string, attachment?: ActivityAttachmentInput) => Promise<void>) | null;
  };
  const { activities, onAddActivity } = storage;
  const [text, setText] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<ActivityAttachmentInput | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, forceUpdate] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<number | null>(null);
  const recDiscardRef = useRef(false);
  const pendingUrl = useMemo(
    () => (pendingAttachment?.file ? URL.createObjectURL(pendingAttachment.file) : null),
    [pendingAttachment?.file],
  );
  useEffect(() => () => { if (pendingUrl) URL.revokeObjectURL(pendingUrl); }, [pendingUrl]);

  useEffect(() => {
    const handleTransaction = () => forceUpdate((x) => x + 1);
    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor]);

  /** Equipe (logada) envia o arquivo na hora; o cliente (link público) manda junto com o comentário. */
  async function acceptFile(file: File) {
    if (!editor.isEditable) {
      setPendingAttachment({ url: "", file, name: file.name, type: file.type || "application/octet-stream", size: file.size });
      return;
    }
    setUploading(true);
    try {
      const { url, size, type } = await attachmentService.uploadFile(file);
      setPendingAttachment({ url, name: file.name, type, size });
    } catch (err) {
      console.error("Falha ao enviar anexo", err);
    } finally {
      setUploading(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await acceptFile(file);
  }

  function stopRecTimer() {
    if (recTimerRef.current) window.clearInterval(recTimerRef.current);
    recTimerRef.current = null;
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
  }

  async function startRecording() {
    setRecError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecError("Seu navegador não suporta gravação de áudio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      const mime = pickAudioMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recDiscardRef.current = false;
      recorder.ondataavailable = (ev) => ev.data.size > 0 && chunks.push(ev.data);
      recorder.onstop = () => {
        stopRecTimer();
        setRecording(false);
        if (recDiscardRef.current || chunks.length === 0) return;
        const type = (recorder.mimeType || mime || "audio/webm").split(";")[0];
        const ext = type.split("/")[1] || "webm";
        void acceptFile(new File(chunks, `audio-${Date.now()}.${ext}`, { type }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecSeconds(0);
      setRecording(true);
      recTimerRef.current = window.setInterval(() => setRecSeconds((n) => n + 1), 1000);
    } catch {
      stopRecTimer();
      setRecError("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  }

  function stopRecording(discard = false) {
    recDiscardRef.current = discard;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  // Ao sair da página com uma gravação em andamento, descarta e solta o microfone.
  useEffect(() => () => {
    recDiscardRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    stopRecTimer();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if ((!text.trim() && !pendingAttachment) || !onAddActivity) return;
    setSending(true);
    try {
      await onAddActivity(text.trim(), pendingAttachment || undefined);
      setText("");
      setPendingAttachment(null);
    } catch {
      // mantém texto e anexo para o usuário tentar de novo
    } finally {
      setSending(false);
    }
  }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} className="my-4 select-none rounded-xl border bg-muted/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comentários</span>
        </div>

        <div className="mb-3 space-y-3">
          {activities.length === 0 && <p className="py-3 text-center text-sm text-muted-foreground">Nenhum comentário ainda.</p>}
          {activities.map((act: any) => (
            <div key={act.id} className="flex items-start gap-2.5">
              <UserAvatar user={act.is_client ? { first_name: "Cliente" } : act.user} className="h-7 w-7" />
              <div className="min-w-0 flex-grow">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold">{act.is_client ? "Cliente" : act.user?.first_name || "Membro"}</span>
                  {act.is_client && (
                    <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase text-primary">Cliente</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">{new Date(act.created_at).toLocaleDateString("pt-BR")}</span>
                </div>
                {act.content && <p className="mt-0.5 text-sm">{act.content}</p>}
                {act.attachment_url && (
                  <AttachmentPreview
                    url={act.attachment_url}
                    name={act.attachment_name}
                    type={act.attachment_type}
                    onOpen={setLightbox}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {(editor.isEditable || onAddActivity) && (
          <form onSubmit={handleSubmit} className="space-y-2">
            {pendingAttachment && (
              <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate flex-grow">{pendingAttachment.name}</span>
                {pendingAttachment.type?.startsWith("audio/") && (pendingAttachment.file ? pendingUrl : pendingAttachment.url) && (
                  <audio
                    controls
                    preload="metadata"
                    src={(pendingAttachment.file ? pendingUrl : pendingAttachment.url) ?? undefined}
                    className="h-8 max-w-[220px]"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setPendingAttachment(null)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
              <button
                type="button"
                disabled={uploading || recording}
                onClick={() => fileInputRef.current?.click()}
                title="Anexar arquivo"
                className="shrink-0 rounded-lg border border-input px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              {recording ? (
                <div className="flex flex-grow items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  <span className="font-mono text-xs">{clock(recSeconds)}</span>
                  <span className="flex-grow text-xs text-muted-foreground">Gravando áudio…</span>
                  <button type="button" onClick={() => stopRecording(true)} title="Cancelar" className="rounded p-1 text-muted-foreground hover:bg-accent">
                    <X className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => stopRecording()} title="Parar e anexar" className="rounded bg-red-500 p-1 text-white hover:bg-red-600">
                    <Square className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={uploading || !!pendingAttachment}
                    onClick={startRecording}
                    title="Gravar áudio"
                    className="shrink-0 rounded-lg border border-input px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <Mic className="h-4 w-4" />
                  </button>
              <input
                type="text"
                placeholder="Escrever um comentário..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="flex-grow rounded-lg border border-input bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
                </>
              )}
              <button
                type="submit"
                disabled={uploading || sending || recording || (!text.trim() && !pendingAttachment)}
                className="rounded-lg bg-primary px-3 py-2 text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            {recError && <p className="text-xs text-destructive">{recError}</p>}
          </form>
        )}
      </div>

      {lightbox && <AttachmentLightbox attachment={lightbox} onClose={() => setLightbox(null)} />}
    </NodeViewWrapper>
  );
};

export const CommentThreadExtension = Node.create({
  name: "commentThread",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {};
  },

  addStorage() {
    return {
      activities: [] as TaskActivity[],
      onAddActivity: null as ((content: string, attachment?: ActivityAttachmentInput) => Promise<void>) | null,
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='comment-thread']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "comment-thread", ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CommentThreadComponent);
  },
});
