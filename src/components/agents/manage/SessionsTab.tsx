import { useCallback, useEffect, useState } from "react";
import { MessageSquare, RotateCcw, Trash2, UserRoundCheck } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  deleteSession,
  errorMessage,
  fetchSessionMessages,
  fetchSessions,
  resumeSession,
  saveChannelSettings,
  type ChannelSession,
} from "@/src/services/agent-channel.service";

interface Props {
  agentId: number;
  ttlSeconds: number;
  onTtlChange: (ttl: number) => void;
  onNotify: (msg: string) => void;
}

const fmtTtl = (s: ChannelSession) => (s.expired ? "expirada" : s.expires_at ? `expira ${new Date(s.expires_at).toLocaleString("pt-BR")}` : "sem expiração");

export function SessionsTab({ agentId, ttlSeconds, onTtlChange, onNotify }: Props) {
  const [sessions, setSessions] = useState<ChannelSession[]>([]);
  const [ttlMinutes, setTtlMinutes] = useState(String(Math.round(ttlSeconds / 60)));
  const [openId, setOpenId] = useState<number | null>(null);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);

  const load = useCallback(() => fetchSessions(agentId).then(setSessions).catch((e) => onNotify(errorMessage(e))), [agentId, onNotify]);
  useEffect(() => void load(), [load]);

  async function saveTtl() {
    const seconds = Math.max(0, Math.round(Number(ttlMinutes) || 0)) * 60;
    try {
      await saveChannelSettings(agentId, { session_ttl_seconds: seconds });
      onTtlChange(seconds);
      onNotify("Expiração salva (vale para as próximas mensagens).");
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }

  async function toggle(id: number) {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    setMessages(await fetchSessionMessages(agentId, id).catch(() => []));
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h3 className="font-display text-lg font-semibold">Configuração de expiração</h3>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label>Memória do contato (minutos)</Label>
            <Input type="number" min={0} className="w-40" value={ttlMinutes} onChange={(e) => setTtlMinutes(e.target.value)} />
          </div>
          <Button onClick={saveTtl}>Salvar</Button>
        </div>
        <p className="text-xs text-muted-foreground">0 = a memória nunca expira. Após o prazo sem mensagens, o agente começa a conversa do zero.</p>
      </Card>

      <Card className="space-y-2 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Sessões ativas (histórico)</h3>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
        {sessions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conversa ainda.</p>}
        {sessions.map((s) => (
          <div key={s.id} className="rounded-lg border">
            <div className="flex items-center gap-3 p-3">
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              <button className="min-w-0 flex-1 text-left" onClick={() => toggle(s.id)}>
                <p className="truncate text-sm font-medium">
                  {s.contact_name || s.phone} <span className="text-xs font-normal text-muted-foreground">+{s.phone}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.messages} mensagens · {fmtTtl(s)}
                  {s.handed_off && " · com atendente humano"}
                </p>
              </button>
              {s.handed_off && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    resumeSession(agentId, s.id)
                      .then(() => {
                        onNotify("Conversa devolvida ao agente.");
                        return load();
                      })
                      .catch((e) => onNotify(errorMessage(e)))
                  }
                >
                  <UserRoundCheck className="h-3.5 w-3.5" /> Reativar agente
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() =>
                  deleteSession(agentId, s.id)
                    .then(load)
                    .catch((e) => onNotify(errorMessage(e)))
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {openId === s.id && (
              <div className="max-h-72 space-y-1.5 overflow-y-auto border-t bg-muted/30 p-3 text-sm">
                {messages.length === 0 && <p className="text-muted-foreground">Sem mensagens guardadas.</p>}
                {messages.map((m, i) => (
                  <p key={i} className={m.role === "user" ? "" : "text-primary"}>
                    <span className="font-medium">{m.role === "user" ? "Cliente" : "Agente"}: </span>
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
