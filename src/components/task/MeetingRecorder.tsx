import { useEffect, useRef, useState } from "react";
import { Mic, Square, Download, Loader2, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useAudioRecorder } from "@/src/hooks/useAudioRecorder";
import { TranscriptPanel } from "@/src/components/task/TranscriptPanel";
import type { TaskAttachment } from "@/src/types";

interface MeetingRecorderProps {
  taskId: number;
  taskTitle: string;
  onUpload: (file: File) => Promise<TaskAttachment | null>;
}

function formatElapsed(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function slugify(text: string) {
  return text
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "reuniao";
}

export function MeetingRecorder({ taskId, taskTitle, onUpload }: MeetingRecorderProps) {
  const { status, elapsedSeconds, mp3Blob, mp3Url, error, start, stop, reset } = useAudioRecorder();
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [attachment, setAttachment] = useState<TaskAttachment | null>(null);
  const uploadedForBlobRef = useRef<Blob | null>(null);
  const fileName = `Gravacao_${slugify(taskTitle)}_${new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "")}.mp3`;

  function saveAttachment(blob: Blob) {
    setUploadState("uploading");
    const file = new File([blob], fileName, { type: "audio/mpeg" });
    onUpload(file)
      .then((att) => {
        setUploadState(att ? "done" : "error");
        setAttachment(att);
      })
      .catch(() => setUploadState("error"));
  }

  useEffect(() => {
    if (status !== "done" || !mp3Blob || uploadedForBlobRef.current === mp3Blob) return;
    uploadedForBlobRef.current = mp3Blob;
    saveAttachment(mp3Blob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mp3Blob]);

  function handleReset() {
    uploadedForBlobRef.current = null;
    setUploadState("idle");
    setAttachment(null);
    reset();
  }

  if (status === "idle") {
    return (
      <Button variant="secondary" size="sm" className="h-7 gap-1.5 text-xs" onClick={start}>
        <Mic className="h-3.5 w-3.5" /> Gravar Reunião
      </Button>
    );
  }

  if (status === "requesting") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Solicitando acesso ao microfone...
      </span>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </span>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
        </Button>
      </div>
    );
  }

  if (status === "recording") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> Gravando {formatElapsed(elapsedSeconds)}
        </span>
        <Button variant="destructive" size="sm" className="h-7 gap-1.5 text-xs" onClick={stop}>
          <Square className="h-3 w-3" /> Parar
        </Button>
      </div>
    );
  }

  if (status === "processing") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Convertendo para MP3...
      </span>
    );
  }

  // status === "done" — o player fica no lugar do botão de gravar, para ouvir na hora
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {mp3Url && <audio controls preload="metadata" src={mp3Url} className="h-8 max-w-xs flex-1" />}
        <span className="shrink-0 text-xs text-muted-foreground">{formatElapsed(elapsedSeconds)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {mp3Url && (
          <Button asChild variant="secondary" size="sm" className="h-7 gap-1.5 text-xs">
            <a href={mp3Url} download={fileName}>
              <Download className="h-3.5 w-3.5" /> Baixar MP3
            </a>
          </Button>
        )}
        {uploadState === "uploading" && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Salvando anexo...
          </span>
        )}
        {uploadState === "done" && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Anexado à tarefa
          </span>
        )}
        {uploadState === "error" && (
          <>
            <span className="flex items-center gap-1 text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3" /> Falha ao anexar
            </span>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => mp3Blob && saveAttachment(mp3Blob)}>
              <RotateCcw className="h-3.5 w-3.5" /> Tentar salvar novamente
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5" /> Nova Gravação
        </Button>
      </div>
      {uploadState === "done" && attachment && <TranscriptPanel taskId={taskId} attachmentId={attachment.id} />}
    </div>
  );
}
