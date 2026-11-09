import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Switch } from "@/src/components/ui/switch";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent } from "@/src/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { ACCENT_COLORS } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";
import { deleteQueue, errorMessage, fetchQueues, saveQueue, type TeamMember, type TicketQueue } from "@/src/services/ticket.service";
import { personName } from "../helpers";

interface Props {
  team: TeamMember[];
  onNotify: (message: string) => void;
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ACCENT_COLORS.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} className={cn("h-7 w-7 rounded-full border-2 transition-transform", value === c ? "scale-110 border-foreground" : "border-transparent hover:scale-105")} style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

export function QueuesTab({ team, onNotify }: Props) {
  const [queues, setQueues] = useState<TicketQueue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TicketQueue | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setQueues(await fetchQueues());
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(q: TicketQueue) {
    if (!window.confirm(`Excluir a fila "${q.name}"? Os tickets dela ficam sem fila.`)) return;
    try {
      await deleteQueue(q.id);
      void load();
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-muted-foreground">Filas dividem o atendimento por área (suporte, marketing, comercial…). Cada fila tem seus atendentes: eles veem as conversas pendentes da fila e assumem.</p>
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova fila
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : queues.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">Nenhuma fila ainda. Sem filas, todas as conversas ficam abertas para a equipe toda.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {queues.map((q) => (
            <Card key={q.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: q.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-semibold">{q.name}</p>
                    <p className="text-xs text-muted-foreground">{q._count?.tickets ?? 0} ticket(s) · {q.users.length} atendente(s)</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setEditing(q)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(q)} aria-label="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {q.auto_distribution && <Badge variant="success">Rodízio automático</Badge>}
                  {q.users.slice(0, 5).map((u) => <Badge key={u.id} variant="secondary">{u.first_name}</Badge>)}
                  {q.users.length > 5 && <Badge variant="outline">+{q.users.length - 5}</Badge>}
                  {q.users.length === 0 && <span className="flex items-center gap-1 text-xs text-warning"><Users className="h-3 w-3" /> Sem atendentes</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && <QueueDialog queue={editing === "new" ? null : editing} team={team} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

function QueueDialog({ queue, team, onClose, onSaved }: { queue: TicketQueue | null; team: TeamMember[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(queue?.name ?? "");
  const [color, setColor] = useState<string>(queue?.color ?? ACCENT_COLORS[2]);
  const [greeting, setGreeting] = useState(queue?.greeting_message ?? "");
  const [auto, setAuto] = useState(queue?.auto_distribution ?? false);
  const [userIds, setUserIds] = useState<Set<number>>(new Set(queue?.user_ids ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setError("Dê um nome para a fila.");
    setBusy(true);
    setError(null);
    try {
      await saveQueue(queue?.id ?? null, { name: name.trim(), color, greeting_message: greeting.trim() || null, auto_distribution: auto, user_ids: [...userIds] });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{queue ? "Editar fila" : "Nova fila"}</DialogTitle>
          <DialogDescription>Defina quem atende e como as conversas chegam nesta fila.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Suporte, Marketing" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Cor</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="space-y-1.5">
            <Label>Mensagem de boas-vindas da fila</Label>
            <Textarea rows={3} value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Enviada ao cliente quando a conversa entra nesta fila. Use {{name}} para o nome." />
          </div>
          <div className="space-y-1.5">
            <Label>Atendentes da fila</Label>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2">
              {team.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    className="accent-[hsl(var(--primary))]"
                    checked={userIds.has(m.id)}
                    onChange={() => setUserIds((prev) => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; })}
                  />
                  {personName(m)}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Distribuição automática</p>
              <p className="text-xs text-muted-foreground">Cada nova conversa vai direto para o próximo atendente, em rodízio.</p>
            </div>
            <Switch checked={auto} onCheckedChange={setAuto} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
