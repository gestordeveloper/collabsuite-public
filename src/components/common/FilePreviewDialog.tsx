import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, FileQuestion, Loader2 } from "lucide-react";

export interface PreviewFile {
  url: string;
  name: string;
  type?: string | null;
}

const OFFICE_EXT = /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i;
const TEXT_EXT = /\.(txt|csv|json|md|log|xml)$/i;

/** Tipos que o navegador (ou o visualizador do Google) consegue mostrar sem baixar. */
export function canPreviewFile(file: { name: string; type?: string | null }) {
  const t = file.type ?? "";
  return (
    t.startsWith("image/") || t.startsWith("video/") || t.startsWith("audio/") ||
    t.includes("pdf") || t.startsWith("text/") || OFFICE_EXT.test(file.name) || TEXT_EXT.test(file.name)
  );
}

function absoluteUrl(url: string) {
  try { return new URL(url, window.location.origin).toString(); } catch { return url; }
}

function StreamingVideo({ file }: { file: PreviewFile }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative flex h-full w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
      {!ready && !failed && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-white/80">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-xs">Carregando vídeo…</span>
        </div>
      )}
      {failed && <p className="text-sm text-white/80">Não foi possível reproduzir este vídeo.</p>}
      <video
        src={file.url}
        controls
        autoPlay
        preload="auto"
        onLoadedData={() => setReady(true)}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full rounded-lg"
      />
    </div>
  );
}

function PreviewBody({ file }: { file: PreviewFile }) {
  const t = file.type ?? "";
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (t.startsWith("image/")) {
    return <img src={file.url} alt={file.name} onClick={stop} className="max-h-full max-w-full rounded-lg object-contain" />;
  }
  if (t.startsWith("video/")) {
    return <StreamingVideo file={file} />;
  }
  if (t.startsWith("audio/")) {
    return <audio src={file.url} controls autoPlay onClick={stop} className="w-full max-w-xl" />;
  }
  if (t.includes("pdf") || t.startsWith("text/") || TEXT_EXT.test(file.name)) {
    return <iframe src={file.url} title={file.name} onClick={stop} className="h-full w-full rounded-lg bg-white" />;
  }
  if (OFFICE_EXT.test(file.name)) {
    // O visualizador do Google precisa alcançar o arquivo pela internet pública.
    const abs = absoluteUrl(file.url);
    if (!/^(blob:|https?:\/\/(localhost|127\.|192\.168\.))/i.test(abs)) {
      return (
        <iframe
          src={`https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(abs)}`}
          title={file.name}
          onClick={stop}
          className="h-full w-full rounded-lg bg-white"
        />
      );
    }
  }
  return (
    <div onClick={stop} className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center">
      <FileQuestion className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Não é possível visualizar este tipo de arquivo aqui.</p>
      <a href={file.url} download={file.name} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Baixar arquivo
      </a>
    </div>
  );
}

/** Visualizador em tela cheia, no estilo do Google Drive: abre o anexo sem precisar baixar. */
export function FilePreviewDialog({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[999] flex flex-col bg-black/85" onClick={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
        <a
          href={file.url}
          download={file.name}
          title="Baixar"
          className="rounded-lg bg-white/10 p-2 hover:bg-white/20"
        >
          <Download className="h-5 w-5" />
        </a>
        <button type="button" onClick={onClose} title="Fechar (Esc)" className="rounded-lg bg-white/10 p-2 hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
        <PreviewBody file={file} />
      </div>
    </div>,
    document.body,
  );
}
