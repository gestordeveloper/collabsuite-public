import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardPlus, Info, Loader2, MoreVertical, RotateCcw, Undo2, UserPlus, ArrowRightLeft, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/src/components/ui/dropdown-menu";
import { useTicketBus } from "@/src/lib/ticketBus";
import { errorMessage, deleteMessage, fetchMessages, type Ticket, type TicketMessage } from "@/src/services/ticket.service";
import { ContactAvatar, dayLabel, formatPhone, personName, QueueChip, TagChip } from "./helpers";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";

export type ChatAction = "accept" | "transfer" | "close" | "reopen" | "release" | "task" | "info";

interface Props {
  ticket: Ticket;
  meId: number;
  isAdmin: boolean;
  busy: boolean;
  onAction: (action: ChatAction) => void;
  onBack: () => void;
  onNotify: (message: string) => void;
}

export function ChatPanel({ ticket, meId, isAdmin, busy, onAction, onBack, onNotify }: Props) {
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTo, setReplyTo] = useState<TicketMessage | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreScroll = useRef<number | null>(null);
  const ticketId = ticket.id;

  const upsert = useCallback((incoming: TicketMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === incoming.id);
      if (i === -1) return [...prev, incoming].sort((a, b) => a.id - b.id);
      const next = prev.slice();
      next[i] = { ...next[i], ...incoming, quoted: incoming.quoted ?? next[i].quoted };
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setReplyTo(null);
    stickToBottom.current = true;
    fetchMessages(ticketId)
      .then((r) => {
        if (cancelled) return;
        setMessages(r.messages);
        setHasMore(r.hasMore);
      })
      .catch((err) => !cancelled && onNotify(errorMessage(err, "Não foi possível carregar as mensagens.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  useTicketBus(
    "message",
    useCallback(
      (e) => {
        if (e.ticketId !== ticketId) return;
        const nearBottom = !scroller.current || scroller.current.scrollHeight - scroller.current.scrollTop - scroller.current.clientHeight < 160;
        stickToBottom.current = nearBottom || e.message.from_me;
        upsert(e.message);
      },
      [ticketId, upsert]
    )
  );

  // Após o refetch de uma queda de conexão, garante que nada ficou para trás.
  useTicketBus(
    "reconnect",
    useCallback(() => {
      fetchMessages(ticketId).then((r) => r.messages.forEach(upsert)).catch(() => {});
    }, [ticketId, upsert])
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreScroll.current !== null) {
      el.scrollTop = el.scrollHeight - restoreScroll.current;
      restoreScroll.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  async function loadOlder() {
    if (!messages.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetchMessages(ticketId, messages[0].id);
      restoreScroll.current = scroller.current?.scrollHeight ?? null;
      stickToBottom.current = false;
      setMessages((prev) => [...r.messages, ...prev]);
      setHasMore(r.hasMore);
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function removeMessage(m: TicketMessage) {
    if (!m.is_internal && !window.confirm("Apagar esta mensagem para todos na conversa?")) return;
    try {
      await deleteMessage(ticketId, m.id);
      if (m.is_internal) setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }

  const mine = ticket.user_id === meId;
  const closed = ticket.status === "closed";
  const pending = ticket.status === "pending";

  let lastDay = "";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      {/* Cabeçalho */}
      <header className="flex items-center gap-3 border-b bg-surface px-3 py-2.5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <ContactAvatar contact={ticket.contact} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{ticket.contact.name}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {ticket.contact.number && !ticket.is_group && <span>{formatPhone(ticket.contact.number)}</span>}
            <QueueChip queue={ticket.queue} />
            {ticket.user && <span className="hidden sm:inline">· {personName(ticket.user)}</span>}
            {ticket.tags.slice(0, 3).map((t) => (
              <TagChip key={t.id} tag={t} className="hidden sm:inline-flex" />
            ))}
          </div>
        </div>

        {ticket.status === "open" && (
          <>
            <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => onAction("transfer")} disabled={busy}>
              <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" /> Transferir
            </Button>
            <Button size="sm" onClick={() => onAction("close")} disabled={busy}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Resolver
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon" onClick={() => onAction("info")} title="Dados do contato" aria-label="Dados do contato">
          <Info className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Mais ações">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onAction("task")}>
              <ClipboardPlus className="mr-2 h-4 w-4" /> Criar tarefa
            </DropdownMenuItem>
            {ticket.status === "open" && (
              <>
                <DropdownMenuItem onClick={() => onAction("transfer")}>
                  <ArrowRightLeft className="mr-2 h-4 w-4" /> Transferir
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAction("release")}>
                  <Undo2 className="mr-2 h-4 w-4" /> Devolver para a fila
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Mensagens */}
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-4 sm:px-6"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        }}
      >
        {hasMore && (
          <div className="flex justify-center pb-2">
            <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingMore}>
              {loadingMore && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Carregar mensagens anteriores
            </Button>
          </div>
        )}
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
        ) : (
          messages.map((m) => {
            const day = dayLabel(m.created_at);
            const header =
              day !== lastDay ? (
                <div key={`d-${m.id}`} className="flex justify-center py-2">
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">{day}</span>
                </div>
              ) : null;
            lastDay = day;
            return (
              <div key={m.id} className="space-y-1.5">
                {header}
                <MessageBubble message={m} isGroup={ticket.is_group} onReply={setReplyTo} onDelete={removeMessage} onOpenImage={setPreview} />
              </div>
            );
          })
        )}
      </div>

      {/* Rodapé: compor / assumir / reabrir */}
      {pending ? (
        <FooterBar text="Esta conversa está aguardando atendimento.">
          <Button onClick={() => onAction("accept")} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}Assumir atendimento
          </Button>
        </FooterBar>
      ) : closed ? (
        <FooterBar text="Atendimento resolvido.">
          <Button variant="outline" onClick={() => onAction("reopen")} disabled={busy}>
            <RotateCcw className="mr-2 h-4 w-4" /> Reabrir
          </Button>
        </FooterBar>
      ) : !mine && !isAdmin ? (
        <FooterBar text={`Em atendimento por ${personName(ticket.user)}.`} />
      ) : (
        <Composer ticketId={ticketId} replyTo={replyTo} onClearReply={() => setReplyTo(null)} onSent={(m) => { stickToBottom.current = true; upsert(m); }} onError={onNotify} />
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <button type="button" className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white" onClick={() => setPreview(null)} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
          <img src={preview} alt="" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function FooterBar({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t bg-surface px-4 py-3">
      <p className="text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}
