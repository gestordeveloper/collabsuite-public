import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Switch } from "@/src/components/ui/switch";
import { Label } from "@/src/components/ui/label";
import type { NotificationChannelSettings, NotificationType } from "@/src/types";
import { fetchNotificationSettings, updateNotificationSettings } from "@/src/services/notification.service";
import { getPushPermissionState, subscribeToPush, unsubscribeFromPush, type PushPermissionState } from "@/src/lib/push";

const EVENT_LABELS: Record<NotificationType, string> = {
  ticket_created: "Novo chamado",
  meeting_reminder: "Lembrete de reunião",
  campaign_started: "Início de campanha",
  agent_run_finished: "Execução de agente/pipeline concluída",
  habit_reminder: "Lembretes e cobranças de hábitos e rotinas",
  weekly_summary: "Resumo semanal (segunda-feira)",
  instagram_post: "Publicação no Instagram (publicada ou com falha)",
};

export function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationChannelSettings | null>(null);
  const [pushState, setPushState] = useState<PushPermissionState>("default");
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    fetchNotificationSettings().then(setSettings);
    setPushState(getPushPermissionState());
  }, []);

  async function toggleChannel(channel: "push" | "email", type: NotificationType, value: boolean) {
    if (!settings) return;
    const next = { ...settings, [channel]: { ...settings[channel], [type]: value } };
    setSettings(next);
    await updateNotificationSettings({ [channel]: { [type]: value } });
  }

  async function handleEnablePush() {
    setPushLoading(true);
    try {
      const ok = await subscribeToPush();
      setPushState(getPushPermissionState());
      if (!ok && getPushPermissionState() === "denied") {
        alert("As notificações foram bloqueadas no navegador. Ative-as nas configurações do site para continuar.");
      }
    } finally {
      setPushLoading(false);
    }
  }

  async function handleDisablePush() {
    setPushLoading(true);
    try {
      await unsubscribeFromPush();
      setPushState(getPushPermissionState());
    } finally {
      setPushLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-5 w-5" /> Notificações push
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pushState === "unsupported" && (
            <p className="text-sm text-muted-foreground">
              Este navegador não suporta notificações push.
            </p>
          )}
          {pushState === "denied" && (
            <div className="flex items-center gap-3 rounded-xl border p-4 bg-muted/10">
              <BellOff className="h-5 w-5 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">
                As notificações estão bloqueadas para este site. Ative-as manualmente nas configurações do navegador.
              </p>
            </div>
          )}
          {pushState === "default" && (
            <div className="flex items-center justify-between rounded-xl border p-4 bg-muted/10">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-muted-foreground" />
                <div>
                  <Label className="text-sm font-semibold">Receber notificações no dispositivo</Label>
                  <p className="text-xs text-muted-foreground">
                    Avisos de novos chamados, reuniões e campanhas mesmo com o app fechado.
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={handleEnablePush} disabled={pushLoading}>
                Ativar
              </Button>
            </div>
          )}
          {pushState === "granted" && (
            <div className="flex items-center justify-between rounded-xl border p-4 bg-muted/10">
              <div className="flex items-center gap-3">
                <BellRing className="h-5 w-5 text-primary" />
                <div>
                  <Label className="text-sm font-semibold">Notificações push ativadas</Label>
                  <p className="text-xs text-muted-foreground">Você será avisado neste dispositivo.</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={handleDisablePush} disabled={pushLoading}>
                Desativar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferências por evento</CardTitle>
        </CardHeader>
        <CardContent>
          {!settings ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr,auto,auto] items-center gap-4 pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <span>Evento</span>
                <span className="flex items-center gap-1 justify-self-center"><Bell className="h-3.5 w-3.5" /> Push</span>
                <span className="flex items-center gap-1 justify-self-center"><Mail className="h-3.5 w-3.5" /> E-mail</span>
              </div>
              {(Object.keys(EVENT_LABELS) as NotificationType[]).map((type) => (
                <div key={type} className="grid grid-cols-[1fr,auto,auto] items-center gap-4 border-t py-3">
                  <span className="text-sm">{EVENT_LABELS[type]}</span>
                  <Switch
                    className="justify-self-center"
                    checked={settings.push[type]}
                    onCheckedChange={(value) => toggleChannel("push", type, value)}
                  />
                  <Switch
                    className="justify-self-center"
                    checked={settings.email[type]}
                    onCheckedChange={(value) => toggleChannel("email", type, value)}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
