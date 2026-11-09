import { useState } from "react";
import { FileText, Loader2, AlertTriangle, RotateCcw, Sparkles, Send, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import * as transcriptService from "@/src/services/transcript.service";
import type { TaskTranscript, TranscriptMessage } from "@/src/types";

interface Props {
  taskId: number;
  attachmentId: number;
}

/** Transcription (Groq/Whisper) + a small chat panel to ask questions, get summaries and key
 *  points about a meeting recording, once it's transcribed. */
export function TranscriptPanel({ taskId, attachmentId }: Props) {
  const [transcript, setTranscript] = useState<TaskTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  const [showText, setShowText] = useState(false);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function startTranscription() {
    setLoading(true);
    try {
      const t = await transcriptService.createTranscript(taskId, attachmentId);
      setTranscript(t);
    } catch (err: any) {
      setTranscript({
        id: 0,
        task_id: taskId,
        attachment_id: attachmentId,
        status: "error",
        text: null,
        language: null,
        error: err?.response?.data?.error || "Falha ao transcrever.",
        created_at: "",
        updated_at: "",
      });
    } finally {
      setLoading(false);
    }
  }

  async function retry() {
    if (!transcript?.id) return;
    setLoading(true);
    try {
      setTranscript(await transcriptService.retryTranscript(transcript.id));
    } catch (err) {
      console.error("Retry failed", err);
    } finally {
      setLoading(false);
    }
  }

  async function send(text: string) {
    if (!transcript || !text.trim() || sending) return;
    setSending(true);
    const optimisticUser: TranscriptMessage = {
      id: Date.now(),
      transcript_id: transcript.id,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);
    setInput("");
    try {
      const reply = await transcriptService.sendChatMessage(transcript.id, text);
      setMessages((m) => [...m, reply]);
    } catch (err) {
      console.error("Chat failed", err);
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          transcript_id: transcript.id,
          role: "assistant",
          content: "Não foi possível obter uma resposta agora. Tente novamente.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcrevendo áudio...
      </span>
    );
  }

  if (!transcript) {
    return (
      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={startTranscription}>
        <Sparkles className="h-3.5 w-3.5" /> Transcrever com IA
      </Button>
    );
  }

  if (transcript.status === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {transcript.error || "Falha ao transcrever."}
        </span>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={transcript.id ? retry : startTranscription}>
          <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border bg-muted/20 p-3">
      <button onClick={() => setShowText((v) => !v)} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        {showText ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <FileText className="h-3.5 w-3.5" /> Transcrição {transcript.language ? `(${transcript.language})` : ""}
      </button>
      {showText && (
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-background p-2 text-xs text-muted-foreground">
          {transcript.text}
        </p>
      )}

      <div className="space-y-2 border-t pt-2">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" className="h-6 gap-1 text-[11px]" onClick={() => send("Gere um resumo objetivo desta reunião.")} disabled={sending}>
            <Sparkles className="h-3 w-3" /> Resumo
          </Button>
          <Button variant="secondary" size="sm" className="h-6 gap-1 text-[11px]" onClick={() => send("Liste os principais pontos e decisões discutidos nesta reunião.")} disabled={sending}>
            <Sparkles className="h-3 w-3" /> Principais pontos
          </Button>
        </div>

        {messages.length > 0 && (
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-md bg-background p-2">
            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {m.content}
                </span>
              </div>
            ))}
            {sending && (
              <div className="text-left">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Pensando...
                </span>
              </div>
            )}
          </div>
        )}

        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte algo sobre a reunião..."
            className="h-7 flex-1 rounded-md border border-input bg-surface px-2 text-xs focus:outline-none"
            disabled={sending}
          />
          <Button type="submit" size="sm" className="h-7 w-7 p-0" disabled={sending || !input.trim()}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
