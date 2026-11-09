import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent } from "@/src/components/ui/card";
import { Switch } from "@/src/components/ui/switch";
import { Textarea } from "@/src/components/ui/textarea";
import { Label } from "@/src/components/ui/label";
import { fetchConnections, type WhatsAppConnection } from "@/src/services/whatsappConnection.service";
import { errorMessage, saveConnectionTicketSettings } from "@/src/services/ticket.service";
import { formatPhone } from "../helpers";

type TicketConnection = WhatsAppConnection & { receive_tickets?: boolean; greeting_message?: string | null; farewell_message?: string | null };

export function ConnectionsSettingsTab({ onNotify }: { onNotify: (message: string) => void }) {
  const [connections, setConnections] = useState<TicketConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setConnections((await fetchConnections()) as TicketConnection[]);
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Escolha quais números de WhatsApp alimentam o atendimento. Com o atendimento ligado, tudo que chegar nessa conexão vira ticket para a equipe —
        e o celular pode ficar conectado só aqui. Você só vê as conexões pareadas pela sua conta; para conectar um novo número, use a página{" "}
        <Link to="/whatsapp" className="font-medium text-primary underline-offset-2 hover:underline">WhatsApp</Link>.
      </p>
      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : connections.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">Você ainda não tem conexões de WhatsApp.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {connections.map((c) => (
            <ConnectionCard key={c.id} connection={c} onSaved={load} onNotify={onNotify} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionCard({ connection, onSaved, onNotify }: { connection: TicketConnection; onSaved: () => Promise<void>; onNotify: (m: string) => void }) {
  const [receive, setReceive] = useState(!!connection.receive_tickets);
  const [greeting, setGreeting] = useState(connection.greeting_message ?? "");
  const [farewell, setFarewell] = useState(connection.farewell_message ?? "");
  const [busy, setBusy] = useState(false);

  const dirty = receive !== !!connection.receive_tickets || greeting !== (connection.greeting_message ?? "") || farewell !== (connection.farewell_message ?? "");

  async function save() {
    setBusy(true);
    try {
      await saveConnectionTicketSettings(connection.id, { receive_tickets: receive, greeting_message: greeting.trim() || null, farewell_message: farewell.trim() || null });
      await onSaved();
      onNotify("Ajustes de atendimento salvos.");
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display font-semibold">{connection.label}</p>
            <p className="text-xs text-muted-foreground">{connection.phone_number ? formatPhone(connection.phone_number) : "Número ainda não pareado"}</p>
          </div>
          <Badge variant={connection.status === "connected" ? "success" : "secondary"}>{connection.status === "connected" ? "Conectado" : "Desconectado"}</Badge>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Receber como atendimento</p>
            <p className="text-xs text-muted-foreground">Mensagens recebidas viram tickets na tela de Atendimento.</p>
          </div>
          <Switch checked={receive} onCheckedChange={setReceive} />
        </label>

        {receive && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Saudação (quando não há fluxo nem fila)</Label>
              <Textarea rows={2} value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Olá, {{name}}! Já vamos te atender." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Despedida (enviada ao resolver o atendimento)</Label>
              <Textarea rows={2} value={farewell} onChange={(e) => setFarewell(e.target.value)} placeholder="Obrigado pelo contato! Qualquer coisa, é só chamar." />
            </div>
          </>
        )}

        <div className="flex items-center justify-between">
          {connection.status !== "connected" && receive ? <span className="text-xs text-warning">Conecte o número para começar a receber.</span> : <span />}
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
