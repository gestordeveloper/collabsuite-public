import { useEffect, useState } from "react";
import { ClipboardPlus, ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/src/components/ui/button";
import { Switch } from "@/src/components/ui/switch";
import { cn } from "@/src/lib/utils";
import { PRIORITY_META } from "@/src/lib/design";
import { errorMessage, fetchTicketTasks, updateTicket, type Ticket, type TicketTag, type TicketTaskSummary } from "@/src/services/ticket.service";
import { CLOSE_REASONS, ContactAvatar, formatPhone, personName, SENTIMENTS, TagChip } from "./helpers";

interface Props {
  ticket: Ticket;
  allTags: TicketTag[];
  /** Muda a cada tarefa criada para recarregar a lista. */
  tasksVersion: number;
  onClose: () => void;
  onCreateTask: () => void;
  onChanged: (ticket: Ticket) => void;
  onNotify: (message: string) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}

export function ContactPanel({ ticket, allTags, tasksVersion, onClose, onCreateTask, onChanged, onNotify }: Props) {
  const [tasks, setTasks] = useState<TicketTaskSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchTicketTasks(ticket.id)
      .then((t) => !cancelled && setTasks(t))
      .catch(() => !cancelled && setTasks([]));
    return () => {
      cancelled = true;
    };
  }, [ticket.id, tasksVersion]);

  async function patch(payload: Parameters<typeof updateTicket>[1]) {
    try {
      onChanged(await updateTicket(ticket.id, payload));
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }

  const activeTagIds = new Set(ticket.tags.map((t) => t.id));
  const toggleTag = (id: number) => {
    const next = new Set(activeTagIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void patch({ tag_ids: [...next] });
  };

  const reason = CLOSE_REASONS.find((r) => r.value === ticket.close_reason)?.label;
  const sentiment = SENTIMENTS.find((s) => s.value === ticket.customer_sentiment);

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l bg-surface md:w-[320px]">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-display text-sm font-semibold">Dados do contato</h3>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col items-center gap-2 px-4 py-5 text-center">
        <ContactAvatar contact={ticket.contact} className="h-20 w-20 text-2xl" />
        <p className="font-display text-base font-semibold">{ticket.contact.name}</p>
        {ticket.contact.number && !ticket.is_group && <p className="text-sm text-muted-foreground">{formatPhone(ticket.contact.number)}</p>}
      </div>

      <div className="space-y-5 px-4 pb-6">
        <section>
          <Row label="Conexão">{ticket.connection ? ticket.connection.label : "—"}</Row>
          <Row label="Fila">{ticket.queue ? ticket.queue.name : "Sem fila"}</Row>
          <Row label="Atendente">{ticket.user ? personName(ticket.user) : "—"}</Row>
          <Row label="Início">{new Date(ticket.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</Row>
          {ticket.status === "closed" && (
            <>
              <Row label="Motivo">{reason ?? ticket.close_reason ?? "—"}</Row>
              <Row label="Cliente">{sentiment ? `${sentiment.emoji} ${sentiment.label}` : "—"}</Row>
              {ticket.closing_observations && <p className="mt-1 rounded-lg bg-secondary p-2 text-xs text-muted-foreground">{ticket.closing_observations}</p>}
            </>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Etiquetas</h4>
          {allTags.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma etiqueta cadastrada. Crie em Atendimento → Configurações.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => (
                <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)} className={cn("rounded-full transition-opacity", !activeTagIds.has(tag.id) && "opacity-35 hover:opacity-70")}>
                  <TagChip tag={tag} className="px-2.5 py-1 text-[11px]" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Conversa paralela</p>
            <p className="text-xs text-muted-foreground">Não conta nas métricas de atendimento.</p>
          </div>
          <Switch checked={ticket.is_parallel} onCheckedChange={(v) => void patch({ is_parallel: v })} />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-subtle">Tarefas desta conversa</h4>
            <Button variant="ghost" size="sm" onClick={onCreateTask}>
              <ClipboardPlus className="mr-1 h-3.5 w-3.5" /> Nova
            </Button>
          </div>
          {tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma tarefa criada a partir desta conversa.</p>
          ) : (
            <ul className="space-y-1.5">
              {tasks.map((t) => (
                <li key={t.id}>
                  <Link to={`/task/${t.id}`} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_META[t.priority ?? "none"]?.color ?? "#71717A" }} />
                    <span className={cn("min-w-0 flex-1 truncate", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
