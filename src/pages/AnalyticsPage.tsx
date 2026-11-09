import { useState, useEffect } from "react";
import { PINK, SEMANTIC } from "@/src/lib/design";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell } from "recharts";
import { TrendingUp, CheckCircle, Clock, ListTodo, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Skeleton } from "@/src/components/ui/skeleton";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { useAuthStore } from "@/src/store/auth.store";
import { ProductivityReport } from "@/src/components/analytics/ProductivityReport";
import * as analyticsService from "@/src/services/analytics.service";
import type { Stats, BurndownPoint, RankingEntry } from "@/src/services/analytics.service";

export function AnalyticsPage() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [burndown, setBurndown] = useState<BurndownPoint[]>([]);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const isSuperAdmin = user?.role === "super_admin";

  useEffect(() => {
    async function load() {
      try {
        const [s, b, r] = await Promise.all([
          analyticsService.fetchStats(),
          analyticsService.fetchBurndown(),
          analyticsService.fetchRanking(),
        ]);
        setStats(s);
        setBurndown(b);
        setRanking(r);
      } catch (err) {
        console.error("Failed to load analytics:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  // Cores das barras em hex (o `fill` de SVG não aceita classes do Tailwind).
  const statusHex: Record<string, string> = { done: SEMANTIC.success, inprogress: SEMANTIC.warning, notdone: "#8A8A94" };
  const priorityHex: Record<string, string> = { high: SEMANTIC.danger, medium: SEMANTIC.warning, low: SEMANTIC.info };

  const statusLabels: Record<string, string> = {
    done: "Concluídas",
    inprogress: "Em Andamento",
    notdone: "Pendentes",
  };

  const priorityLabels: Record<string, string> = {
    high: "Alta",
    medium: "Média",
    low: "Baixa",
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            {isSuperAdmin
              ? "Visão geral de toda a equipe"
              : "Seu desempenho individual"}
          </p>
        </div>
        {isSuperAdmin && (
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" /> Admin
          </Badge>
        )}
      </div>

      <ProductivityReport />

      <div className="border-t pt-6">
        <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Visão geral</h2>
      </div>

      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="rounded-full bg-primary/10 p-3">
                <ListTodo className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalTasks}</p>
                <p className="text-xs text-muted-foreground">Total de Tarefas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="rounded-full bg-emerald-500/10 p-3">
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.tasksByStatus.done}</p>
                <p className="text-xs text-muted-foreground">Concluídas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="rounded-full bg-amber-500/10 p-3">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.tasksByStatus.inprogress}</p>
                <p className="text-xs text-muted-foreground">Em Andamento</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="rounded-full bg-indigo-500/10 p-3">
                <TrendingUp className="h-5 w-5 text-indigo-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalProjects}</p>
                <p className="text-xs text-muted-foreground">Projetos</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" /> Burndown (Últimos 14 Dias)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={burndown}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => {
                      const d = new Date(v + "T00:00:00");
                      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                    }}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    labelFormatter={(v) => new Date(v + "T00:00:00").toLocaleDateString("pt-BR")}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="remaining" stroke={PINK} strokeWidth={2} name="Restantes" dot={false} />
                  <Line type="monotone" dataKey="completed" stroke={SEMANTIC.success} strokeWidth={2} name="Concluídas" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-500" /> Tarefas por Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={Object.entries(stats?.tasksByStatus || {}).map(([k, v]) => ({ name: statusLabels[k] || k, value: v }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" name="Tarefas" radius={[4, 4, 0, 0]}>
                    {Object.entries(stats?.tasksByStatus || {}).map(([k, v], i) => (
                      <Cell key={i} fill={statusHex[k] || "#8A8A94"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" /> Prioridades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={Object.entries(stats?.tasksByPriority || {}).map(([k, v]) => ({ name: priorityLabels[k] || k, value: v }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" name="Tarefas" radius={[4, 4, 0, 0]}>
                    {Object.entries(stats?.tasksByPriority || {}).map(([k, v], i) => (
                      <Cell key={i} fill={priorityHex[k] || "#8A8A94"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" /> Ranking de Tarefas Concluídas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ranking.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma tarefa concluída ainda.</p>
            ) : (
              <div className="space-y-3">
                {ranking.map((entry, idx) => (
                  <div key={entry.userId} className="flex items-center gap-3 rounded-lg border p-3">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${idx === 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                      {idx + 1}
                    </span>
                    <UserAvatar user={entry.user} className="h-8 w-8" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {entry.user?.first_name} {entry.user?.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">{entry.completedTasks} tarefas concluídas</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{entry.storyPoints} pts</p>
                      <p>{entry.hoursWorked}h</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
