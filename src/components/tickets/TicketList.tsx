import { useCallback, useEffect, useRef, useState } from "react";
import { Filter, Loader2, MessageSquarePlus, Search, Users, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Switch } from "@/src/components/ui/switch";
import { cn } from "@/src/lib/utils";
import { useTicketBus } from "@/src/lib/ticketBus";
import { fetchTicketCounts, fetchTickets, type Ticket, type TicketFilters, type TicketQueue, type TicketStatus, type TicketTag, type TeamMember } from "@/src/services/ticket.service";
import { ContactAvatar, personName, QueueChip, shortTime, TagChip } from "./helpers";

type Kind = "all" | "contacts" | "groups" | "parallel";
const ALL = "all";

interface Props {
  activeId: number | null;
  meId: number;
  isAdmin: boolean;
  queues: TicketQueue[];
  tags: TicketTag[];
  team: TeamMember[];
  multiConnection: boolean;
  tab: TicketStatus;
  onTabChange: (tab: TicketStatus) => void;
  onSelect: (ticket: Ticket) => void;
  onNewConversation: () => void;
  /** Muda quando algo fora da lista altera tickets (assumir, resolver…) para forçar o recarregamento. */
  reloadKey: number;
}

const TABS: { value: TicketStatus; label: string }[] = [
  { value: "open", label: "Atendendo" },
  { value: "pending", label: "Aguardando" },
  { value: "closed", label: "Resolvidos" },
];

