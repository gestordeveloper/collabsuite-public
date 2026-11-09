import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, CheckCircle, Hourglass, PlayCircle, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Skeleton } from "@/src/components/ui/skeleton";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { PINK, SEMANTIC } from "@/src/lib/design";
import { useTaskStore } from "@/src/store/task.store";
import * as analyticsService from "@/src/services/analytics.service";
import type { Productivity } from "@/src/services/analytics.service";

const PERIODS = [7, 30, 90];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const selectClass =
  "h-[38px] cursor-pointer rounded-md border border-input bg-surface px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary/25";

function formatDuration(hours: number | null) {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1).replace(".", ",")} h`;
  return `${(hours / 24).toFixed(1).replace(".", ",")} d`;
}

function personName(user: { first_name: string; last_name: string | null } | null, fallbackId?: number | null) {
  if (!user) return fallbackId ? `Usuário ${fallbackId}` : "Sem responsável";
  return `${user.first_name} ${user.last_name ?? ""}`.trim();
}

export function ProductivityReport() {
  const { projects } = useTaskStore();
  const [days, setDays] = useState(30);
  const [userId, setUserId] = useState<number | "all">("all");
  const [projectId, setProjectId] = useState<number | "all">("all");
  const [data, setData] = useState<Productivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    analyticsService
      .fetchProductivity({
        days,
        user_id: userId === "all" ? undefined : userId,
        project_id: projectId === "all" ? undefined : projectId,
      })
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days, userId, projectId]);

  const kpis = data
    ? [
        { label: "Iniciadas", value: data.totals.started, icon: PlayCircle, tone: "text-amber-500 bg-amber-500/10" },
        { label: "Concluídas", value: data.totals.completed, icon: CheckCircle, tone: "text-emerald-500 bg-emerald-500/10" },
        { label: "Em andamento agora", value: data.totals.inProgressNow, icon: Activity, tone: "text-primary bg-primary/10" },
        { label: "Tempo médio até concluir", value: formatDuration(data.totals.avgCycleHours), icon: Timer, tone: "text-indigo-500 bg-indigo-500/10" },
      ]
    : [];

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Produtividade</h2>
          <p className="text-sm text-muted-foreground">
            Quem moveu cada tarefa e quando, a partir do histórico de etapas dos funis que você pode ver.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Período">
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                Últimos {d} dias
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value === "all" ? "all" : Number(e.target.value))}
            aria-label="Projeto"
          >
            <option value="all">Todos os projetos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={userId}
            onChange={(e) => setUserId(e.target.value === "all" ? "all" : Number(e.target.value))}
            aria-label="Pessoa"
          >
            <option value="all">Todas as pessoas</option>
            {(data?.people ?? []).map((p) => (
              <option key={p.userId} value={p.userId}>
                {personName(p.user, p.userId)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          Não foi possível carregar o relatório de produtividade.
        </p>
      ) : loading && !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data ? (
        <div className={loading ? "space-y-6 opacity-60 transition-opacity" : "space-y-6"}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <Card key={k.label}>
                <CardContent className="flex items-center gap-4 pt-6">
                  <div className={`rounded-full p-3 ${k.tone}`}>
                    <k.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-mono text-2xl font-bold">{k.value}</p>
                    <p className="text-xs text-muted-foreground">{k.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Iniciadas x concluídas por dia</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.daily}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => new Date(v + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip labelFormatter={(v) => new Date(v + "T00:00:00").toLocaleDateString("pt-BR")} />
                      <Legend />
                      <Line type="monotone" dataKey="started" name="Iniciadas" stroke={SEMANTIC.warning} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="completed" name="Concluídas" stroke={SEMANTIC.success} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quando as tarefas são movimentadas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.byWeekday.map((d) => ({ name: WEEKDAYS[d.weekday], count: d.count }))}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis hide allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" name="Movimentações" fill={PINK} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.byHour.map((d) => ({ name: `${String(d.hour).padStart(2, "0")}h`, count: d.count }))}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={2} />
                      <YAxis hide allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" name="Movimentações" fill={PINK} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Por pessoa</CardTitle>
              </CardHeader>
              <CardContent>
                {data.people.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma movimentação no período.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 font-medium">Pessoa</th>
                          <th className="pb-2 text-right font-medium">Iniciadas</th>
                          <th className="pb-2 text-right font-medium">Concluídas</th>
                          <th className="pb-2 text-right font-medium">Tempo médio</th>
                          <th className="pb-2 text-right font-medium">Em andamento</th>
                          <th className="pb-2 text-right font-medium">Paradas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.people.map((p) => (
                          <tr key={p.userId} className="border-b last:border-0">
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <UserAvatar user={p.user} className="h-7 w-7" />
                                <span className="truncate">{personName(p.user, p.userId)}</span>
                              </div>
                            </td>
                            <td className="py-2.5 text-right font-mono">{p.started}</td>
                            <td className="py-2.5 text-right font-mono">{p.completed}</td>
                            <td className="py-2.5 text-right font-mono">{formatDuration(p.avgCycleHours)}</td>
                            <td className="py-2.5 text-right font-mono">{p.inProgressNow}</td>
                            <td className={`py-2.5 text-right font-mono ${p.stalled ? "text-amber-500" : ""}`}>{p.stalled}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Paradas há mais de {data.stalledAfterDays} dias
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.stalled.length === 0 ? (
                  <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <Hourglass className="h-4 w-4" /> Nada parado em andamento.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.stalled.map((t) => (
                      <li key={t.id}>
                        <Link to={`/task/${t.id}`} className="flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:bg-subtle">
                          <UserAvatar user={t.user} className="h-7 w-7" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{t.title || "Sem título"}</p>
                            <p className="text-xs text-muted-foreground">{t.user ? t.user.first_name : "Sem responsável"}</p>
                          </div>
                          <span className="font-mono text-xs text-amber-500">{t.daysStopped}d</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </section>
  );
}
