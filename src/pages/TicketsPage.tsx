import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MessageCircle, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/src/components/ui/button";
import { useAuthStore } from "@/src/store/auth.store";
import { ticketBus } from "@/src/lib/ticketBus";
import { useTicketSocket } from "@/src/hooks/useTicketSocket";
import { cn } from "@/src/lib/utils";
import {
  errorMessage,
  fetchAttendanceConnections,
  fetchQueues,
  fetchTags,
  fetchTeam,
  fetchTicket,
  updateTicket,
  type AttendanceConnection,
  type Ticket,
  type TicketQueue,
  type TicketStatus,
  type TicketTag,
  type TeamMember,
} from "@/src/services/ticket.service";
import { ChatPanel, type ChatAction } from "@/src/components/tickets/ChatPanel";
import { ContactPanel } from "@/src/components/tickets/ContactPanel";
import { CloseDialog, NewConversationDialog, TicketTaskDialog, TransferDialog } from "@/src/components/tickets/TicketDialogs";
import { TicketList } from "@/src/components/tickets/TicketList";

type Dialog = "transfer" | "close" | "task" | "new" | null;

function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  } catch {
    // sem áudio disponível: o aviso visual (título/lista) já cobre
  }
}

export function TicketsPage() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const meId = user!.id;
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const activeId = ticketId ? Number(ticketId) : null;

  const [queues, setQueues] = useState<TicketQueue[]>([]);
  const [tags, setTags] = useState<TicketTag[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [connections, setConnections] = useState<AttendanceConnection[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [tab, setTab] = useState<TicketStatus>("open");
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tasksVersion, setTasksVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  useEffect(() => {
    Promise.all([fetchQueues(), fetchTags(), fetchTeam(), fetchAttendanceConnections()])
      .then(([q, t, m, c]) => {
        setQueues(q);
        setTags(t);
        setTeam(m);
        setConnections(c);
      })
      .catch((err) => notify(errorMessage(err, "Não foi possível carregar os dados do atendimento.")));
  }, [notify]);

  // Ticket aberto na conversa
  useEffect(() => {
    if (!activeId) return setTicket(null);
    let cancelled = false;
    fetchTicket(activeId)
      .then((t) => {
        if (cancelled) return;
        setTicket(t);
        setTab(t.status);
      })
      .catch(() => {
        if (cancelled) return;
        notify("Esse atendimento não está disponível para você.");
        navigate("/atendimento", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, navigate, notify]);

  // Tempo real
  useTicketSocket({
    onTicket: (e) => {
      ticketBus.emit("ticket", e);
      if (e.action === "update" && e.ticket.id === activeId) setTicket(e.ticket);
      if (e.action === "delete" && e.ticketId === activeId) navigate("/atendimento", { replace: true });
    },
    onMessage: (e) => {
      ticketBus.emit("message", e);
      const m = e.message;
      if (m.from_me || m.is_internal || e.action !== "create") return;
      if (e.ticketId !== activeId || document.hidden) beep();
    },
    onTransferred: (e) => notify(`${e.ticket.contact.name} foi transferido para você.`),
    onReconnect: () => ticketBus.emit("reconnect", undefined),
  });

  // Abrir uma conversa sua com mensagens novas marca como lida
  useEffect(() => {
    if (ticket && ticket.status === "open" && ticket.user_id === meId && ticket.unread_messages > 0 && !document.hidden) {
      updateTicket(ticket.id, {}).then(setTicket).catch(() => {});
    }
  }, [ticket, meId]);

  const changed = useCallback((t: Ticket) => {
    setTicket(t);
    setReloadKey((k) => k + 1);
  }, []);

  async function run(payload: Parameters<typeof updateTicket>[1], switchTab?: TicketStatus) {
    if (!ticket) return;
    setBusy(true);
    try {
      changed(await updateTicket(ticket.id, payload));
      if (switchTab) setTab(switchTab);
    } catch (err) {
      notify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onAction(action: ChatAction) {
    switch (action) {
      case "accept":
      case "reopen":
        return void run({ status: "open", user_id: meId }, "open");
      case "release":
        return void run({ status: "pending", user_id: null }, "pending");
      case "transfer":
        return setDialog("transfer");
      case "close":
        return setDialog("close");
      case "task":
        return setDialog("task");
      case "info":
        return setPanelOpen((v) => !v);
    }
  }

  const showChat = !!activeId;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Lista */}
      <div className={cn("min-h-0 w-full shrink-0 border-r md:w-[360px]", showChat ? "hidden md:block" : "block")}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b bg-surface px-4 py-3">
            <h2 className="font-display text-base font-semibold">Atendimento</h2>
            <Button asChild variant="ghost" size="icon" title="Filas, etiquetas e bot">
              <Link to="/atendimento/configuracoes" aria-label="Configurações de atendimento">
                <Settings2 className="h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <TicketList
              activeId={activeId}
              meId={meId}
              isAdmin={isAdmin}
              queues={queues}
              tags={tags}
              team={team}
              multiConnection={connections.length > 1}
              tab={tab}
              onTabChange={setTab}
              onSelect={(t) => navigate(`/atendimento/${t.id}`)}
              onNewConversation={() => setDialog("new")}
              reloadKey={reloadKey}
            />
          </div>
        </div>
      </div>

      {/* Conversa */}
      <div className={cn("min-h-0 min-w-0 flex-1", showChat ? "flex" : "hidden md:flex")}>
        {ticket ? (
          <>
            <ChatPanel ticket={ticket} meId={meId} isAdmin={isAdmin} busy={busy} onAction={onAction} onBack={() => navigate("/atendimento")} onNotify={notify} />
            {panelOpen && (
              <div className="fixed inset-0 z-40 bg-surface md:static md:inset-auto md:z-auto md:w-[320px] md:shrink-0">
                <ContactPanel ticket={ticket} allTags={tags} tasksVersion={tasksVersion} onClose={() => setPanelOpen(false)} onCreateTask={() => setDialog("task")} onChanged={changed} onNotify={notify} />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
            <div className="rounded-full bg-secondary p-4">
              <MessageCircle className="h-8 w-8" />
            </div>
            <p className="font-display text-base font-semibold text-foreground">{activeId ? "Carregando conversa…" : "Selecione uma conversa"}</p>
            {!activeId && <p className="max-w-xs text-sm">Todas as conversas de WhatsApp da equipe ficam aqui, organizadas por fila. Escolha uma na lista ou inicie uma nova.</p>}
          </div>
        )}
      </div>

      {dialog === "transfer" && ticket && <TransferDialog ticket={ticket} queues={queues} team={team} onClose={() => setDialog(null)} onDone={(t) => { changed(t); setDialog(null); }} />}
      {dialog === "close" && ticket && (
        <CloseDialog
          ticket={ticket}
          onClose={() => setDialog(null)}
          onDone={(t) => { changed(t); setTab("closed"); setDialog(null); }}
          onCreateTask={() => setDialog("task")}
        />
      )}
      {dialog === "task" && ticket && (
        <TicketTaskDialog
          ticket={ticket}
          team={team}
          meId={meId}
          onClose={() => setDialog(null)}
          onCreated={() => { setDialog(null); setTasksVersion((v) => v + 1); setTicket((t) => (t ? { ...t, _count: { tasks: (t._count?.tasks ?? 0) + 1 } } : t)); notify("Tarefa criada e ligada a esta conversa."); }}
        />
      )}
      {dialog === "new" && (
        <NewConversationDialog
          connections={connections}
          queues={queues}
          onClose={() => setDialog(null)}
          onStarted={(t) => { setDialog(null); setReloadKey((k) => k + 1); setTab(t.status); navigate(`/atendimento/${t.id}`); }}
        />
      )}

      {notice && (
        <div role="status" className="fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg border bg-popover px-4 py-2.5 text-sm shadow-lg md:bottom-6">
          {notice}
        </div>
      )}
    </div>
  );
}
