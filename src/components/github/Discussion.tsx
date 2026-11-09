import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import * as gh from "@/src/services/github.service";
import { Avatar, ErrorBox, timeAgo } from "./common";

/** Texto do GitHub (markdown) mostrado como texto simples, preservando quebras de linha. */
export function Body({ text }: { text: string }) {
  return text.trim() ? <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</div> : <p className="text-sm italic text-muted-foreground">Sem descrição.</p>;
}

export function Entry({ user, date, children, badge }: { user: gh.Person | null; date: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Avatar person={user} size={28} />
      <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b bg-surface/50 px-3 py-1.5 text-xs text-muted-foreground">
          <b className="text-foreground">{user?.login ?? "alguém"}</b> · {timeAgo(date)} {badge}
        </div>
        <div className="px-3 py-2.5">{children}</div>
      </div>
    </div>
  );
}

export function CommentBox({ canWrite, onSend, placeholder = "Escreva um comentário…" }: { canWrite: boolean; onSend: (body: string) => Promise<void>; placeholder?: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canWrite) return <p className="text-xs text-muted-foreground">Conecte sua conta do GitHub para comentar.</p>;
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(text.trim());
      setText("");
    } catch (err) {
      setError(gh.errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={send} className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={placeholder} aria-label="Comentário" className="w-full resize-y rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy || !text.trim()}><Send className="h-3.5 w-3.5" /> {busy ? "Enviando…" : "Comentar"}</Button>
      </div>
    </form>
  );
}
