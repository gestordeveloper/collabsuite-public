import { useCallback, useEffect, useState } from "react";
import { BellRing, Clock, Loader2, Pencil, Plus, Users } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Skeleton } from "@/src/components/ui/skeleton";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import * as habitService from "@/src/services/habit.service";
import type { TeamBoardHabit, TeamBoardMember } from "@/src/services/habit.service";
import { formatReminderDays } from "@/src/lib/habit-templates";
import { hexA } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";

interface Props {
  /** Muda quando o pai criou/alterou algo e o quadro precisa recarregar. */
  reloadKey: number;
  onCreate: () => void;
  onEdit: (team: TeamBoardHabit) => void;
}

function lastDays(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (count - 1 - i));
    return habitService.toDayString(d);
  });
}

function rateTone(rate: number): string {
  if (rate >= 80) return "text-success";
  if (rate >= 50) return "text-warning";
  return "text-destructive";
}

/** Aba "Equipe": o gestor vê quem está cumprindo cada hábito/rotina atribuído e pode cobrar quem falta. */
export function TeamHabitsBoard({ reloadKey, onCreate, onEdit }: Props) {
  const [board, setBoard] = useState<TeamBoardHabit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nudging, setNudging] = useState<number | null>(null);
  const [notice, setNotice] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      setBoard(await habitService.fetchTeamBoard());
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar o quadro da equipe.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  async function nudge(team: TeamBoardHabit) {
    setNudging(team.id);
    try {
      const res = await habitService.nudgeTeamHabit(team.id);
      setNotice((n) => ({
        ...n,
        [team.id]: res.notified ? `Cobrança enviada para ${res.notified} ${res.notified === 1 ? "pessoa" : "pessoas"}.` : "Todos já cumpriram hoje. 🎉",
      }));
    } catch (err: any) {
      setNotice((n) => ({ ...n, [team.id]: err?.response?.data?.error || "Não foi possível cobrar agora." }));
    } finally {
      setNudging(null);
    }
  }

  if (!board && !error) {
    return (
      <Card className="space-y-3 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </Card>
    );
  }

  if (error) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>;
  }

  if (!board || board.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Users className="h-6 w-6" />
        </div>
        <div className="flex max-w-md flex-col gap-1.5">
          <h2 className="font-display text-xl font-semibold">Direcione a sua equipe com rotinas</h2>
          <p className="text-sm text-muted-foreground">
            Atribua uma rotina (daily, revisão de backlog, 1:1…) ou um hábito a pessoas dos seus projetos. Elas recebem o lembrete
            e você acompanha a aderência aqui — e pode cobrar quem ainda não cumpriu.
          </p>
        </div>
        <Button onClick={onCreate} className="gap-1.5">
          <Plus className="h-4 w-4" strokeWidth={2.4} /> Atribuir à equipe
        </Button>
      </Card>
    );
  }

  const days = lastDays(14);

  return (
    <div className="flex flex-col gap-4">
      {board.map((team) => {
        const allDone = team.summary.done_today === team.summary.total;
        return (
          <Card key={team.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: team.color }} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{team.name}</span>
                  {team.kind === "routine" && (
                    <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ color: team.color, backgroundColor: hexA(team.color, 0.14) }}>
                      Rotina
                    </span>
                  )}
                  {team.project && <span className="text-xs text-subtle">· {team.project.name}</span>}
                </div>
                <span className="flex flex-wrap items-center gap-x-3 text-xs text-subtle">
                  <span>{team.target_per_week >= 7 ? "Diário" : `${team.target_per_week}x por semana`}</span>
                  {team.reminder_time && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {team.reminder_time} · {formatReminderDays(team.reminder_days)}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-5 text-right">
                <div className="flex flex-col">
                  <span className="text-xs text-subtle">Hoje</span>
                  <span className="font-mono text-sm">
                    {team.summary.done_today}/{team.summary.total}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-subtle">Aderência 30d</span>
                  <span className={cn("font-mono text-sm", rateTone(team.summary.avg_rate_30))}>{team.summary.avg_rate_30}%</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" className="gap-1.5" disabled={allDone || nudging === team.id} onClick={() => nudge(team)}>
                  {nudging === team.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
                  Cobrar quem falta
                </Button>
                <button
                  type="button"
                  aria-label={`Editar ${team.name}`}
                  onClick={() => onEdit(team)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-input/60 hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {notice[team.id] && <p className="border-b bg-muted/40 px-5 py-2 text-xs text-muted-foreground">{notice[team.id]}</p>}

            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                {team.members.map((m) => (
                  <MemberRow key={m.habit_id} member={m} team={team} days={days} />
                ))}
              </div>
            </div>
          </Card>
        );
      })}

      <div>
        <Button variant="ghost" onClick={onCreate} className="gap-1.5">
          <Plus className="h-4 w-4" strokeWidth={2.4} /> Atribuir outro hábito ou rotina
        </Button>
      </div>
    </div>
  );
}

function MemberRow({ member, team, days }: { member: TeamBoardMember; team: TeamBoardHabit; days: string[] }) {
  const done = new Set(member.recent);
  return (
    <div className="grid items-center gap-3 border-b px-5 py-2.5 last:border-b-0" style={{ gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.4fr) 84px 64px 84px 88px" }}>
      <div className="flex min-w-0 items-center gap-2.5">
        <UserAvatar user={{ first_name: member.user.name, photo: member.user.photo }} className="h-7 w-7 text-[11px]" />
        <span className="truncate text-[13px] font-medium">{member.user.name}</span>
      </div>

      <div className="flex items-center gap-[3px]" aria-label="Últimos 14 dias">
        {days.map((d) => (
          <span
            key={d}
            title={d.split("-").reverse().join("/")}
            className="h-3.5 w-3.5 rounded-[4px]"
            style={{ backgroundColor: done.has(d) ? team.color : "hsl(var(--muted))" }}
          />
        ))}
      </div>

      <span className="text-right font-mono text-[13px] text-muted-foreground">
        {member.week_done}/{team.target_per_week} sem
      </span>
      <span className={cn("text-right font-mono text-[13px]", rateTone(member.rate_30))}>{member.rate_30}%</span>
      <span className="text-right font-mono text-[13px] text-warning">
        {member.streak_unit === "weeks" ? `${member.streak} sem` : `${member.streak}d`}
      </span>
      <span
        className={cn(
          "justify-self-end rounded-full px-2.5 py-0.5 text-[11px]",
          member.done_today ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
        )}
      >
        {member.done_today ? "Feito hoje" : "Pendente"}
      </span>
    </div>
  );
}
