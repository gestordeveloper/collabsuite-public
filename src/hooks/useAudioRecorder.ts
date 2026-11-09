import { useCallback, useRef, useState } from "react";

export type RecorderStatus = "idle" | "requesting" | "recording" | "processing" | "done" | "error";

const BUFFER_SIZE = 4096;
const MP3_KBPS = 128;

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

type WorkerOutMessage = { type: "chunk"; data: Uint8Array } | { type: "done" } | { type: "error"; message: string };

export function useAudioRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [mp3Blob, setMp3Blob] = useState<Blob | null>(null);
  const [mp3Url, setMp3Url] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mp3UrlRef = useRef<string | null>(null);
  const hadAudioRef = useRef(false);

  const cleanupGraph = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cleanupGraph();
    workerRef.current?.terminate();
    workerRef.current = null;
    chunksRef.current = [];
    if (mp3UrlRef.current) URL.revokeObjectURL(mp3UrlRef.current);
    mp3UrlRef.current = null;
    setMp3Blob(null);
    setMp3Url(null);
    setElapsedSeconds(0);
    setError(null);
    setStatus("idle");
  }, [cleanupGraph]);

  const start = useCallback(async () => {
    setError(null);
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext: AudioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;

      const worker = new Worker(new URL("../lib/audio/mp3Encoder.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      chunksRef.current = [];
      hadAudioRef.current = false;

      worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
        const msg = e.data;
        if (msg.type === "chunk") {
          chunksRef.current.push(msg.data);
          return;
        }
        if (msg.type === "error") {
          setError(msg.message);
          setStatus("error");
          return;
        }
        // msg.type === "done"
        if (!hadAudioRef.current || chunksRef.current.length === 0) {
          setError("Nenhum áudio foi capturado. Verifique o microfone e tente novamente.");
          setStatus("error");
          return;
        }
        const blob = new Blob(chunksRef.current as BlobPart[], { type: "audio/mpeg" });
        chunksRef.current = [];
        const url = URL.createObjectURL(blob);
        mp3UrlRef.current = url;
        setMp3Blob(blob);
        setMp3Url(url);
        setStatus("done");
      };

      worker.onerror = (ev) => {
        ev.preventDefault?.();
        setError(ev.message || "Falha ao codificar o áudio em MP3.");
        setStatus("error");
      };

      worker.postMessage({ type: "init", sampleRate: audioContext.sampleRate, kbps: MP3_KBPS });

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // createScriptProcessor is deprecated but universally supported; routes through a
      // silent GainNode (instead of straight to destination) to avoid mic feedback/echo.
      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;
      const silentGain = audioContext.createGain();
      gainRef.current = silentGain;
      silentGain.gain.value = 0;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        hadAudioRef.current = true;
        const pcm = floatTo16BitPCM(input);
        worker.postMessage({ type: "encode", samples: pcm }, [pcm.buffer]);
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
      setStatus("recording");
    } catch (err: any) {
      cleanupGraph();
      setError(err?.name === "NotAllowedError" ? "Permissão de microfone negada." : (err?.message || "Não foi possível iniciar a gravação."));
      setStatus("error");
    }
  }, [cleanupGraph]);

  const stop = useCallback(() => {
    if (status !== "recording") return;
    cleanupGraph();
    setStatus("processing");
    workerRef.current?.postMessage({ type: "finish" });
  }, [status, cleanupGraph]);

  return { status, elapsedSeconds, mp3Blob, mp3Url, error, start, stop, reset };
}
