import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { cn } from "@/src/lib/utils";
import {
  createTicketTask,
  errorMessage,
  searchContacts,
  startConversation,
  updateTicket,
  type AttendanceConnection,
  type ChatContact,
  type TeamMember,
  type Ticket,
  type TicketQueue,
  type TicketTaskSummary,
} from "@/src/services/ticket.service";
import { CLOSE_REASONS, ContactAvatar, formatPhone, personName, SENTIMENTS, TICKET_PRIORITIES } from "./helpers";

const NONE = "none";

function ErrorLine({ message }: { message: string | null }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

// ─── Transferir ───

interface TransferProps {
  ticket: Ticket;
  queues: TicketQueue[];
  team: TeamMember[];
  onClose: () => void;
  onDone: (ticket: Ticket) => void;
}

export function TransferDialog({ ticket, queues, team, onClose, onDone }: TransferProps) {
  const [queueId, setQueueId] = useState<string>(ticket.queue_id ? String(ticket.queue_id) : NONE);
  const [userId, setUserId] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const members = useMemo(() => {
    const queue = queues.find((q) => String(q.id) === queueId);
    return queue ? team.filter((m) => queue.user_ids.includes(m.id)) : team;
  }, [queues, team, queueId]);

  async function submit() {
    if (queueId === NONE && userId === NONE) return setError("Escolha uma fila ou um atendente.");
    setBusy(true);
    setError(null);
    try {
      const toUser = userId !== NONE;
      const updated = await updateTicket(ticket.id, {
        queue_id: queueId === NONE ? undefined : Number(queueId),
        // Só a fila: o ticket volta para "aguardando" (ou o rodízio da fila escolhe quem assume).
        user_id: toUser ? Number(userId) : null,
        status: toUser ? "open" : "pending",
      });
      onDone(updated);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir atendimento</DialogTitle>
          <DialogDescription>Envie a conversa de {ticket.contact.name} para outra fila ou atendente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Fila</Label>
            <Select value={queueId} onValueChange={(v) => { setQueueId(v); setUserId(NONE); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem fila</SelectItem>
                {queues.map((q) => (
                  <SelectItem key={q.id} value={String(q.id)}>{q.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Atendente</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Qualquer um da fila (aguardando)</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{personName(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ErrorLine message={error} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Transferir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Resolver ───

interface CloseProps {
  ticket: Ticket;
  onClose: () => void;
  onDone: (ticket: Ticket) => void;
  onCreateTask: () => void;
}

export function CloseDialog({ ticket, onClose, onDone, onCreateTask }: CloseProps) {
  const [reason, setReason] = useState(ticket.close_reason ?? "");
  const [sentiment, setSentiment] = useState(ticket.customer_sentiment ?? "");
  const [notes, setNotes] = useState(ticket.closing_observations ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason) return setError("Escolha o motivo do atendimento.");
    setBusy(true);
    setError(null);
    try {
      onDone(
        await updateTicket(ticket.id, {
          status: "closed",
          close_reason: reason,
          customer_sentiment: sentiment || null,
          closing_observations: notes.trim() || null,
        })
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resolver atendimento</DialogTitle>
          <DialogDescription>Registre como foi a conversa com {ticket.contact.name}. Isso alimenta seus relatórios.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <div className="flex flex-wrap gap-1.5">
              {CLOSE_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", reason === r.value ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Como o cliente saiu?</Label>
            <div className="flex gap-1.5">
              {SENTIMENTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  title={s.label}
                  onClick={() => setSentiment(sentiment === s.value ? "" : s.value)}
                  className={cn("flex-1 rounded-lg border py-1.5 text-xl transition-all", sentiment === s.value ? "border-primary bg-primary/15" : "opacity-60 hover:opacity-100")}
                >
                  {s.emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Opcional — o que ficou combinado, pendências…" />
          </div>
          <ErrorLine message={error} />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onCreateTask}>Criar tarefa de follow-up</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Resolver</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Nova conversa ───

interface NewConversationProps {
  connections: AttendanceConnection[];
  queues: TicketQueue[];
  onClose: () => void;
  onStarted: (ticket: Ticket) => void;
}

export function NewConversationDialog({ connections, queues, onClose, onStarted }: NewConversationProps) {
  const [connectionId, setConnectionId] = useState<string>(connections[0] ? String(connections[0].id) : "");
  const [queueId, setQueueId] = useState<string>(NONE);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ChatContact[]>([]);
  const [picked, setPicked] = useState<ChatContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = search.replace(/\D/g, "");
  const looksLikeNumber = digits.length >= 8 && /^[\d\s()+-]+$/.test(search.trim());

  useEffect(() => {
    if (picked || search.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      searchContacts(search.trim()).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search, picked]);

  async function submit() {
    if (!connectionId) return setError("Escolha a conexão de WhatsApp.");
    if (!picked && !looksLikeNumber) return setError("Escolha um contato ou digite um número com DDD.");
    setBusy(true);
    setError(null);
    try {
      onStarted(
        await startConversation({
          connection_id: Number(connectionId),
          queue_id: queueId === NONE ? null : Number(queueId),
          ...(picked ? { contact_id: picked.id } : { number: digits }),
        })
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>Inicie um atendimento com um contato ou um número novo.</DialogDescription>
        </DialogHeader>
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conexão de WhatsApp está habilitada para atendimento. Ative uma em Atendimento → Configurações.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Conexão</Label>
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.label}{c.phone_number ? ` · ${formatPhone(c.phone_number)}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Contato ou número</Label>
              {picked ? (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <ContactAvatar contact={picked} className="h-8 w-8 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{picked.name}</p>
                    <p className="text-xs text-muted-foreground">{formatPhone(picked.number)}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setPicked(null); setSearch(""); }}>Trocar</Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-subtle" />
                    <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou telefone com DDD (ex.: 11 98888-7777)" autoFocus />
                  </div>
                  {results.length > 0 && (
                    <div className="max-h-44 overflow-y-auto rounded-lg border">
                      {results.map((c) => (
                        <button key={c.id} type="button" onClick={() => setPicked(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent">
                          <ContactAvatar contact={c} className="h-8 w-8 text-xs" />
                          <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                          <span className="text-xs text-muted-foreground">{formatPhone(c.number)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {looksLikeNumber && results.length === 0 && <p className="text-xs text-muted-foreground">Número novo: {formatPhone(digits)} — inclua o código do país se não for do Brasil.</p>}
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Fila (opcional)</Label>
              <Select value={queueId} onValueChange={setQueueId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem fila</SelectItem>
                  {queues.map((q) => (
                    <SelectItem key={q.id} value={String(q.id)}>{q.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ErrorLine message={error} />
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || connections.length === 0}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Iniciar conversa</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Criar tarefa a partir da conversa ───

interface TaskProps {
  ticket: Ticket;
  team: TeamMember[];
  meId: number;
  onClose: () => void;
  onCreated: (task: TicketTaskSummary) => void;
}

export function TicketTaskDialog({ ticket, team, meId, onClose, onCreated }: TaskProps) {
  const [title, setTitle] = useState(`Retornar ${ticket.contact.name}`);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState(String(ticket.user_id ?? meId));
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return setError("Dê um título para a tarefa.");
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createTicketTask(ticket.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          user_id: Number(assignee),
          due_at: due ? new Date(`${due}T12:00:00`).toISOString() : null,
        })
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Criar tarefa desta conversa</DialogTitle>
          <DialogDescription>A tarefa fica ligada ao atendimento de {ticket.contact.name} e já leva o contexto do cliente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="O que precisa ser feito?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {team.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{personName(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Prazo</Label>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <ErrorLine message={error} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar tarefa</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
