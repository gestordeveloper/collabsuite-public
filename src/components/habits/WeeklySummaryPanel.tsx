import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, CheckCircle2, Sparkles, Users } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { Skeleton } from "@/src/components/ui/skeleton";
import * as habitService from "@/src/services/habit.service";
import type { WeeklySummary } from "@/src/services/habit.service";
import { hexA } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MAX_WEEKS_BACK = 12;

function sundayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function fmtDay(day: string): string {
  const d = habitService.fromDayString(day);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
}

/** Aba "Resumo semanal": hábitos, tarefas, foco e (para gestores) a aderência da equipe. */
export function WeeklySummaryPanel() {
  const [offset, setOffset] = useState(0);
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = sundayOf(new Date());
  start.setDate(start.getDate() + offset * 7);
  const startDay = habitService.toDayString(start);

  useEffect(() => {
    setSummary(null);
    setError(null);
    habitService
      .fetchWeeklySummary(startDay)
      .then(setSummary)
      .catch((err) => setError(err?.response?.data?.error || "Não foi possível carregar o resumo."));
  }, [startDay]);

  const delta = summary && summary.habits.previous_pct !== null ? summary.habits.overall_pct - summary.habits.previous_pct : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 text-[13px] text-subtle">
        <button
          type="button"
          aria-label="Semana anterior"
          disabled={offset <= -MAX_WEEKS_BACK}
          onClick={() => setOffset((o) => Math.max(o - 1, -MAX_WEEKS_BACK))}
          className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[170px] text-center">
          {offset === 0 ? "Esta semana" : offset === -1 ? "Semana passada" : "Semana"} · {fmtDay(startDay)} –{" "}
          {summary ? fmtDay(summary.week_end) : "…"}
        </span>
        <button
          type="button"
          aria-label="Próxima semana"
          disabled={offset >= 0}
          onClick={() => setOffset((o) => Math.min(o + 1, 0))}
          className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {summary?.in_progress && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px]">em andamento</span>}
      </div>

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {!summary && !error && (
        <Card className="space-y-3 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      )}

      {summary && (
        <>
          <Card className="flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-display text-[15px] font-semibold">Em resumo</h3>
            </div>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {summary.highlights.map((h, i) => (
                <li key={i}>• {h}</li>
              ))}
            </ul>
          </Card>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Hábitos cumpridos" value={`${summary.habits.overall_pct}%`} hint={delta === null ? undefined : `${delta >= 0 ? "+" : ""}${delta} pts vs. anterior`} tone={delta === null ? undefined : delta >= 0 ? "good" : "bad"} />
            <Stat label="Tarefas concluídas" value={String(summary.tasks.completed)} />
            <Stat label="Atrasadas" value={String(summary.tasks.overdue)} tone={summary.tasks.overdue > 0 ? "bad" : "good"} hint={`${summary.tasks.due_next_7_days} vencem nos próximos 7 dias`} />
            <Stat
              label="Foco do dia"
              value={summary.focus.items_total ? `${summary.focus.items_done}/${summary.focus.items_total}` : "—"}
              hint={summary.focus.days_planned ? `${summary.focus.days_planned} ${summary.focus.days_planned === 1 ? "dia planejado" : "dias planejados"}` : "nenhum dia planejado"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="flex flex-col gap-3 p-5">
              <h3 className="font-display text-[15px] font-semibold">Hábitos e rotinas</h3>
              {summary.habits.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum hábito ativo nesta semana.</p>
              ) : (
                summary.habits.items.map((h) => (
                  <div key={h.id} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate">{h.name}</span>
                      <span className="font-mono text-muted-foreground">
                        {h.done}/{h.target}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: hexA(h.color, 0.18) }}>
                      <div className="h-full rounded-full" style={{ width: `${h.pct}%`, backgroundColor: h.color }} />
                    </div>
                  </div>
                ))
              )}
            </Card>

            <Card className="flex flex-col gap-3 p-5">
              <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold">
                <AlertTriangle className="h-4 w-4 text-warning" /> Atrasadas que dependem de você
              </h3>
              {summary.tasks.overdue_list.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" /> Nada atrasado. Bom trabalho!
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {summary.tasks.overdue_list.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 text-[13px]">
                      <Link to={`/task/${t.id}`} className="truncate hover:text-primary hover:underline">
                        {t.title}
                      </Link>
                      <span className="shrink-0 font-mono text-xs text-destructive">{fmtDay(t.due_at.slice(0, 10))}</span>
                    </li>
                  ))}
                  {summary.tasks.overdue > summary.tasks.overdue_list.length && (
                    <li className="text-xs text-subtle">e mais {summary.tasks.overdue - summary.tasks.overdue_list.length}…</li>
                  )}
                </ul>
              )}
              {summary.tasks.completed_titles.length > 0 && (
                <div className="mt-2 flex flex-col gap-1 border-t pt-3">
                  <span className="label-caps">Entregas da semana</span>
                  {summary.tasks.completed_titles.map((t) => (
                    <Link key={t.id} to={`/task/${t.id}`} className="truncate text-[13px] text-muted-foreground hover:text-foreground hover:underline">
                      ✓ {t.title}
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {summary.team.length > 0 && (
            <Card className="flex flex-col gap-3 p-5">
              <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold">
                <Users className="h-4 w-4 text-primary" /> Aderência da equipe
              </h3>
              {summary.team.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="font-medium">{t.name}</span>
                  <span className="flex items-center gap-3">
                    {t.behind.length > 0 && <span className="text-xs text-muted-foreground">abaixo de 50%: {t.behind.join(", ")}</span>}
                    <span className={cn("font-mono", t.avg_pct >= 80 ? "text-success" : t.avg_pct >= 50 ? "text-warning" : "text-destructive")}>{t.avg_pct}%</span>
                  </span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-subtle">{label}</span>
      <span className="font-display text-[28px] font-semibold leading-tight">{value}</span>
      {hint && <span className={cn("text-[11px]", tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-subtle")}>{hint}</span>}
    </Card>
  );
}
