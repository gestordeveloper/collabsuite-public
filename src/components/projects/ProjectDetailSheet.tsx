import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { 
  X, Clock, CheckCircle, AlertTriangle, Users, 
  BarChart3, TrendingUp, ChevronRight, Activity, Rocket, Columns, ExternalLink
} from "lucide-react";
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
import type { Task } from "@/src/types";

interface ProjectDetailSheetProps {
  projectId: number | null;
  onClose: () => void;
}

export function ProjectDetailSheet({ projectId, onClose }: ProjectDetailSheetProps) {
  const { projects, tasks, setSelectedFunnelId } = useDashboard();
  const navigate = useNavigate();
  const [filterMode, setFilterMode] = useState<"all" | "sprint">("all");

  const project = useMemo(
    () => (projectId != null ? projects.find((p) => p.id === projectId) || null : null),
    [projectId, projects]
  );

  const defaultFunnel = useMemo(() => project?.funnels.find((f) => f.is_default) || project?.funnels[0] || null, [project]);
  const funnelIds = useMemo(() => project?.funnels.map((f) => f.id) || [], [project]);

  const projectTasks = useMemo(
    () => (projectId != null ? tasks.filter((t) => t.funnel_id != null && funnelIds.includes(t.funnel_id)) : []),
    [projectId, tasks, funnelIds]
  );

  const projectTasksFiltered = useMemo(() => {
    if (filterMode === "sprint") return projectTasks.filter((t) => t.is_sprint === true);
    return projectTasks;
  }, [projectTasks, filterMode]);

  const sprintCount = useMemo(() => projectTasks.filter((t) => t.is_sprint === true).length, [projectTasks]);

  const progress = useMemo(() => {
    if (projectTasksFiltered.length === 0) return 0;
    const done = projectTasksFiltered.filter((t) => t.status === "done").length;
    return Math.round((done / projectTasksFiltered.length) * 100);
  }, [projectTasksFiltered]);

  const stats = useMemo(() => {
    const total = projectTasksFiltered.length;
    const completed = projectTasksFiltered.filter((t) => t.status === "done").length;
    const inProgress = projectTasksFiltered.filter((t) => t.status === "inprogress").length;
    const overdue = projectTasksFiltered.filter(
      (t) => t.due_at && new Date(t.due_at) < new Date() && t.status !== "done"
    ).length;
    const totalSP = projectTasksFiltered.reduce((acc, t) => acc + (t.story_points || 0), 0);
    const completedSP = projectTasksFiltered
      .filter((t) => t.status === "done")
      .reduce((acc, t) => acc + (t.story_points || 0), 0);

    const now = new Date();
    const criticalList = projectTasksFiltered
      .filter((t) => {
        if (t.status === "done" || !t.due_at) return false;
        const due = new Date(t.due_at);
        return due < now || (due.getTime() - now.getTime()) / (1000 * 60 * 60) <= 48;
      })
      .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());

    return { total, completed, inProgress, overdue, totalSP, completedSP, criticalList };
  }, [projectTasksFiltered]);

  const stageChartData = useMemo(() => {
    if (!defaultFunnel) return [];
    return defaultFunnel.stages.map((s) => ({
      name: s.name,
      Quantidade: projectTasksFiltered.filter((t) => t.stage_id === s.id).length,
    }));
  }, [defaultFunnel, projectTasksFiltered]);

  const teamWorkloadData = useMemo(() => {
    if (!project) return [];
    const membersMap = new Map<number, { name: string; notdone: number; inprogress: number; done: number }>();

    project.projectUsers?.forEach((pu) => {
      if (pu.user) {
        membersMap.set(pu.user.id, {
          name: `${pu.user.first_name} ${pu.user.last_name || ""}`.trim(),
          notdone: 0,
          inprogress: 0,
          done: 0,
        });
      }
    });

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
  }, [project, projectTasksFiltered]);

  const isOpen = projectId != null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-background/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Sheet Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-3xl bg-card border-l shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {project && (
          <>
            {/* Sheet Header */}
            <div
              className="flex items-center justify-between gap-4 p-5 border-b shrink-0"
              style={{ borderLeftColor: project.color || "#EC1889", borderLeftWidth: 4 }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: project.color || "#EC1889" }}
                  />
                  <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Detalhes do Projeto</p>
                </div>
                <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] truncate">{project.name}</h2>
                {project.content && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{project.content}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => {
                    if (defaultFunnel) setSelectedFunnelId(defaultFunnel.id);
                    navigate("/kanban");
                  }}
                >
                  <Columns className="h-3.5 w-3.5" /> Quadro
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 px-5 py-2.5 border-b bg-muted/30 shrink-0">
              <button
                onClick={() => setFilterMode("all")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                  filterMode === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                Visão Geral
              </button>
              <button
                onClick={() => setFilterMode("sprint")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${
                  filterMode === "sprint"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Rocket className="h-3 w-3" /> Sprint Ativa
                <span
                  className={`text-[9px] px-1.5 rounded-full font-bold border ${
                    filterMode === "sprint"
                      ? "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground"
                      : "border-muted-foreground/30 bg-muted text-muted-foreground"
                  }`}
                >
                  {sprintCount}
                </span>
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {filterMode === "sprint" && stats.total === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 text-center py-16">
                  <div className="p-4 bg-warning/15 rounded-full text-warning">
                    <AlertTriangle className="h-10 w-10" />
                  </div>
                  <h3 className="font-bold text-sm">Nenhuma tarefa vinculada à Sprint</h3>
                  <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                    Não há tarefas marcadas como Sprint ativa neste projeto. Abra o card de detalhes no Quadro Kanban e ative a opção "Sprint".
                  </p>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5 mt-2"
                    onClick={() => {
                      if (defaultFunnel) setSelectedFunnelId(defaultFunnel.id);
                      navigate("/kanban");
                    }}
                  >
                    <Columns className="h-3.5 w-3.5" /> Ir para o Quadro
                  </Button>
                </div>
              ) : (
                <>
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Progresso */}
                    <Card>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="relative h-12 w-12 shrink-0">
                          <svg className="h-full w-full -rotate-90" viewBox="0 0 56 56">
                            <circle cx="28" cy="28" r="22" fill="none" strokeWidth="4" className="stroke-muted" />
                            <circle
                              cx="28" cy="28" r="22" fill="none" strokeWidth="4"
                              stroke={project.color || "#EC1889"}
                              strokeDasharray={2 * Math.PI * 22}
                              strokeDashoffset={2 * Math.PI * 22 - (progress / 100) * (2 * Math.PI * 22)}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                            {progress}%
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-muted-foreground leading-tight">
                            {filterMode === "sprint" ? "Progresso Sprint" : "Progresso Geral"}
                          </p>
                          <p className="text-xs font-semibold text-muted-foreground">
                            {stats.completed}/{stats.total}
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Story Points */}
                    <Card>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="p-2 bg-info/15 rounded-lg text-info shrink-0">
                          <TrendingUp className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-muted-foreground leading-tight">Story Points</p>
                          <p className="text-base font-bold text-info">
                            {stats.completedSP}<span className="text-[10px] text-muted-foreground font-normal">/{stats.totalSP}</span>
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Atrasadas */}
                    <Card>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className={`p-2 rounded-lg shrink-0 ${
                          stats.overdue > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground/60"
                        }`}>
                          <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-muted-foreground leading-tight">Atrasadas</p>
                          <p className={`text-base font-bold ${stats.overdue > 0 ? "text-destructive" : "text-foreground"}`}>
                            {stats.overdue}
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Membros */}
                    <Card>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="p-2 bg-info/15 rounded-lg text-info shrink-0">
                          <Users className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-muted-foreground leading-tight">Membros</p>
                          <p className="text-base font-bold">
                            {project.projectUsers?.length || 0}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Members List */}
                  {project.projectUsers && project.projectUsers.length > 0 && (
                    <Card>
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-primary" /> Equipe do Projeto
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 pt-0 flex flex-wrap gap-2">
                        {project.projectUsers.map((fu) =>
                          fu.user ? (
                            <div key={fu.id} className="flex items-center gap-2 bg-muted/50 rounded-full px-2.5 py-1">
                              <UserAvatar user={fu.user} className="h-5 w-5" />
                              <span className="text-xs font-medium">{fu.user.first_name} {fu.user.last_name || ""}</span>
                            </div>
                          ) : null
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Tarefas por Etapa */}
                  {stageChartData.length > 0 && (
                    <Card>
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Activity className="h-3.5 w-3.5 text-primary" /> 
                          {filterMode === "sprint" ? "Sprint por Etapas" : "Tarefas por Etapas (Gargalos)"}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0 pb-4 px-4">
                        <div className="h-52">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stageChartData}>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                              <YAxis tick={{ fontSize: 9 }} />
                              <Tooltip />
                              <Bar dataKey="Quantidade" fill={project.color || "#EC1889"} radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Carga por Membro */}
                  {teamWorkloadData.length > 0 && (
                    <Card>
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-primary" /> 
                          {filterMode === "sprint" ? "Carga da Sprint por Membro" : "Carga de Trabalho por Membro"}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0 pb-4 px-4">
                        <div className="h-52">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={teamWorkloadData} layout="vertical">
                              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                              <XAxis type="number" tick={{ fontSize: 9 }} />
                              <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} width={90} />
                              <Tooltip />
                              <Legend wrapperStyle={{ fontSize: 9 }} />
                              <Bar dataKey="A Fazer" stackId="a" fill="#8A8A94" />
                              <Bar dataKey="Em Progresso" stackId="a" fill="#F7B32B" />
                              <Bar dataKey="Concluídas" stackId="a" fill="#2BD47D" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Tarefas Críticas */}
                  <Card>
                    <CardHeader className="py-3 px-4 border-b">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                        {filterMode === "sprint" ? "Críticas da Sprint" : "Tarefas Críticas"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {stats.criticalList.length > 0 ? (
                          stats.criticalList.map((t) => {
                            const isOverdue = t.due_at && new Date(t.due_at) < new Date();
                            return (
                              <div
                                key={t.id}
                                onClick={() => navigate(`/task/${t.id}`)}
                                className="flex items-center justify-between p-3 hover:bg-muted/40 cursor-pointer transition-colors"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold truncate">{t.title}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {t.due_at && (
                                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${isOverdue ? "text-destructive" : "text-warning"}`}>
                                        <Clock className="h-2.5 w-2.5" />
                                        {isOverdue ? "Atrasado: " : "Vence: "}
                                        {new Date(t.due_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                                      </span>
                                    )}
                                    {t.priority && t.priority !== "none" && (
                                      <Badge variant="outline" className={`text-[9px] h-4 px-1 uppercase font-bold ${
                                        t.priority === "high" ? "border-destructive text-destructive" :
                                        t.priority === "medium" ? "border-warning/40 text-warning" :
                                        "border-info/40 text-info"
                                      }`}>
                                        {t.priority === "high" ? "Alta" : t.priority === "medium" ? "Média" : "Baixa"}
                                      </Badge>
                                    )}
                                    {t.is_sprint && (
                                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-warning/40 text-warning flex items-center gap-0.5">
                                        <Rocket className="h-2 w-2" /> Sprint
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  {t.user && <UserAvatar user={t.user} className="h-6 w-6" />}
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-center py-8 text-xs text-muted-foreground">
                            Nenhuma tarefa crítica 🎉
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
