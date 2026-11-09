import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Inbox, Clock, Trash2, Folder, CheckCircle, AlertTriangle, Users, 
  BarChart3, TrendingUp, Calendar, FileText, ChevronRight, Activity, Rocket
} from "lucide-react";
import { useTaskStore } from "@/src/store/task.store";
import { useDashboard } from "@/src/context/dashboard.context";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { Progress } from "@/src/components/ui/progress";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend 
} from "recharts";
import type { Task, Project } from "@/src/types";

export function ProjectDashboardPage() {
  const { projects, tasks, isLoading, setSelectedFunnelId } = useDashboard();
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState<number | "all">("all");
  const [filterMode, setFilterMode] = useState<"all" | "sprint">("all");

  const handleProjectChange = (projectId: number | "all") => {
    setSelectedProjectId(projectId);
    setFilterMode("all"); // Reset to Visão Geral when changing projects
  };

  // Helper functions
  const getProjectStats = (project: Project) => {
    const funnelIds = project.funnels.map((f) => f.id);
    const projTasks = tasks.filter((t) => t.funnel_id != null && funnelIds.includes(t.funnel_id));
    const completed = projTasks.filter((t) => t.status === "done").length;
    const total = projTasks.length;
    const overdue = projTasks.filter((t) => t.due_at && new Date(t.due_at) < new Date() && t.status !== "done").length;
    const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

    let health: "success" | "warning" | "destructive" = "success";
    let healthText = "Em dia";
    if (overdue > 3) {
      health = "destructive";
      healthText = "Crítico";
    } else if (overdue > 0) {
      health = "warning";
      healthText = "Atenção";
    }

    return { total, completed, overdue, progress, health, healthText };
  };

  // Computations for all projects view
  const allProjectsSummary = useMemo(() => {
    return projects.map((p) => {
      const stats = getProjectStats(p);
      return {
        id: p.id,
        name: p.name,
        color: p.color || "#EC1889",
        ...stats,
        membersCount: p.projectUsers?.length || 0,
      };
    });
  }, [projects, tasks]);

  const globalOverviewStats = useMemo(() => {
    const total = projects.length;
    const completed = allProjectsSummary.filter(p => p.progress === 100).length;
    const attention = allProjectsSummary.filter(p => p.healthText === "Atenção").length;
    const critical = allProjectsSummary.filter(p => p.healthText === "Crítico").length;
    const tasksCount = tasks.filter(t => t.funnel_id != null && t.funnel_id !== 0).length;
    const completedTasksCount = tasks.filter(t => t.funnel_id != null && t.funnel_id !== 0 && t.status === "done").length;

    return { total, completed, attention, critical, tasksCount, completedTasksCount };
  }, [projects, tasks, allProjectsSummary]);

  // Computations for specific project view
  const activeProject = useMemo(() => {
    if (selectedProjectId === "all") return null;
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [selectedProjectId, projects]);

  const activeProjectFunnelIds = useMemo(() => activeProject?.funnels.map((f) => f.id) || [], [activeProject]);
  const activeDefaultFunnel = useMemo(() => activeProject?.funnels.find((f) => f.is_default) || activeProject?.funnels[0] || null, [activeProject]);

  const projectTasks = useMemo(() => {
    if (selectedProjectId === "all") return [];
    return tasks.filter((t) => t.funnel_id != null && activeProjectFunnelIds.includes(t.funnel_id));
  }, [selectedProjectId, tasks, activeProjectFunnelIds]);

  const projectTasksFiltered = useMemo(() => {
    if (selectedProjectId === "all") return [];
    if (filterMode === "sprint") {
      return projectTasks.filter((t) => t.is_sprint === true);
    }
    return projectTasks;
  }, [selectedProjectId, projectTasks, filterMode]);

  const activeProjectProgress = useMemo(() => {
    if (projectTasksFiltered.length === 0) return 0;
    const completed = projectTasksFiltered.filter((t) => t.status === "done").length;
    return Math.round((completed / projectTasksFiltered.length) * 100);
  }, [projectTasksFiltered]);

  const detailedStats = useMemo(() => {
    if (selectedProjectId === "all") return null;
    const total = projectTasksFiltered.length;
    const completed = projectTasksFiltered.filter((t) => t.status === "done").length;
    const inProgress = projectTasksFiltered.filter((t) => t.status === "inprogress").length;
    const notDone = projectTasksFiltered.filter((t) => t.status === "notdone").length;
    const overdue = projectTasksFiltered.filter((t) => t.due_at && new Date(t.due_at) < new Date() && t.status !== "done").length;
    
    // Story points
    const totalSP = projectTasksFiltered.reduce((acc, t) => acc + (t.story_points || 0), 0);
    const completedSP = projectTasksFiltered.filter(t => t.status === "done").reduce((acc, t) => acc + (t.story_points || 0), 0);

    // Critical/overdue tasks
    const now = new Date();
    const criticalList = projectTasksFiltered.filter((t) => {
      if (t.status === "done") return false;
      if (!t.due_at) return false;
      const due = new Date(t.due_at);
      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
      return due < now || diffHours <= 48;
    }).sort((a, b) => {
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });

    return { total, completed, inProgress, notDone, overdue, totalSP, completedSP, criticalList };
  }, [selectedProjectId, projectTasksFiltered]);

  // Chart data: Tasks by Stage (funil principal do projeto)
  const stageChartData = useMemo(() => {
    if (!activeDefaultFunnel) return [];
    return activeDefaultFunnel.stages.map((s) => {
      const count = projectTasksFiltered.filter((t) => t.stage_id === s.id).length;
      return {
        name: s.name,
        Quantidade: count,
      };
    });
  }, [activeDefaultFunnel, projectTasksFiltered]);

  // Chart data: Team workload
  const teamWorkloadData = useMemo(() => {
    if (!activeProject) return [];

    const membersMap = new Map<number, { name: string; userObj: any; notdone: number; inprogress: number; done: number }>();

    // Initialize list of members
    activeProject.projectUsers?.forEach((pu) => {
      if (pu.user) {
        membersMap.set(pu.user.id, {
          name: `${pu.user.first_name} ${pu.user.last_name || ""}`.trim(),
          userObj: pu.user,
          notdone: 0,
          inprogress: 0,
          done: 0,
        });
      }
    });

    // Populate task counts per user
    projectTasksFiltered.forEach((t) => {
      const uId = t.user_id;
      if (uId && membersMap.has(uId)) {
        const item = membersMap.get(uId)!;
        if (t.status === "done") item.done++;
        else if (t.status === "inprogress") item.inprogress++;
        else item.notdone++;
      }
    });

    return Array.from(membersMap.values()).map((v) => ({
      name: v.name,
      "A Fazer": v.notdone,
      "Em Progresso": v.inprogress,
      "Concluídas": v.done,
    }));
  }, [activeProject, projectTasksFiltered]);

  const handleGoToKanban = (projectId: number) => {
    const proj = projects.find((p) => p.id === projectId);
    const funnel = proj?.funnels.find((f) => f.is_default) || proj?.funnels[0];
    if (funnel) setSelectedFunnelId(funnel.id);
    navigate("/kanban");
  };

  return (
    <div className="flex-1 bg-background p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8 overflow-y-auto">
      {/* Cabeçalho com seletor de projeto */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Painel de projetos</h1>
          <p className="text-sm text-muted-foreground">
            Progresso, gargalos e distribuição de trabalho em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-[13px] text-muted-foreground">Projeto</span>
          <select
            value={selectedProjectId}
            onChange={(e) => {
              const val = e.target.value;
              handleProjectChange(val === "all" ? "all" : Number(val));
            }}
            className="h-[38px] min-w-[220px] cursor-pointer rounded-md border border-input bg-surface px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary/25"
          >
            <option value="all">Todos os projetos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs para Sprint se um projeto estiver selecionado */}
      {selectedProjectId !== "all" && !isLoading && (
        <div className="flex w-fit items-center gap-1 rounded-[9px] border bg-card p-[3px]">
          <button
            onClick={() => setFilterMode("all")}
            className={`px-3.5 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
              filterMode === "all"
                ? "bg-input text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            Visão Geral do Projeto
          </button>
          <button
            onClick={() => setFilterMode("sprint")}
            className={`px-3.5 py-1.5 text-[13px] font-medium rounded-md flex items-center gap-1.5 transition-colors ${
              filterMode === "sprint"
                ? "bg-input text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Rocket className="h-3.5 w-3.5" />
            <span>Sprint Ativa</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold border ${
              filterMode === "sprint"
                ? "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground"
                : "border-muted-foreground/30 bg-muted text-muted-foreground"
            }`}>
              {projectTasks.filter(t => t.is_sprint === true).length}
            </span>
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          Carregando indicadores...
        </div>
      ) : selectedProjectId === "all" ? (
        // VISÃO GERAL (TODOS OS PROJETOS)
        <div className="space-y-8">
          {/* Indicadores Globais */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-muted-foreground">Total de Projetos</span>
                  <h3 className="font-display text-[26px] font-semibold tracking-[-0.02em]">{globalOverviewStats.total}</h3>
                </div>
                <div className="p-2.5 bg-primary/10 rounded-lg text-primary">
                  <Folder className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-muted-foreground">Concluídos (100%)</span>
                  <h3 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-success">{globalOverviewStats.completed}</h3>
                </div>
                <div className="p-2.5 bg-success/15 rounded-lg text-success">
                  <CheckCircle className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-muted-foreground">Saúde: Atenção</span>
                  <h3 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-warning">{globalOverviewStats.attention}</h3>
                </div>
                <div className="p-2.5 bg-warning/15 rounded-lg text-warning">
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-muted-foreground">Saúde: Crítico</span>
                  <h3 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-destructive">{globalOverviewStats.critical}</h3>
                </div>
                <div className="p-2.5 bg-destructive/10 rounded-lg text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela de Projetos */}
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base font-semibold">Tabela de Saúde e Progresso</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-y text-xs font-medium text-subtle">
                  <tr>
                    <th className="px-6 py-3.5">Projeto</th>
                    <th className="px-6 py-3.5">Saúde</th>
                    <th className="px-6 py-3.5">Progresso</th>
                    <th className="px-6 py-3.5">Tarefas</th>
                    <th className="px-6 py-3.5">Atrasadas</th>
                    <th className="px-6 py-3.5">Membros</th>
                    <th className="px-6 py-3.5 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {allProjectsSummary.map((proj) => (
                    <tr key={proj.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: proj.color }} />
                          <span className="max-w-[200px] truncate font-medium text-foreground" title={proj.name}>
                            {proj.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={proj.health}>{proj.healthText}</Badge>
                      </td>
                      <td className="px-6 py-4 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <Progress value={proj.progress} className="h-2 flex-1" />
                          <span className="text-xs font-bold text-muted-foreground w-8">{proj.progress}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground font-medium">
                        {proj.completed}/{proj.total}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`font-bold ${proj.overdue > 0 ? "text-destructive" : "text-muted-foreground/60"}`}>
                          {proj.overdue}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground font-semibold">
                        {proj.membersCount}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleGoToKanban(proj.id)}
                          className="h-8 text-xs gap-1"
                        >
                          <span>Quadro</span>
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {allProjectsSummary.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-muted-foreground">
                        Nenhum projeto cadastrado no sistema.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : filterMode === "sprint" && detailedStats?.total === 0 ? (
        // MENSAGEM SE A SPRINT TIVER ZERO TAREFAS
        <div className="text-center py-16 border border-dashed border-border rounded-xl bg-card flex flex-col items-center justify-center gap-3">
          <div className="p-4 bg-warning/15 rounded-full text-warning">
            <AlertTriangle className="h-10 w-10" />
          </div>
          <h3 className="font-bold text-sm text-foreground">Nenhuma tarefa vinculada à Sprint</h3>
          <p className="text-xs text-muted-foreground max-w-md px-4 leading-relaxed">
            Não há tarefas marcadas como parte da Sprint ativa neste projeto. Para adicionar tarefas à Sprint, abra as configurações ou o card de detalhes da tarefa no quadro Kanban e ative a opção "Sprint".
          </p>
          <Button onClick={() => handleGoToKanban(Number(selectedProjectId))} className="h-8 text-xs gap-1.5 mt-2">
            <span>Ir para o Quadro Kanban</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        // VISÃO DETALHADA DO PROJETO SELECIONADO
        <div className="space-y-6 sm:space-y-8">
          {/* KPIs de Projeto */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card Progresso */}
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="relative h-14 w-14 shrink-0 flex items-center justify-center">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="26" fill="none" strokeWidth="4" className="stroke-muted" />
                    <circle 
                      cx="32" 
                      cy="32" 
                      r="26" 
                      fill="none" 
                      strokeWidth="4" 
                      stroke={activeProject?.color || "#EC1889"} 
                      strokeDasharray={2 * Math.PI * 26} 
                      strokeDashoffset={2 * Math.PI * 26 - (activeProjectProgress / 100) * (2 * Math.PI * 26)} 
                      strokeLinecap="round" 
                    />
                  </svg>
                  <span className="absolute text-xs font-bold text-foreground">
                    {activeProjectProgress}%
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {filterMode === "sprint" ? "Progresso da Sprint" : "Progresso Geral"}
                  </span>
                  <h4 className="text-sm font-semibold truncate text-muted-foreground">
                    {detailedStats?.completed}/{detailedStats?.total} tarefas
                  </h4>
                </div>
              </CardContent>
            </Card>

            {/* Card Story Points */}
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 bg-info/15 rounded-lg text-info shrink-0">
                  <TrendingUp className="h-6 w-6" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <span className="text-xs font-medium text-muted-foreground">
                    {filterMode === "sprint" ? "Story Points da Sprint" : "Story Points"}
                  </span>
                  <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-info truncate">
                    {detailedStats?.completedSP} / {detailedStats?.totalSP} <span className="text-[10px] font-normal text-muted-foreground">pts</span>
                  </h3>
                </div>
              </CardContent>
            </Card>

            {/* Card Overdue */}
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`p-3 rounded-lg shrink-0 ${
                  detailedStats && detailedStats.overdue > 0 
                    ? "bg-destructive/10 text-destructive" 
                    : "bg-muted text-muted-foreground/60"
                }`}>
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <span className="text-xs font-medium text-muted-foreground">
                    {filterMode === "sprint" ? "Atrasadas na Sprint" : "Tarefas Atrasadas"}
                  </span>
                  <h3 className={`font-display text-[22px] font-semibold tracking-[-0.02em] ${
                    detailedStats && detailedStats.overdue > 0 ? "text-destructive" : "text-foreground"
                  }`}>
                    {detailedStats?.overdue}
                  </h3>
                </div>
              </CardContent>
            </Card>

            {/* Card Membros */}
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 bg-info/15 rounded-lg text-info shrink-0">
                  <Users className="h-6 w-6" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <span className="text-xs font-medium text-muted-foreground">
                    {filterMode === "sprint" ? "Membros na Sprint" : "Membros Ativos"}
                  </span>
                  <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">
                    {activeProject?.projectUsers?.length || 0}
                  </h3>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Gráficos em Linha */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Gargalos por Etapa */}
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="font-display text-[15px] font-semibold text-foreground flex items-center gap-2">
                  <Activity className="h-4.5 w-4.5 text-primary" /> 
                  {filterMode === "sprint" ? "Distribuição da Sprint por Etapas" : "Distribuição do Projeto por Etapas"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                {stageChartData.length === 0 ? (
                  <p className="text-center py-12 text-xs text-muted-foreground">Sem etapas configuradas.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stageChartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="Quantidade" fill={activeProject?.color || "#EC1889"} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Distribuição por Membro */}
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="font-display text-[15px] font-semibold text-foreground flex items-center gap-2">
                  <Users className="h-4.5 w-4.5 text-primary" /> 
                  {filterMode === "sprint" ? "Carga de Trabalho da Sprint por Membro" : "Carga de Trabalho do Projeto por Membro"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                {teamWorkloadData.length === 0 ? (
                  <p className="text-center py-12 text-xs text-muted-foreground">Nenhum membro ativo no projeto.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={teamWorkloadData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={100} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="A Fazer" stackId="a" fill="#8A8A94" />
                        <Bar dataKey="Em Progresso" stackId="a" fill="#F7B32B" />
                        <Bar dataKey="Concluídas" stackId="a" fill="#2BD47D" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Alertas / Tarefas Críticas */}
          <Card>
            <CardHeader className="py-4 border-b">
              <CardTitle className="font-display text-[15px] font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-4.5 w-4.5 text-destructive" /> 
                {filterMode === "sprint" ? "Tarefas Críticas da Sprint" : "Tarefas Críticas do Projeto"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {detailedStats?.criticalList && detailedStats.criticalList.length > 0 ? (
                  detailedStats.criticalList.map((t) => {
                    const isOverdue = t.due_at && new Date(t.due_at) < new Date();
                    return (
                      <div 
                        key={t.id} 
                        onClick={() => navigate(`/task/${t.id}`)}
                        className="flex items-center justify-between p-3.5 hover:bg-muted/40 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <h4 className="text-sm font-semibold text-foreground leading-none truncate">{t.title}</h4>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                            {t.due_at && (
                              <span className={`inline-flex items-center gap-1 font-bold ${
                                isOverdue ? "text-destructive" : "text-warning"
                              }`}>
                                <Clock className="h-3 w-3" />
                                {isOverdue ? "Atrasado: " : "Vence: "}
                                {new Date(t.due_at).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </span>
                            )}
                            {t.priority && t.priority !== "none" && (
                              <Badge variant="outline" className={`text-[11px] font-semibold ${
                                t.priority === "high" 
                                  ? "border-destructive text-destructive bg-destructive/5" 
                                  : t.priority === "medium" 
                                  ? "border-warning/40 text-warning bg-warning/10" 
                                  : "border-info/40 text-info bg-info/10"
                              }`}>
                                {t.priority === "high" ? "Alta" : t.priority === "medium" ? "Média" : "Baixa"}
                              </Badge>
                            )}
                            {t.is_sprint && (
                              <Badge variant="outline" className="text-[9px] font-bold border-warning/40 text-warning bg-warning/10 flex items-center gap-0.5">
                                <Rocket className="h-2.5 w-2.5" /> Sprint
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {t.user && (
                            <div className="flex items-center gap-1.5" title="Responsável">
                              <UserAvatar user={t.user} className="h-7 w-7" />
                              <span className="text-xs text-muted-foreground hidden sm:inline">
                                {t.user.first_name}
                              </span>
                            </div>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-center py-12 text-sm text-muted-foreground">
                    Nenhuma tarefa crítica ou atrasada nesta visualização. Parabéns! 🎉
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
