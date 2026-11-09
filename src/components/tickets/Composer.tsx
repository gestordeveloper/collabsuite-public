import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Paperclip, Send, StickyNote, Square, Trash2, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useAudioRecorder } from "@/src/hooks/useAudioRecorder";
import { cn } from "@/src/lib/utils";
import { errorMessage, sendFile, sendMessage, type TicketMessage } from "@/src/services/ticket.service";

interface Props {
  ticketId: number;
  replyTo: TicketMessage | null;
  onClearReply: () => void;
  onSent: (message: TicketMessage) => void;
  onError: (message: string) => void;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Composer({ ticketId, replyTo, onClearReply, onSent, onError }: Props) {
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const recorder = useAudioRecorder();

  // Rascunho por conversa: trocar de ticket não leva o texto junto nem o perde.
  const drafts = useRef(new Map<number, string>());
  const prevTicket = useRef(ticketId);
  useEffect(() => {
    if (prevTicket.current !== ticketId) {
      drafts.current.set(prevTicket.current, text);
      setText(drafts.current.get(ticketId) ?? "");
      setInternal(false);
      recorder.reset();
      prevTicket.current = ticketId;
    }
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (replyTo) areaRef.current?.focus();
  }, [replyTo]);

  async function run(task: () => Promise<TicketMessage>) {
    setSending(true);
    try {
      onSent(await task());
      onClearReply();
    } catch (err) {
      onError(errorMessage(err, "Não foi possível enviar."));
    } finally {
      setSending(false);
    }
  }

  async function submitText() {
    const body = text.trim();
    if (!body || sending) return;
    setText("");
    setSending(true);
    try {
      onSent(await sendMessage(ticketId, { body, quoted_message_id: internal ? undefined : replyTo?.id, is_internal: internal || undefined }));
      onClearReply();
    } catch (err) {
      setText(body);
      onError(errorMessage(err, "Não foi possível enviar."));
    } finally {
      setSending(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await run(() => sendFile(ticketId, file, { filename: file.name, caption: text.trim() || undefined, quotedMessageId: replyTo?.id }));
    setText("");
  }

  async function sendVoice() {
    if (!recorder.mp3Blob) return;
    const blob = recorder.mp3Blob;
    recorder.reset();
    await run(() => sendFile(ticketId, blob, { filename: "audio.mp3", voice: true, quotedMessageId: replyTo?.id }));
  }

  const recording = recorder.status === "recording" || recorder.status === "requesting";
  const hasVoice = recorder.status === "done" && !!recorder.mp3Blob;

  return (
    <div className="border-t bg-surface p-3">
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-primary bg-secondary px-3 py-1.5 text-xs">
          <p className="min-w-0 flex-1 line-clamp-2 text-muted-foreground">{replyTo.body || "Mídia"}</p>
          <button type="button" onClick={onClearReply} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {recording || hasVoice || recorder.status === "processing" ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={recorder.reset} title="Descartar">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
          <div className="flex flex-1 items-center gap-2 text-sm">
            {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />}
            <span className="font-mono tabular-nums">{fmt(recorder.elapsedSeconds)}</span>
            {hasVoice && recorder.mp3Url && <audio src={recorder.mp3Url} controls className="h-8 flex-1" />}
            {recorder.status === "processing" && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          {recording ? (
            <Button type="button" size="icon" onClick={recorder.stop} title="Parar">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" size="icon" onClick={sendVoice} disabled={!hasVoice || sending} title="Enviar áudio">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
          <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} disabled={sending || internal} title="Anexar arquivo">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => setInternal((v) => !v)} className={cn(internal && "bg-warning/15 text-warning hover:bg-warning/25")} title="Nota interna (o cliente não vê)">
            <StickyNote className="h-4 w-4" />
          </Button>
          <textarea
            ref={areaRef}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submitText();
              }
            }}
            placeholder={internal ? "Escreva uma nota interna — o cliente não recebe" : "Digite uma mensagem"}
            className={cn(
              "min-h-9 flex-1 resize-none rounded-lg border bg-secondary px-3 py-2 text-sm outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-ring",
              internal && "border-warning/50 bg-warning/5"
            )}
          />
          {text.trim() ? (
            <Button type="button" size="icon" onClick={() => void submitText()} disabled={sending} title="Enviar">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon" onClick={() => void recorder.start()} disabled={sending || internal} title="Gravar áudio">
              <Mic className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      {recorder.error && <p className="mt-1 text-xs text-destructive">{recorder.error}</p>}
    </div>
  );
}
