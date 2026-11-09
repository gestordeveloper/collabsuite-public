import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Switch } from "@/src/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import {
  errorMessage,
  fetchCalendarAccess,
  removeCalendarAccess,
  setCalendarAccess,
  type CalendarAccess,
  type GrantableUser,
} from "@/src/services/agent-channel.service";

interface Props {
  agentId: number;
  onNotify: (msg: string) => void;
}

export function CalendarTab({ agentId, onNotify }: Props) {
  const [access, setAccess] = useState<CalendarAccess[]>([]);
  const [grantable, setGrantable] = useState<GrantableUser[]>([]);
  const [pick, setPick] = useState<string>("");

  const load = useCallback(
    () =>
      fetchCalendarAccess(agentId)
        .then((r) => {
          setAccess(r.access);
          setGrantable(r.grantable);
        })
        .catch((e) => onNotify(errorMessage(e))),
    [agentId, onNotify]
  );
  useEffect(() => void load(), [load]);

  const run = (fn: () => Promise<CalendarAccess[]>) =>
    fn()
      .then(setAccess)
      .catch((e) => onNotify(errorMessage(e)));

  const available = grantable.filter((u) => !access.some((a) => a.user_id === u.id));

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-semibold">Agendas liberadas para este agente</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          O agente consulta horários livres, agenda, remarca e cancela compromissos na agenda do collabsuite dos usuários abaixo — tanto no WhatsApp quanto no chat. Serve para
          agendar uma reunião depois de uma prospecção ou para usá-lo como assistente pessoal.
        </p>

        {access.length === 0 && <p className="pt-2 text-sm text-muted-foreground">Nenhuma agenda liberada: o agente não tem ferramentas de agenda.</p>}
        {access.map((a) => (
          <div key={a.user_id} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <UserAvatar user={{ first_name: a.name, photo: a.photo }} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.availability.days.join(", ")} · {a.availability.start}–{a.availability.end} · blocos de {a.availability.slot_minutes} min
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => run(() => removeCalendarAccess(agentId, a.user_id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span>
                  Pode criar, remarcar e cancelar
                  <span className="block text-xs text-muted-foreground">Desligado = somente consulta</span>
                </span>
                <Switch checked={a.can_write} onCheckedChange={(v) => run(() => setCalendarAccess(agentId, a.user_id, { can_write: v }))} />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span>
                  Respeitar o expediente do usuário
                  <span className="block text-xs text-muted-foreground">Desligado = aceita qualquer horário sem conflito</span>
                </span>
                <Switch checked={a.enforce_availability} onCheckedChange={(v) => run(() => setCalendarAccess(agentId, a.user_id, { enforce_availability: v }))} />
              </label>
            </div>
          </div>
        ))}
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-display text-lg font-semibold">Liberar uma agenda</h3>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">Não há mais usuários que você possa liberar. Somente administradores liberam a agenda de outras pessoas.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[240px] flex-1">
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o usuário" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name} — {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="gap-2"
              disabled={!pick}
              onClick={() => {
                run(() => setCalendarAccess(agentId, Number(pick), {})).then(() => setPick(""));
                load();
              }}
            >
              <UserPlus className="h-4 w-4" /> Liberar
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Os horários seguem o que cada pessoa configurou em Configurações → Perfil → Agendamento. O agente nunca marca dois compromissos no mesmo horário e avisa o usuário por notificação a cada agendamento.
        </p>
      </Card>
    </div>
  );
}
