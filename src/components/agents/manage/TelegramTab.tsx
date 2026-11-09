import { useCallback, useEffect, useState } from "react";
import { Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import {
  createTelegramPairing,
  errorMessage,
  fetchTelegram,
  removeTelegram,
  removeTelegramLink,
  saveTelegram,
  sendTelegramBriefing,
  type TelegramPairing,
  type TelegramSettings,
} from "@/src/services/agent-channel.service";

interface Props {
  agentId: number;
  onNotify: (msg: string) => void;
}

/** Assistente pessoal no Telegram: bot do dono, pareamento por código e briefing diário. */
export function TelegramTab({ agentId, onNotify }: Props) {
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [token, setToken] = useState("");
  const [time, setTime] = useState("08:00");
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await fetchTelegram(agentId);
      setSettings(s);
      setTime(s.briefing_time);
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }, [agentId, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  // Enquanto o código está ativo, confere se o pareamento já aconteceu.
  const linkCount = settings?.links.length ?? 0;
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(async () => {
      const s = await fetchTelegram(agentId).catch(() => null);
      if (s && s.links.length !== linkCount) {
        setSettings(s);
        setPairing(null);
        onNotify("Telegram vinculado com sucesso.");
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [pairing, agentId, linkCount, onNotify]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) onNotify(ok);
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const patch = (p: Parameters<typeof saveTelegram>[1], ok?: string) =>
    run(async () => {
      setSettings(await saveTelegram(agentId, p));
    }, ok);

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="font-display text-lg font-semibold">Assistente pessoal no Telegram</h3>
          <p className="text-sm text-muted-foreground">
            Converse com este agente pelo Telegram (texto, áudio ou foto). Ele age como você: agenda, tarefas, hábitos, lembretes e notificações do Collab Suite. Só os chats que você
            parear conseguem falar com ele.
          </p>
        </div>

        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            No Telegram, abra o <b>@BotFather</b>, envie <code>/newbot</code> e copie o token.
          </li>
          <li>Cole o token abaixo e ative o bot.</li>
          <li>
            Gere um código de pareamento e envie <code>/start CÓDIGO</code> ao seu bot.
          </li>
        </ol>

        <div className="space-y-2">
          <Label htmlFor="tg-token">Token do bot</Label>
          <div className="flex gap-2">
            <Input
              id="tg-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings.configured ? "•••••••• (já configurado — cole outro para trocar)" : "123456:ABC-DEF..."}
            />
            <Button disabled={busy || !token.trim()} onClick={() => patch({ bot_token: token.trim() }, "Bot validado e salvo.").then(() => setToken(""))}>
              Salvar
            </Button>
          </div>
          {settings.bot_username && (
            <p className="text-xs text-muted-foreground">
              Bot: <b>{settings.bot_name}</b> (@{settings.bot_username})
            </p>
          )}
        </div>

        {settings.configured && (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Bot ativo</p>
              <p className="text-xs text-muted-foreground">{settings.enabled ? (settings.running ? "Recebendo mensagens." : "Iniciando…") : "Desligado: não responde."}</p>
            </div>
            <Switch checked={settings.enabled} disabled={busy} onCheckedChange={(v) => patch({ enabled: v })} />
          </div>
        )}
      </Card>

      {settings.configured && (
        <>
          <Card className="space-y-4 p-5">
            <h3 className="font-display text-lg font-semibold">Chats vinculados</h3>
            {settings.links.length === 0 && <p className="text-sm text-muted-foreground">Nenhum chat vinculado ainda.</p>}
            {settings.links.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span>
                  {l.display_name || "Sem nome"} <span className="text-xs text-muted-foreground">· id {l.chat_id}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Desvincular"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await removeTelegramLink(agentId, l.id);
                      await load();
                    }, "Chat desvinculado.")
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {pairing ? (
              <div className="space-y-2 rounded-lg border border-dashed p-4 text-sm">
                <p>
                  Envie ao bot: <code className="rounded bg-muted px-2 py-1 text-base font-semibold">/start {pairing.code}</code>
                </p>
                {pairing.deep_link && (
                  <p>
                    ou abra{" "}
                    <a className="text-primary underline" href={pairing.deep_link} target="_blank" rel="noreferrer">
                      {pairing.deep_link}
                    </a>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Vale por 10 minutos e funciona uma única vez. Aguardando o vínculo…</p>
              </div>
            ) : (
              <Button variant="outline" disabled={busy || !settings.enabled} onClick={() => run(async () => setPairing(await createTelegramPairing(agentId)))}>
                Gerar código de pareamento
              </Button>
            )}
            {!settings.enabled && <p className="text-xs text-muted-foreground">Ative o bot para poder parear.</p>}
          </Card>

          <Card className="space-y-4 p-5">
            <h3 className="font-display text-lg font-semibold">Briefing diário</h3>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">Todo dia o assistente manda sua agenda, tarefas, lembretes e hábitos pendentes.</p>
              <Switch checked={settings.briefing_enabled} disabled={busy} onCheckedChange={(v) => patch({ briefing_enabled: v })} />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="tg-time">Horário (Brasília)</Label>
                <Input id="tg-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
              </div>
              <Button variant="outline" disabled={busy || time === settings.briefing_time} onClick={() => patch({ briefing_time: time }, "Horário salvo.")}>
                Salvar horário
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                disabled={busy || settings.links.length === 0}
                onClick={() =>
                  run(async () => {
                    const r = await sendTelegramBriefing(agentId);
                    onNotify(`Briefing enviado para ${r.sent} chat(s).`);
                  })
                }
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar agora
              </Button>
            </div>
          </Card>

          <Button
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={() =>
              confirm("Remover o bot e todos os vínculos?") &&
              run(async () => {
                await removeTelegram(agentId);
                await load();
              }, "Bot removido.")
            }
          >
            Remover bot do Telegram
          </Button>
        </>
      )}
    </div>
  );
}
