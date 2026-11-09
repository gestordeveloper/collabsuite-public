import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Switch } from "@/src/components/ui/switch";
import {
  errorMessage,
  fetchRecordingIndexStatus,
  reindexRecordings,
  saveChannelSettings,
  type RecordingIndexStatus,
} from "@/src/services/agent-channel.service";

interface Props {
  agentId: number;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onNotify: (msg: string) => void;
}

/** Liga ao agente as ferramentas de busca/relatório nas gravações e mostra o estado do índice vetorial. */
export function RecordingsTab({ agentId, enabled, onEnabledChange, onNotify }: Props) {
  const [status, setStatus] = useState<RecordingIndexStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => fetchRecordingIndexStatus().then(setStatus).catch((e) => onNotify(errorMessage(e))), [onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  // Enquanto há gravações na fila de indexação, atualiza o andamento.
  const pending = status?.pending ?? 0;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const toggle = async (value: boolean) => {
    setBusy(true);
    try {
      await saveChannelSettings(agentId, { recordings_enabled: value });
      onEnabledChange(value);
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reindex = async (force: boolean) => {
    setBusy(true);
    try {
      const { queued } = await reindexRecordings(force);
      onNotify(queued ? `${queued} gravação(ões) na fila de indexação.` : "Nada a indexar: tudo já está no índice.");
      await load();
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const percent = status && status.total ? Math.round((status.indexed / status.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-semibold">Análise de gravações</h3>
            <p className="text-sm text-muted-foreground">
              Permite que este agente busque no que foi dito nas suas reuniões e monte relatórios por período, projeto ou tema, citando a gravação e o minuto. Funciona no chat do
              agente e no Telegram. Nunca é oferecido no atendimento por WhatsApp, onde quem conversa é o cliente.
            </p>
          </div>
          <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} />
        </div>
        <p className="text-xs text-muted-foreground">
          O agente só enxerga as gravações a que o usuário que conversa tem acesso (as que ele gravou e as dos projetos de que participa).
        </p>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-display text-lg font-semibold">Índice vetorial (Qdrant)</h3>
        {!status ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !status.qdrant_configured ? (
          <p className="text-sm text-muted-foreground">QDRANT_URL não está configurada neste servidor. Sem ela o agente usa só busca por palavra-chave nas transcrições.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Qdrant: <b>{status.qdrant_connected ? "conectado" : "sem conexão"}</b> · coleção <code>{status.collection}</code>
            </p>
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {status.indexed} de {status.total} gravações indexadas
                {status.pending > 0 ? ` · ${status.pending} pendente(s)` : ""}
                {status.failed > 0 ? ` · ${status.failed} com erro (geralmente falta a credencial OpenAI de embeddings)` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !status.qdrant_connected || status.pending === 0} className="gap-2" onClick={() => reindex(false)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Indexar pendentes
              </Button>
              <Button variant="outline" disabled={busy || !status.qdrant_connected || status.total === 0} onClick={() => reindex(true)}>
                Reindexar tudo
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Novas gravações entram no índice sozinhas assim que a transcrição termina. A indexação usa embeddings da OpenAI.</p>
          </>
        )}
      </Card>
    </div>
  );
}
