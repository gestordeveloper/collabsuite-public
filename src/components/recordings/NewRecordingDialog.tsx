import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Upload, Loader2, MonitorSpeaker, RotateCcw, FileAudio } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import * as recordingService from "@/src/services/recording.service";
import type { Recording } from "@/src/services/recording.service";
import type { Project } from "@/src/types";

const TIPOS = ["Reunião", "Chamada", "Entrevista", "Apresentação", "Alinhamento"];

type Mode = "record" | "upload";
type Phase = "idle" | "recording" | "paused" | "review" | "uploading";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  /** Quando a gravação nasce dentro de um projeto, ele fica fixo (sem seletor). */
  fixedProjectId?: number;
  onCreated: (recording: Recording) => void;
}

function pickMimeType(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function clock(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function NewRecordingDialog({ open, onOpenChange, projects, fixedProjectId, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("record");
  const [phase, setPhase] = useState<Phase>("idle");
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>(fixedProjectId ? String(fixedProjectId) : "");
  const [tipo, setTipo] = useState("Reunião");
  const [category, setCategory] = useState("");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [recorded, setRecorded] = useState<{ blob: Blob; seconds: number; mime: string } | null>(null);

  const streamsRef = useRef<MediaStream[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const tickRef = useRef<{ startedAt: number; accumulated: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const releaseMedia = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const reset = useCallback(() => {
    releaseMedia();
    recorderRef.current = null;
    chunksRef.current = [];
    tickRef.current = null;
    setPhase("idle");
    setElapsed(0);
    setError(null);
    setUploadPct(0);
    setTitle("");
    setTipo("Reunião");
    setCategory("");
    setPickedFile(null);
    setRecorded(null);
    setProjectId(fixedProjectId ? String(fixedProjectId) : "");
  }, [releaseMedia, fixedProjectId]);

  // Fechar o diálogo descarta qualquer captura em andamento.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => () => releaseMedia(), [releaseMedia]);

  // Uma gravação ainda não enviada vive só na memória do navegador: avisa antes de fechar a aba.
  useEffect(() => {
    if (phase === "idle" && !recorded) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase, recorded]);

  const currentSeconds = () => {
    const t = tickRef.current;
    if (!t) return 0;
    return t.accumulated + (t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0);
  };

  async function startRecording() {
    setError(null);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamsRef.current.push(mic);

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const destination = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(mic).connect(analyser);
      ctx.createMediaStreamSource(mic).connect(destination);

      if (includeSystemAudio) {
        try {
          // Captura o áudio da aba/tela escolhida (a outra ponta de uma videochamada).
          const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          streamsRef.current.push(display);
          const tracks = display.getAudioTracks();
          if (tracks.length) {
            const src = ctx.createMediaStreamSource(new MediaStream(tracks));
            src.connect(destination);
            src.connect(analyser);
          } else {
            setError("Nenhum áudio foi compartilhado — marque \"Compartilhar áudio da guia\" ao escolher a aba. Gravando só o microfone.");
          }
        } catch {
          setError("Compartilhamento cancelado — gravando só o microfone.");
        }
      }

      const mime = pickMimeType();
      const recorder = new MediaRecorder(destination.stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onerror = () => setError("Erro durante a gravação de áudio.");
      recorder.start(1000);
      recorderRef.current = recorder;

      tickRef.current = { startedAt: Date.now(), accumulated: 0 };
      timerRef.current = window.setInterval(() => setElapsed(currentSeconds()), 500);

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      setPhase("recording");
    } catch (err: any) {
      releaseMedia();
      setError(
        err?.name === "NotAllowedError"
          ? "Permissão do microfone negada. Libere o acesso nas configurações do navegador."
          : err?.name === "NotFoundError"
            ? "Nenhum microfone encontrado."
            : "Não foi possível iniciar a gravação."
      );
    }
  }

  function togglePause() {
    const rec = recorderRef.current;
    const t = tickRef.current;
    if (!rec || !t) return;
    if (rec.state === "recording") {
      rec.pause();
      tickRef.current = { startedAt: 0, accumulated: t.accumulated + (Date.now() - t.startedAt) / 1000 };
      setPhase("paused");
    } else if (rec.state === "paused") {
      rec.resume();
      tickRef.current = { startedAt: Date.now(), accumulated: t.accumulated };
      setPhase("recording");
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    const seconds = currentSeconds();
    rec.onstop = () => {
      const mime = rec.mimeType || "audio/webm";
      setRecorded({ blob: new Blob(chunksRef.current, { type: mime }), seconds, mime });
      setElapsed(seconds);
      releaseMedia();
      setPhase("review");
    };
    rec.stop();
  }

  function discardRecording() {
    setRecorded(null);
    chunksRef.current = [];
    setElapsed(0);
    setPhase("idle");
  }

  async function submit() {
    setError(null);
    const source =
      mode === "upload"
        ? pickedFile && { blob: pickedFile as Blob, name: pickedFile.name, seconds: undefined as number | undefined }
        : recorded && {
            blob: recorded.blob,
            name: `gravacao-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${recorded.mime.includes("mp4") ? "m4a" : recorded.mime.includes("ogg") ? "ogg" : "webm"}`,
            seconds: recorded.seconds,
          };
    if (!source) return;

    setPhase("uploading");
    setUploadPct(0);
    try {
      const created = await recordingService.uploadRecording(
        {
          file: source.blob,
          filename: source.name,
          title: title.trim() || undefined,
          projectId: projectId ? Number(projectId) : null,
          category: category.trim() || undefined,
          tipo,
          durationSeconds: source.seconds,
        },
        setUploadPct
      );
      onCreated(created);
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível enviar a gravação.");
      setPhase(mode === "upload" ? "idle" : "review");
    }
  }

  const readyToSend = mode === "upload" ? !!pickedFile : !!recorded;
  const isCapturing = phase === "recording" || phase === "paused";
  const busy = phase === "uploading";

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && !isCapturing && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova gravação</DialogTitle>
          <DialogDescription>
            O áudio é enviado para o seu armazenamento na AWS e depois transcrito e analisado pela IA.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-[9px] border bg-card p-[3px] text-[13px]">
          {([["record", "Gravar agora", Mic], ["upload", "Enviar arquivo", Upload]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              disabled={isCapturing || busy}
              onClick={() => setMode(key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors disabled:opacity-50",
                mode === key ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {mode === "record" ? (
          <div className="rounded-xl border bg-card p-5 text-center">
            <div className="font-mono text-4xl font-semibold tabular-nums">{clock(elapsed)}</div>
            <div className="mx-auto mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>

            {phase === "idle" && (
              <>
                <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={includeSystemAudio} onChange={(e) => setIncludeSystemAudio(e.target.checked)} />
                  <MonitorSpeaker className="h-3.5 w-3.5" /> Incluir o áudio da aba (videochamadas)
                </label>
                <Button className="mt-4 gap-2" onClick={startRecording}>
                  <Mic className="h-4 w-4" /> Iniciar gravação
                </Button>
              </>
            )}

            {isCapturing && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button variant="outline" className="gap-2" onClick={togglePause}>
                  {phase === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {phase === "paused" ? "Continuar" : "Pausar"}
                </Button>
                <Button className="gap-2" onClick={stopRecording}>
                  <Square className="h-4 w-4" /> Concluir
                </Button>
              </div>
            )}

            {(phase === "review" || phase === "uploading") && recorded && (
              <div className="mt-4 flex items-center justify-center gap-3 text-xs text-muted-foreground">
                <span>Gravação pronta ({(recorded.blob.size / 1024 / 1024).toFixed(1)} MB)</span>
                {!busy && (
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={discardRecording}>
                    <RotateCcw className="h-3 w-3" /> Descartar e regravar
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*,.m4a,.mp3,.wav,.webm,.ogg,.mp4"
              className="hidden"
              onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)}
            />
            <button
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <FileAudio className="h-6 w-6" />
              {pickedFile ? (
                <span className="text-foreground">{pickedFile.name} <span className="text-muted-foreground">({(pickedFile.size / 1024 / 1024).toFixed(1)} MB)</span></span>
              ) : (
                "Escolher áudio ou vídeo (mp3, m4a, wav, webm, mp4…)"
              )}
            </button>
          </div>
        )}

        <div className="grid gap-3 text-sm">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (opcional — a IA sugere um)"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none"
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Categoria (opcional)"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
            />
          </div>
          {!fixedProjectId && (
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none"
            >
              <option value="">Sem projeto (vincular depois)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {busy && (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${uploadPct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {uploadPct < 100 ? `Enviando para a nuvem… ${uploadPct}%` : "Salvando no S3…"}
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy || isCapturing} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!readyToSend || busy || isCapturing} onClick={submit} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar e analisar com IA
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
