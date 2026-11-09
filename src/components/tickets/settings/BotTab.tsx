import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent } from "@/src/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { cn } from "@/src/lib/utils";
import {
  deleteBotFlow,
  errorMessage,
  fetchAttendanceConnections,
  fetchBotFlows,
  saveBotFlow,
  type AttendanceConnection,
  type BotFlowSummary,
  type BotFlowType,
  type TeamMember,
  type TicketQueue,
  type TicketTag,
} from "@/src/services/ticket.service";
import { FlowEditor } from "../bot/FlowEditor";

interface Props {
  queues: TicketQueue[];
  team: TeamMember[];
  tags: TicketTag[];
  onNotify: (message: string) => void;
}

const TYPE_INFO: Record<BotFlowType, { label: string; hint: string }> = {
  entry: { label: "Entrada", hint: "Recebe quem acabou de chegar numa conexão e encaminha para a fila certa." },
  queue: { label: "Fila", hint: "Roda quando a conversa já está numa fila e ainda não tem atendente." },
  automation: { label: "Automação", hint: "Roda em segundo plano em todas as conversas (ex.: follow-up após X minutos)." },
};

export function BotTab({ queues, team, tags, onNotify }: Props) {
  const [flows, setFlows] = useState<BotFlowSummary[]>([]);
  const [connections, setConnections] = useState<AttendanceConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, c] = await Promise.all([fetchBotFlows(), fetchAttendanceConnections()]);
      setFlows(f);
      setConnections(c);
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(flow: BotFlowSummary, value: boolean) {
    setFlows((prev) => prev.map((f) => (f.id === flow.id ? { ...f, is_active: value } : f)));
    try {
      await saveBotFlow(flow.id, { is_active: value });
    } catch (err) {
      onNotify(errorMessage(err));
      void load();
    }
  }

  async function remove(flow: BotFlowSummary) {
    if (!window.confirm(`Excluir o fluxo "${flow.name}"? As conversas em andamento nele voltam para a equipe.`)) return;
    try {
      await deleteBotFlow(flow.id);
      void load();
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-muted-foreground">O bot atende primeiro: faz perguntas, mostra o menu de áreas e encaminha para a fila ou pessoa certa. Monte fluxos visuais, teste no rascunho e publique.</p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Novo fluxo
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : flows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center">
          <Bot className="mx-auto mb-2 h-8 w-8 text-subtle" />
          <p className="text-sm text-muted-foreground">Nenhum fluxo criado. Sem fluxo de entrada, o cliente recebe o menu numérico das filas (ou a saudação da conexão).</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {flows.map((f) => (
            <Card key={f.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-semibold">{f.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {TYPE_INFO[f.type].label}
                      {f.type === "queue" && f.queue ? ` · ${f.queue.name}` : ""}
                      {f.type === "entry" ? ` · ${f.connection_ids.length} conexão(ões)` : ""}
                    </p>
                  </div>
                  <Switch checked={f.is_active} onCheckedChange={(v) => void toggleActive(f, v)} aria-label="Ativo" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {f.published_at ? <Badge variant="success">Publicado</Badge> : <Badge variant="warning">Não publicado</Badge>}
                  {f.has_unpublished_changes && f.published_at && <Badge variant="outline">Alterações pendentes</Badge>}
                  {!f.is_active && <Badge variant="secondary">Pausado</Badge>}
                  {f.type === "entry" && f.connection_ids.length === 0 && <Badge variant="warning">Sem conexão ligada</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setEditingId(f.id)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar fluxo</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(f)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <NewFlowDialog
          queues={queues}
          connections={connections}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void load(); setEditingId(id); }}
        />
      )}
      {editingId && <FlowEditor flowId={editingId} queues={queues} team={team} tags={tags} onClose={() => { setEditingId(null); void load(); }} onNotify={onNotify} />}
    </div>
  );
}

function NewFlowDialog({ queues, connections, onClose, onCreated }: { queues: TicketQueue[]; connections: AttendanceConnection[]; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<BotFlowType>("entry");
  const [queueId, setQueueId] = useState("");
  const [connectionIds, setConnectionIds] = useState<Set<number>>(new Set(connections.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setError("Dê um nome ao fluxo.");
    if (type === "queue" && !queueId) return setError("Escolha a fila deste fluxo.");
    setBusy(true);
    setError(null);
    try {
      const created = await saveBotFlow(null, {
        name: name.trim(),
        type,
        queue_id: type === "queue" ? Number(queueId) : null,
        connection_ids: type === "entry" ? [...connectionIds] : [],
      });
      onCreated(created.id);
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
          <DialogTitle>Novo fluxo do bot</DialogTitle>
          <DialogDescription>Depois de criar, você monta os passos no editor visual.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Recepção, Triagem do suporte" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <div className="grid gap-2">
              {(Object.keys(TYPE_INFO) as BotFlowType[]).map((t) => (
                <button key={t} type="button" onClick={() => setType(t)} className={cn("rounded-lg border p-3 text-left transition-colors", type === t ? "border-primary bg-primary/10" : "hover:bg-accent")}>
                  <p className="text-sm font-semibold">{TYPE_INFO[t].label}</p>
                  <p className="text-xs text-muted-foreground">{TYPE_INFO[t].hint}</p>
                </button>
              ))}
            </div>
          </div>
          {type === "queue" && (
            <div className="space-y-1.5">
              <Label>Fila</Label>
              <Select value={queueId} onValueChange={setQueueId}>
                <SelectTrigger><SelectValue placeholder="Escolha a fila" /></SelectTrigger>
                <SelectContent>
                  {queues.map((q) => <SelectItem key={q.id} value={String(q.id)}>{q.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "entry" && (
            <div className="space-y-1.5">
              <Label>Conexões que usam este fluxo</Label>
              {connections.length === 0 ? (
                <p className="text-xs text-muted-foreground">Habilite o atendimento em uma conexão na aba Conexões e depois ligue o fluxo a ela.</p>
              ) : (
                connections.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-[hsl(var(--primary))]"
                      checked={connectionIds.has(c.id)}
                      onChange={() => setConnectionIds((prev) => { const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })}
                    />
                    {c.label}
                  </label>
                ))
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar e editar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
