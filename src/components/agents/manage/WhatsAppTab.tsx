import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plug, PlugZap } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import {
  connectConnection,
  disconnectConnection,
  fetchConnection,
  fetchConnections,
  type WhatsAppConnection,
} from "@/src/services/whatsappConnection.service";
import { errorMessage, fetchChannelSettings, saveChannelSettings, type ChannelSettings, type ChannelSettingsPatch } from "@/src/services/agent-channel.service";

interface Props {
  agentId: number;
  onNotify: (msg: string) => void;
  onChanged: () => void;
}

const STATUS_LABEL: Record<string, string> = { connected: "Conectado", pairing: "Aguardando leitura do QR", disconnected: "Desconectado", error: "Erro" };

export function WhatsAppTab({ agentId, onNotify, onChanged }: Props) {
  const [settings, setSettings] = useState<ChannelSettings | null>(null);
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [live, setLive] = useState<WhatsAppConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [buffer, setBuffer] = useState("5");

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetchChannelSettings(agentId), fetchConnections()]);
      setSettings(s);
      setConnections(c);
      setBuffer(String(s.buffer_delay_seconds));
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }, [agentId, onNotify]);
  useEffect(() => void load(), [load]);

  const connectionId = settings?.channel_connection_id ?? null;

  // Acompanha o status (e o QR) da conexão escolhida.
  useEffect(() => {
    if (!connectionId) return setLive(null);
    let stop = false;
    const tick = () => fetchConnection(connectionId).then((c) => !stop && setLive(c)).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [connectionId]);

  async function save(patch: ChannelSettingsPatch) {
    try {
      setSettings(await saveChannelSettings(agentId, patch));
      onChanged();
    } catch (err) {
      onNotify(errorMessage(err));
      load();
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      if (connectionId) setLive(await fetchConnection(connectionId));
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h3 className="font-display text-lg font-semibold">Conexão WhatsApp</h3>
        <div className="space-y-1.5">
          <Label>Número que este agente atende</Label>
          <Select value={connectionId ? String(connectionId) : "none"} onValueChange={(v) => save({ channel_connection_id: v === "none" ? null : Number(v), ...(v === "none" ? { channel_enabled: false } : {}) })}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha uma conexão" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhuma</SelectItem>
              {connections.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.label} {c.phone_number ? `(+${c.phone_number})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {connections.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma conexão cadastrada. Crie uma em <Link to="/whatsapp" className="underline">WhatsApp</Link>.
            </p>
          )}
        </div>

        {live && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${live.status === "connected" ? "text-emerald-500" : "text-muted-foreground"}`}>
                <span className={`h-2 w-2 rounded-full ${live.status === "connected" ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                {STATUS_LABEL[live.status] ?? live.status}
                {live.phone_number && ` · +${live.phone_number}`}
              </span>
              <div className="ml-auto flex gap-2">
                {live.status !== "connected" && (
                  <Button size="sm" disabled={busy} className="gap-1.5" onClick={() => act(() => connectConnection(live.id))}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Conectar / QR Code
                  </Button>
                )}
                {live.status === "connected" && (
                  <Button size="sm" variant="outline" disabled={busy} className="gap-1.5" onClick={() => act(() => disconnectConnection(live.id))}>
                    <PlugZap className="h-3.5 w-3.5" /> Desconectar
                  </Button>
                )}
              </div>
            </div>
            {live.qr_data_url && live.status !== "connected" && (
              <div className="flex flex-col items-center gap-2">
                <img src={live.qr_data_url} alt="QR Code do WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
                <p className="text-xs text-muted-foreground">WhatsApp → Aparelhos conectados → Conectar um aparelho.</p>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-display text-lg font-semibold">Atendimento automático</h3>
        <Row title="Agente responde neste número" hint="Uma conexão só pode ter um agente ativo. Enquanto ativo, as conversas não viram tickets até a transferência para humano.">
          <Switch checked={settings.channel_enabled} onCheckedChange={(v) => save({ channel_enabled: v })} disabled={!connectionId} />
        </Row>
        <Row title="Respostas humanizadas" hint='Divide a resposta em mensagens curtas, com "digitando…" e atraso proporcional.'>
          <Switch checked={settings.humanize_replies} onCheckedChange={(v) => save({ humanize_replies: v })} />
        </Row>
        <Row title="Transferir para atendente humano" hint="O agente pode abrir um ticket no Atendimento e deixar de responder aquela conversa.">
          <Switch checked={settings.handoff_enabled} onCheckedChange={(v) => save({ handoff_enabled: v })} />
        </Row>
        {settings.handoff_enabled && settings.connection && !settings.connection.receive_tickets && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Para transferir, a conexão precisa receber tickets. Ative "Receber tickets" em{" "}
            <Link to="/atendimento/configuracoes" className="underline">
              Atendimento → Configurações → Conexões
            </Link>
            . Sem isso a transferência fica desativada.
          </p>
        )}
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label>Espera para juntar mensagens (segundos)</Label>
            <Input type="number" min={0} max={60} className="w-40" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => save({ buffer_delay_seconds: Number(buffer) || 0 })}>
            Salvar
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
