import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { fetchConnections, type WhatsAppConnection } from "@/src/services/whatsappConnection.service";
import { fetchLists, type WhatsAppContactList } from "@/src/services/whatsappContact.service";
import { createCampaign, scheduleCampaign, type CampaignPayload } from "@/src/services/whatsappCampaign.service";
import { fromBrazilInputValue } from "@/src/lib/brazilTime";

const DEFAULT_MIN_DELAY = 3;
const DEFAULT_MAX_DELAY = 8;
const DEFAULT_DAILY_LIMIT = 200;

interface CampaignComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CampaignComposeDialog({ open, onOpenChange, onCreated }: CampaignComposeDialogProps) {
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [lists, setLists] = useState<WhatsAppContactList[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [name, setName] = useState("");
  const [connectionId, setConnectionId] = useState<string>("");
  const [recipientMode, setRecipientMode] = useState<"list" | "adhoc">("list");
  const [listId, setListId] = useState<string>("");
  const [adhocName, setAdhocName] = useState("");
  const [adhocPhone, setAdhocPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [minDelay, setMinDelay] = useState(DEFAULT_MIN_DELAY);
  const [maxDelay, setMaxDelay] = useState(DEFAULT_MAX_DELAY);
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_DAILY_LIMIT);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingOptions(true);
    Promise.all([fetchConnections(), fetchLists()])
      .then(([conns, lsts]) => {
        setConnections(conns);
        setLists(lsts);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoadingOptions(false));
  }, [open]);

  useEffect(() => {
    if (!open) {
      // Reset the form once the dialog fully closes so reopening starts fresh.
      setName("");
      setConnectionId("");
      setRecipientMode("list");
      setListId("");
      setAdhocName("");
      setAdhocPhone("");
      setMessage("");
      setSendMode("now");
      setScheduledAt("");
      setMinDelay(DEFAULT_MIN_DELAY);
      setMaxDelay(DEFAULT_MAX_DELAY);
      setDailyLimit(DEFAULT_DAILY_LIMIT);
    }
  }, [open]);

  async function handleSubmit() {
    if (!name.trim() || !connectionId || !message.trim()) {
      alert("Preencha nome, conexão e mensagem.");
      return;
    }
    if (recipientMode === "list" && !listId) {
      alert("Selecione uma lista de contatos.");
      return;
    }
    if (recipientMode === "adhoc" && !adhocPhone.trim()) {
      alert("Informe o telefone do destinatário.");
      return;
    }
    if (maxDelay < minDelay) {
      alert("O intervalo máximo deve ser maior ou igual ao mínimo.");
      return;
    }

    const payload: CampaignPayload = {
      connection_id: parseInt(connectionId),
      name: name.trim(),
      message: message.trim(),
      min_delay_seconds: minDelay,
      max_delay_seconds: maxDelay,
      daily_limit: dailyLimit || null,
      scheduled_at: sendMode === "later" && scheduledAt ? fromBrazilInputValue(scheduledAt) : null,
    };
    if (recipientMode === "list") {
      payload.list_id = parseInt(listId);
    } else {
      payload.recipients = [{ name: adhocName.trim() || null, phone: adhocPhone.trim() }];
    }

    setSubmitting(true);
    try {
      const created = await createCampaign(payload);
      // Compose always leads straight into scheduling — a draft with no further action would
      // otherwise sit invisible to the worker until a separate "start" click.
      await scheduleCampaign(created.id, payload.scheduled_at || null);
      onCreated();
      onOpenChange(false);
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao criar campanha.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>Envie uma mensagem para um contato ou faça um disparo em massa para uma lista.</DialogDescription>
        </DialogHeader>

        {loadingOptions ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : connections.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Você precisa de ao menos uma conexão de WhatsApp conectada antes de criar uma campanha. Vá até a aba "Conexões".
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Nome da campanha</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Follow-up de leads" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Conexão</Label>
                <Select value={connectionId} onValueChange={setConnectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.label} {c.status === "connected" ? "" : "(desconectado)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Destinatários</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={recipientMode === "list" ? "default" : "outline"} onClick={() => setRecipientMode("list")}>
                  Lista (disparo em massa)
                </Button>
                <Button type="button" size="sm" variant={recipientMode === "adhoc" ? "default" : "outline"} onClick={() => setRecipientMode("adhoc")}>
                  Contato avulso
                </Button>
              </div>
            </div>

            {recipientMode === "list" ? (
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a lista" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name} ({l._count?.contacts ?? 0} contatos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input placeholder="Nome (opcional)" value={adhocName} onChange={(e) => setAdhocName(e.target.value)} />
                <Input placeholder="Telefone (com DDI/DDD)" value={adhocPhone} onChange={(e) => setAdhocPhone(e.target.value)} />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label>Mensagem</Label>
              <Textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Olá {{nome}}, tudo bem?"
              />
              <p className="text-xs text-muted-foreground">Use <code>{"{{nome}}"}</code> para inserir o nome do destinatário automaticamente.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Envio</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={sendMode === "now" ? "default" : "outline"} onClick={() => setSendMode("now")}>
                  Enviar assim que possível
                </Button>
                <Button type="button" size="sm" variant={sendMode === "later" ? "default" : "outline"} onClick={() => setSendMode("later")}>
                  Agendar data/hora
                </Button>
              </div>
              {sendMode === "later" && (
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="mt-1" />
              )}
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium mb-2">Limite de envio (conservador por padrão)</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Intervalo mín. (s)</Label>
                  <Input type="number" min={1} value={minDelay} onChange={(e) => setMinDelay(Number(e.target.value) || 1)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Intervalo máx. (s)</Label>
                  <Input type="number" min={1} value={maxDelay} onChange={(e) => setMaxDelay(Number(e.target.value) || 1)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Limite diário</Label>
                  <Input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value) || 0)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Baileys usa o protocolo não oficial do WhatsApp Web — mantenha valores conservadores para reduzir o risco de bloqueio do número.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || loadingOptions || connections.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Criar campanha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