export function TicketList({ activeId, meId, isAdmin, queues, tags, team, multiConnection, tab, onTabChange, onSelect, onNewConversation, reloadKey }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [queueId, setQueueId] = useState(ALL);
  const [tagId, setTagId] = useState(ALL);
  const [userId, setUserId] = useState(ALL);
  const [kind, setKind] = useState<Kind>("all");
  const [showAll, setShowAll] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState({ pending: 0, open: 0, unread: 0 });
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useCallback(
    (p: number): TicketFilters => ({
      status: tab,
      search: debounced || undefined,
      queueIds: queueId !== ALL ? [Number(queueId)] : undefined,
      tagIds: tagId !== ALL ? [Number(tagId)] : undefined,
      assignedUserId: isAdmin && userId !== ALL ? Number(userId) : undefined,
      isGroup: kind === "groups" ? true : kind === "contacts" ? false : undefined,
      isParallel: kind === "parallel" ? true : kind === "all" ? undefined : false,
      showAll: isAdmin && showAll,
      withUnread: onlyUnread || undefined,
      page: p,
    }),
    [tab, debounced, queueId, tagId, userId, kind, showAll, onlyUnread, isAdmin]
  );

  const reload = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const [list, c] = await Promise.all([fetchTickets(filters(1)), fetchTicketCounts(isAdmin && showAll)]);
        if (id !== requestId.current) return;
        setTickets(list.tickets);
        setHasMore(list.hasMore);
        setPage(1);
        setCounts(c);
      } catch (err) {
        console.error(err);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [filters, isAdmin, showAll]
  );

  useEffect(() => {
    void reload();
  }, [reload, reloadKey]);

  // Eventos em tempo real: recarrega a primeira página (agrupa rajadas de eventos num único pedido).
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void reload(true), 400);
  }, [reload]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  useTicketBus("ticket", schedule);
  useTicketBus("reconnect", schedule);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const list = await fetchTickets(filters(next));
      setTickets((prev) => [...prev, ...list.tickets.filter((t) => !prev.some((p) => p.id === t.id))]);
      setHasMore(list.hasMore);
      setPage(next);
    } finally {
      setLoadingMore(false);
    }
  }

  const activeFilters = [queueId, tagId, userId].filter((v) => v !== ALL).length + (kind !== "all" ? 1 : 0) + (showAll ? 1 : 0) + (onlyUnread ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="space-y-3 border-b p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome, número ou mensagem" className="pl-9 pr-8" />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-2.5 text-subtle hover:text-foreground" aria-label="Limpar busca">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button variant={activeFilters ? "default" : "outline"} size="icon" onClick={() => setShowFilters((v) => !v)} title="Filtros" aria-label="Filtros" className="relative shrink-0">
            <Filter className="h-4 w-4" />
            {activeFilters > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-bold text-background">{activeFilters}</span>}
          </Button>
          <Button size="icon" onClick={onNewConversation} title="Nova conversa" aria-label="Nova conversa" className="shrink-0">
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>

        {showFilters && (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <div className="grid grid-cols-2 gap-2">
              <Select value={queueId} onValueChange={setQueueId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Fila" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas as filas</SelectItem>
                  {queues.map((q) => <SelectItem key={q.id} value={String(q.id)}>{q.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={tagId} onValueChange={setTagId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Etiqueta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas as etiquetas</SelectItem>
                  {tags.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([["all", "Tudo"], ["contacts", "Contatos"], ["groups", "Grupos"], ["parallel", "Paralelas"]] as [Kind, string][]).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setKind(value)} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", kind === value ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")}>
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center justify-between text-xs">
              <span>Só não lidas minhas</span>
              <Switch checked={onlyUnread} onCheckedChange={setOnlyUnread} />
            </label>
            {isAdmin && (
              <>
                <label className="flex items-center justify-between text-xs">
                  <span>Ver todos os atendimentos</span>
                  <Switch checked={showAll} onCheckedChange={setShowAll} />
                </label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Atendente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Qualquer atendente</SelectItem>
                    {team.map((m) => <SelectItem key={m.id} value={String(m.id)}>{personName(m)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1">
          {TABS.map((t) => {
            const count = t.value === "open" ? counts.open : t.value === "pending" ? counts.pending : 0;
            const active = tab === t.value;
            return (
              <button key={t.value} type="button" onClick={() => onTabChange(t.value)} className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors", active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {t.label}
                {count > 0 && (
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] leading-none", t.value === "pending" ? "bg-primary text-primary-foreground" : "bg-border text-foreground")}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : tickets.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            {debounced || activeFilters ? "Nada encontrado com esses filtros." : tab === "pending" ? "Nenhuma conversa aguardando atendimento." : tab === "open" ? "Você não tem atendimentos em andamento." : "Nenhum atendimento resolvido ainda."}
          </p>
        ) : (
          <ul>
            {tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} active={t.id === activeId} meId={meId} showConnection={multiConnection} onClick={() => onSelect(t)} />
            ))}
            {hasMore && (
              <li className="p-3">
                <Button variant="ghost" size="sm" className="w-full" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Carregar mais
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function TicketRow({ ticket, active, meId, showConnection, onClick }: { ticket: Ticket; active: boolean; meId: number; showConnection: boolean; onClick: () => void }) {
  const unread = ticket.unread_messages > 0;
  return (
    <li>
      <button type="button" onClick={onClick} className={cn("flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors", active ? "bg-accent" : "hover:bg-accent/60")}>
        <ContactAvatar contact={ticket.contact} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{ticket.contact.name}</p>
            <span className={cn("shrink-0 text-[11px]", unread ? "font-semibold text-primary" : "text-subtle")}>{shortTime(ticket.last_message_at ?? ticket.updated_at)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>{ticket.last_message || "Sem mensagens"}</p>
            {unread && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{ticket.unread_messages}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <QueueChip queue={ticket.queue} />
            {ticket.is_group && <Users className="h-3 w-3 text-subtle" />}
            {ticket.user && ticket.user.id !== meId && <span className="text-[10px] text-subtle">· {ticket.user.first_name}</span>}
            {showConnection && ticket.connection && <span className="text-[10px] text-subtle">· {ticket.connection.label}</span>}
            {ticket.tags.slice(0, 2).map((tag) => <TagChip key={tag.id} tag={tag} />)}
          </div>
        </div>
      </button>
    </li>
  );
}
