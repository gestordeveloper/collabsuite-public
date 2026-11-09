import { useState, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Columns, Settings, Users, Share2, CheckCircle,
  AlertTriangle, Clock, TrendingUp, Rocket, Activity, Plus,
  ChevronRight, MessageSquare, LayoutGrid, BarChart3, FolderOpen, KeyRound, GitBranch, Code2, Lock, Mic, Github, TerminalSquare
} from "lucide-react";
import { useDashboard } from "@/src/context/dashboard.context";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { Progress } from "@/src/components/ui/progress";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { ProjectFilesTab } from "@/src/components/project/ProjectFilesTab";
import { ProjectCredentialsTab } from "@/src/components/project/ProjectCredentialsTab";
import { ProjectWidgetTab } from "@/src/components/project/ProjectWidgetTab";
import { GithubTab } from "@/src/components/github/GithubTab";
import { SshTab } from "@/src/components/ssh/SshTab";
import { useAuthStore } from "@/src/store/auth.store";
import { RecordingsPanel } from "@/src/components/recordings/RecordingsPanel";
import { ManageFunnelAccessModal } from "@/src/components/modals/ManageFunnelAccessModal";
import type { Funnel } from "@/src/types";
import { PINK, SEMANTIC, hexA } from "@/src/lib/design";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";

type TabKey = "overview" | "dashboard" | "funnels" | "recordings" | "github" | "terminal" | "widget" | "files" | "credentials";
const TAB_KEYS: TabKey[] = ["overview", "dashboard", "funnels", "recordings", "github", "terminal", "widget", "files", "credentials"];

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects, tasks, setSelectedFunnelId, openNewFunnel } = useDashboard();
  const [searchParams] = useSearchParams();
  // ?tab=github (volta do OAuth do GitHub) abre direto a aba pedida.
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const t = searchParams.get("tab") as TabKey | null;
    return t && TAB_KEYS.includes(t) ? t : "overview";
  });
  const [filterMode, setFilterMode] = useState<"all" | "sprint">("all");
  const [accessFunnel, setAccessFunnel] = useState<Funnel | null>(null);

  const me = useAuthStore((s) => s.user);
  const projectId = Number(id);
  const project = useMemo(() => projects.find((p) => p.id === projectId) || null, [projects, projectId]);
  const canUseSsh = !!me && (me.role === "admin" || me.role === "super_admin" || (!!project && project.user_id === me.id));
  const defaultFunnel = useMemo(() => project?.funnels.find((f) => f.is_default) || project?.funnels[0] || null, [project]);
  const funnelIds = useMemo(() => project?.funnels.map((f) => f.id) || [], [project]);

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.funnel_id != null && funnelIds.includes(t.funnel_id)),
    [tasks, funnelIds]
  );

  const filteredTasks = useMemo(
    () => (filterMode === "sprint" ? projectTasks.filter((t) => t.is_sprint === true || t.sprint_id != null) : projectTasks),
    [projectTasks, filterMode]
  );

  const sprintCount = useMemo(() => projectTasks.filter((t) => t.is_sprint === true || t.sprint_id != null).length, [projectTasks]);

  const doneTasks = projectTasks.filter((t) => t.status === "done").length;
  const totalTasks = projectTasks.length;
  const progress = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  const overdue = projectTasks.filter(
    (t) => t.due_at && new Date(t.due_at) < new Date() && t.status !== "done"
  ).length;

  const healthStatus = overdue > 3 ? { label: "Crítico", cls: "bg-destructive/10 text-destructive border-destructive/30" }
    : overdue > 0 ? { label: "Atenção", cls: "bg-warning/15 text-warning border-warning/30" }
    : { label: "Em Dia", cls: "bg-success/15 text-success border-success/30" };

  // Recent tasks
  const recentTasks = useMemo(
    () => [...projectTasks].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5),
    [projectTasks]
  );

  // Recent activity (all activities from all project tasks)
  const recentActivity = useMemo(() => {
    const acts = projectTasks
      .flatMap((t) => (t.activities || []).map((a) => ({ ...a, taskTitle: t.title, taskId: t.id })))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 6);
    return acts;
  }, [projectTasks]);

  // Dashboard stats (filtered)
  const dashProgress = useMemo(() => {
    if (filteredTasks.length === 0) return 0;
    const done = filteredTasks.filter((t) => t.status === "done").length;
    return Math.round((done / filteredTasks.length) * 100);
  }, [filteredTasks]);

  const dashStats = useMemo(() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter((t) => t.status === "done").length;
    const overdue = filteredTasks.filter((t) => t.due_at && new Date(t.due_at) < new Date() && t.status !== "done").length;
    const totalSP = filteredTasks.reduce((acc, t) => acc + (t.story_points || 0), 0);
    const completedSP = filteredTasks.filter((t) => t.status === "done").reduce((acc, t) => acc + (t.story_points || 0), 0);
    const now = new Date();
    const criticalList = filteredTasks.filter((t) => {
      if (t.status === "done" || !t.due_at) return false;
      const due = new Date(t.due_at);
      return due < now || (due.getTime() - now.getTime()) / (1000 * 60 * 60) <= 48;
    }).sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
    return { total, completed, overdue, totalSP, completedSP, criticalList };
  }, [filteredTasks]);

  const stageChartData = useMemo(() => {
    if (!defaultFunnel) return [];
    return defaultFunnel.stages.map((s) => ({
      name: s.name,
      Quantidade: filteredTasks.filter((t) => t.stage_id === s.id).length,
    }));
  }, [defaultFunnel, filteredTasks]);

  const teamWorkloadData = useMemo(() => {
    if (!project) return [];
    const membersMap = new Map<number, { name: string; notdone: number; inprogress: number; done: number }>();
    project.projectUsers?.forEach((pu) => {
      if (pu.user) membersMap.set(pu.user.id, { name: `${pu.user.first_name} ${pu.user.last_name || ""}`.trim(), notdone: 0, inprogress: 0, done: 0 });
    });
    filteredTasks.forEach((t) => {
      const item = t.user_id ? membersMap.get(t.user_id) : undefined;
      if (item) {
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
  }, [project, filteredTasks]);

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8">
        Projeto não encontrado.
        <Button variant="link" onClick={() => navigate("/projects")}>Voltar aos projetos</Button>
      </div>
    );
  }

  const fc = project.color || "#EC1889";
  const statusLabel = progress === 100 ? "Concluído" : overdue > 3 ? "Crítico" : "Ativo";
  const statusColor = progress === 100 ? SEMANTIC.success : overdue > 3 ? SEMANTIC.danger : PINK;

  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Visão Geral", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { key: "dashboard", label: "Dashboard", icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { key: "funnels", label: "Funis", icon: <GitBranch className="h-3.5 w-3.5" /> },
    { key: "recordings", label: "Gravações", icon: <Mic className="h-3.5 w-3.5" /> },
    { key: "github", label: "GitHub", icon: <Github className="h-3.5 w-3.5" /> },
    // Terminal SSH: só dono do projeto e admins (o servidor também confere a cada chamada).
    ...(canUseSsh ? [{ key: "terminal" as TabKey, label: "Terminal", icon: <TerminalSquare className="h-3.5 w-3.5" /> }] : []),
    { key: "widget", label: "Widget de Chamados", icon: <Code2 className="h-3.5 w-3.5" /> },
    { key: "files", label: "Arquivos", icon: <FolderOpen className="h-3.5 w-3.5" /> },
    { key: "credentials", label: "Credenciais", icon: <KeyRound className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {/* ── HERO HEADER ───────────────────────────────────────────────── */}
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 pt-5 text-[13px] text-muted-foreground">
            <button onClick={() => navigate("/projects")} className="hover:text-foreground transition-colors flex items-center gap-1">
              <ArrowLeft className="h-3.5 w-3.5" /> Projetos
            </button>
            <ChevronRight className="h-3 w-3 opacity-40" />
            <span className="font-medium text-foreground">{project.name}</span>
          </div>

          {/* Project title row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="h-3 w-3 rounded-[4px] shrink-0" style={{ backgroundColor: fc }} />
              <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] truncate">{project.name}</h1>
              <span
                className="shrink-0 rounded-full px-2.5 py-[3px] text-xs font-semibold"
                style={{ backgroundColor: hexA(statusColor, 0.14), color: statusColor }}
              >
                {statusLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="secondary" className="gap-1.5"
                onClick={() => {
                  const origin = window.location.origin;
                  navigator.clipboard.writeText(`${origin}/projects/${project.id}`).then(() => alert("Link copiado!"));
                }}>
                <Share2 className="h-3.5 w-3.5" /> Compartilhar
              </Button>
              <Button className="gap-1.5" disabled={!defaultFunnel}
                onClick={() => { if (defaultFunnel) { setSelectedFunnelId(defaultFunnel.id); navigate("/kanban"); } }}>
                <Columns className="h-3.5 w-3.5" /> Abrir Quadro
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
                  activeTab === tab.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={activeTab === tab.key ? "text-primary" : "text-subtle"}>{tab.icon}</span> {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── PAGE CONTENT ──────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-6 space-y-6">

        {activeTab === "overview" && (
          <>
            {/* Top Row: Overview + Status */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Project Overview */}
              <Card className="lg:col-span-2">
                <CardContent className="p-5 space-y-5">
                  <div>
                    <h2 className="font-display text-[15px] font-semibold text-foreground mb-2">Visão Geral do Projeto</h2>
                    <p className="text-sm text-foreground leading-relaxed">
                      {project.content || "Sem descrição definida para este projeto."}
                    </p>
                  </div>
                  {defaultFunnel && defaultFunnel.stages.length > 0 && (
                    <div>
                      <h3 className="text-[13px] font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
                        Etapas do funil principal
                      </h3>
                      <ul className="space-y-1.5">
                        {defaultFunnel.stages.map((s) => {
                          const stageTasks = projectTasks.filter((t) => t.stage_id === s.id);
                          const stageDone = stageTasks.filter((t) => t.status === "done").length;
                          return (
                            <li key={s.id} className="flex items-center gap-2 text-sm">
                              {s.stage_done ? (
                                <CheckCircle className="h-4 w-4 text-success shrink-0" />
                              ) : stageTasks.length > 0 ? (
                                <div className="h-4 w-4 rounded-full border-2 border-primary shrink-0" style={{ borderColor: fc }} />
                              ) : (
                                <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                              )}
                              <span className="flex-1">{s.name}</span>
                              <span className="text-[10px] text-muted-foreground">{stageDone}/{stageTasks.length}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Status Cards */}
              <div className="space-y-4">
                {/* Completion */}
                <Card>
                  <CardContent className="p-5">
                    <h2 className="text-xs font-medium text-muted-foreground mb-3">Status de Conclusão</h2>
                    <div className="flex items-end gap-2 mb-2">
                      <span className="font-display text-[30px] font-semibold leading-none tracking-[-0.02em]">{progress}%</span>
                      <span className="text-xs text-muted-foreground mb-1">progresso geral</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-2">{doneTasks} de {totalTasks} tarefas concluídas</p>
                  </CardContent>
                </Card>

                {/* Health */}
                <Card>
                  <CardContent className="p-5 space-y-3">
                    <h2 className="text-xs font-medium text-muted-foreground">Saúde do Projeto</h2>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Situação</span>
                      <span className={`text-xs font-semibold px-2 py-[3px] rounded-md border ${healthStatus.cls}`}>{healthStatus.label}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Tarefas atrasadas</span>
                      <span className={`text-sm font-bold ${overdue > 0 ? "text-destructive" : "text-success"}`}>{overdue}</span>
                    </div>
                    {sprintCount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-1"><Rocket className="h-3 w-3 text-warning" /> Sprint ativa</span>
                        <span className="text-sm font-bold text-warning">{sprintCount} tarefas</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Middle Row: Recent Tasks + Team + Timeline */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Recent Tasks */}
              <Card className="lg:col-span-1">
                <CardHeader className="py-3 px-4 flex flex-row items-center justify-between border-b">
                  <CardTitle className="font-display text-[15px] font-semibold text-foreground">Tarefas Recentes</CardTitle>
                  <button
                    className="text-[13px] text-primary hover:underline"
                    onClick={() => { if (defaultFunnel) { setSelectedFunnelId(defaultFunnel.id); navigate("/kanban"); } }}
                  >
                    Ver todas
                  </button>
                </CardHeader>
                <CardContent className="p-0 divide-y">
                  {recentTasks.length === 0 && (
                    <p className="text-xs text-center text-muted-foreground py-8">Nenhuma tarefa ainda.</p>
                  )}
                  {recentTasks.map((t) => {
                    const stageName = project.funnels.flatMap((f) => f.stages).find((s) => s.id === t.stage_id)?.name;
                    const isOverdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "done";
                    return (
                      <div
                        key={t.id}
                        onClick={() => navigate(`/task/${t.id}`)}
                        className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                      >
                        {stageName && (
                          <span className="inline-block text-[11px] font-semibold px-2 py-[3px] rounded-md w-fit" style={{ background: `${fc}15`, color: fc }}>
                            {stageName}
                          </span>
                        )}
                        <p className="text-xs font-semibold line-clamp-2">{t.title}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex -space-x-1.5">
                            {t.user && <UserAvatar user={t.user} className="h-5 w-5 ring-1 ring-card" />}
                            {t.taskUsers?.slice(0, 2).map((tu) => tu.user && <UserAvatar key={tu.id} user={tu.user} className="h-5 w-5 ring-1 ring-card" />)}
                          </div>
                          {t.due_at && (
                            <span className={`text-[10px] font-bold ${isOverdue ? "text-destructive" : "text-muted-foreground"}`}>
                              {isOverdue ? "Atrasado" : new Date(t.due_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* Team */}
              <Card>
                <CardHeader className="py-3 px-4 border-b">
                  <CardTitle className="font-display text-[15px] font-semibold text-foreground">Equipe</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {(!project.projectUsers || project.projectUsers.length === 0) && (
                    <p className="text-xs text-muted-foreground text-center py-4">Nenhum membro.</p>
                  )}
                  {project.projectUsers?.map((pu) =>
                    pu.user ? (
                      <div key={pu.id} className="flex items-center gap-3">
                        <UserAvatar user={pu.user} className="h-8 w-8 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{pu.user.first_name} {pu.user.last_name || ""}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{pu.user.email}</p>
                        </div>
                      </div>
                    ) : null
                  )}
                </CardContent>
              </Card>

              {/* Kanban Stages as Timeline (funil principal) */}
              <Card>
                <CardHeader className="py-3 px-4 border-b">
                  <CardTitle className="font-display text-[15px] font-semibold text-foreground">Linha do Tempo (Etapas)</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  {(!defaultFunnel || defaultFunnel.stages.length === 0) && (
                    <p className="text-xs text-muted-foreground text-center py-4">Sem etapas.</p>
                  )}
                  <div className="relative pl-4 space-y-4">
                    {(defaultFunnel?.stages || []).map((s, i, arr) => {
                      const stageTasks = projectTasks.filter((t) => t.stage_id === s.id);
                      const stageDone = stageTasks.filter((t) => t.status === "done").length;
                      const isComplete = stageTasks.length > 0 && stageDone === stageTasks.length;
                      const isActive = stageTasks.some((t) => t.status === "inprogress");
                      return (
                        <div key={s.id} className="relative">
                          {/* Vertical line */}
                          {i < arr.length - 1 && (
                            <div className="absolute left-[-9px] top-5 bottom-[-16px] w-px bg-border" />
                          )}
                          {/* Dot */}
                          <div className={`absolute left-[-13px] top-1 h-3 w-3 rounded-full border-2 ${
                            isComplete ? "border-success bg-success"
                            : isActive ? "bg-card"
                            : "border-muted-foreground/30 bg-muted"
                          }`} style={isActive ? { borderColor: fc } : {}} />
                          <div className="space-y-0.5">
                            <p className={`text-xs font-bold ${isActive ? "text-foreground" : isComplete ? "text-success" : "text-muted-foreground"}`}>{s.name}</p>
                            <p className="text-[10px] text-muted-foreground">{stageDone}/{stageTasks.length} tarefas</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Activity Feed */}
            {recentActivity.length > 0 && (
              <Card>
                <CardHeader className="py-3 px-4 border-b flex flex-row items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="font-display text-[15px] font-semibold text-foreground">Atividade Recente</CardTitle>
                </CardHeader>
                <CardContent className="p-0 divide-y">
                  {recentActivity.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => navigate(`/task/${a.taskId}`)}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      {a.user && <UserAvatar user={a.user} className="h-7 w-7 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs">
                          <span className="font-semibold">{a.user?.first_name}</span>{" "}
                          comentou em <span className="font-semibold">{a.taskTitle}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{a.content}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                        {new Date(a.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {activeTab === "dashboard" && (
          <>
            {/* Sprint / All filter tabs */}
            <div className="flex w-fit items-center gap-1 rounded-[9px] border bg-card p-[3px]">
              <button onClick={() => setFilterMode("all")}
                className={`px-3.5 py-1.5 text-[13px] font-medium rounded-md transition-colors ${filterMode === "all" ? "bg-input text-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                Visão Completa do Projeto
              </button>
              <button onClick={() => setFilterMode("sprint")}
                className={`px-3.5 py-1.5 text-[13px] font-medium rounded-md flex items-center gap-1.5 transition-colors ${filterMode === "sprint" ? "bg-input text-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                <Rocket className="h-3.5 w-3.5" /> Sprint Ativa
                <span className={`text-[9px] px-1.5 rounded-full border font-bold ${filterMode === "sprint" ? "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground" : "border-muted-foreground/30 bg-muted text-muted-foreground"}`}>{sprintCount}</span>
              </button>
            </div>

            {filterMode === "sprint" && dashStats.total === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center border border-dashed rounded-xl">
                <AlertTriangle className="h-10 w-10 text-warning" />
                <h3 className="font-bold text-sm">Nenhuma tarefa vinculada à Sprint ativa</h3>
                <p className="text-xs text-muted-foreground max-w-md">
                  Abra um card de tarefa no Quadro Kanban e ative a opção "Sprint" para incluir tarefas nesta Sprint.
                </p>
                <Button size="sm" className="gap-1.5" disabled={!defaultFunnel} onClick={() => { if (defaultFunnel) { setSelectedFunnelId(defaultFunnel.id); navigate("/kanban"); } }}>
                  <Columns className="h-3.5 w-3.5" /> Ir para o Quadro
                </Button>
              </div>
            ) : (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="relative h-14 w-14 shrink-0">
                        <svg className="h-full w-full -rotate-90" viewBox="0 0 56 56">
                          <circle cx="28" cy="28" r="22" fill="none" strokeWidth="4" className="stroke-muted" />
                          <circle cx="28" cy="28" r="22" fill="none" strokeWidth="4"
                            stroke={fc}
                            strokeDasharray={2 * Math.PI * 22}
                            strokeDashoffset={2 * Math.PI * 22 - (dashProgress / 100) * (2 * Math.PI * 22)}
                            strokeLinecap="round" />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold">{dashProgress}%</span>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground leading-tight">{filterMode === "sprint" ? "Progresso Sprint" : "Progresso Geral"}</p>
                        <p className="text-sm font-semibold text-muted-foreground">{dashStats.completed}/{dashStats.total} tarefas</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="p-3 bg-info/15 rounded-lg text-info shrink-0">
                        <TrendingUp className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground leading-tight">{filterMode === "sprint" ? "SP da Sprint" : "Story Points"}</p>
                        <p className="font-display text-[22px] font-semibold tracking-[-0.02em] text-info">
                          {dashStats.completedSP}<span className="text-xs font-normal text-muted-foreground">/{dashStats.totalSP} pts</span>
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className={`p-3 rounded-lg shrink-0 ${dashStats.overdue > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground/60"}`}>
                        <AlertTriangle className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground leading-tight">Atrasadas</p>
                        <p className={`font-display text-[22px] font-semibold tracking-[-0.02em] ${dashStats.overdue > 0 ? "text-destructive" : ""}`}>{dashStats.overdue}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="p-3 bg-info/15 rounded-lg text-info shrink-0">
                        <Users className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground leading-tight">Membros</p>
                        <p className="font-display text-[22px] font-semibold tracking-[-0.02em]">{project.projectUsers?.length || 0}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="font-display text-[15px] font-semibold text-foreground flex items-center gap-2">
                        <Activity className="h-4 w-4 text-primary" />
                        {filterMode === "sprint" ? "Sprint por Etapas (Gargalos)" : "Tarefas por Etapas (Gargalos)"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 pb-4">
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stageChartData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Bar dataKey="Quantidade" fill={fc} radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="font-display text-[15px] font-semibold text-foreground flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        {filterMode === "sprint" ? "Carga da Sprint por Membro" : "Carga de Trabalho por Membro"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 pb-4">
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
                    </CardContent>
                  </Card>
                </div>

                {/* Critical List */}
                <Card>
                  <CardHeader className="py-4 border-b">
                    <CardTitle className="font-display text-[15px] font-semibold text-foreground flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      {filterMode === "sprint" ? "Críticas da Sprint" : "Tarefas Críticas / Próximas do Vencimento"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {dashStats.criticalList.length > 0 ? dashStats.criticalList.map((t) => {
                        const isOverdue = t.due_at && new Date(t.due_at) < new Date();
                        return (
                          <div key={t.id} onClick={() => navigate(`/task/${t.id}`)}
                            className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/40 cursor-pointer transition-colors">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold truncate">{t.title}</p>
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                {t.due_at && (
                                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${isOverdue ? "text-destructive" : "text-warning"}`}>
                                    <Clock className="h-3 w-3" />
                                    {isOverdue ? "Atrasado: " : "Vence: "}
                                    {new Date(t.due_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                                  </span>
                                )}
                                {t.priority && t.priority !== "none" && (
                                  <Badge variant="outline" className={`text-[11px] font-semibold ${
                                    t.priority === "high" ? "border-destructive text-destructive" :
                                    t.priority === "medium" ? "border-warning/40 text-warning" :
                                    "border-info/40 text-info"}`}>
                                    {t.priority === "high" ? "Alta" : t.priority === "medium" ? "Média" : "Baixa"}
                                  </Badge>
                                )}
                                {t.is_sprint && (
                                  <Badge variant="outline" className="text-[9px] border-warning/40 text-warning flex items-center gap-0.5">
                                    <Rocket className="h-2.5 w-2.5" /> Sprint
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-4">
                              {t.user && <UserAvatar user={t.user} className="h-7 w-7" />}
                              <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                            </div>
                          </div>
                        );
                      }) : (
                        <p className="text-center py-12 text-sm text-muted-foreground">Nenhuma tarefa crítica nesta visualização.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}

        {activeTab === "funnels" && (
          <Card>
            <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
              <CardTitle className="font-display text-[15px] font-semibold text-foreground">Funis deste Projeto</CardTitle>
              <Button size="sm" className="gap-1.5" onClick={() => openNewFunnel(project.id)}>
                <Plus className="h-3.5 w-3.5" /> Novo Funil
              </Button>
            </CardHeader>
            <CardContent className="p-0 divide-y">
              {project.funnels.length === 0 && (
                <p className="text-xs text-center text-muted-foreground py-8">Nenhum funil neste projeto ainda.</p>
              )}
              {project.funnels.map((f) => {
                const fTasks = projectTasks.filter((t) => t.funnel_id === f.id);
                const fDone = fTasks.filter((t) => t.status === "done").length;
                return (
                  <div key={f.id} className="flex items-center justify-between px-4 py-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{f.name}</p>
                        {f.is_default && (
                          <Badge variant="outline" className="text-[11px] font-semibold">Padrão</Badge>
                        )}
                        {f.visibility === "restricted" && (
                          <Badge variant="secondary" className="text-[11px] font-semibold gap-1">
                            <Lock className="h-2.5 w-2.5" /> Restrito
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {f.stages.length} etapas · {fDone}/{fTasks.length} tarefas concluídas
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="secondary" size="sm" className="gap-1.5"
                        onClick={() => setAccessFunnel(f)}>
                        <Lock className="h-3.5 w-3.5" /> Acesso
                      </Button>
                      <Button variant="secondary" size="sm" className="gap-1.5"
                        onClick={() => { setSelectedFunnelId(f.id); navigate("/kanban"); }}>
                        <Columns className="h-3.5 w-3.5" /> Abrir Quadro
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {activeTab === "recordings" && <RecordingsPanel projectId={project.id} />}

        {activeTab === "widget" && (
          <ProjectWidgetTab project={project} onCreateFunnel={() => openNewFunnel(project.id)} />
        )}

        {activeTab === "github" && <GithubTab projectId={project.id} projectName={project.name ?? ""} />}

        {activeTab === "terminal" && canUseSsh && <SshTab projectId={project.id} />}

        {activeTab === "files" && <ProjectFilesTab projectId={project.id} />}

        {activeTab === "credentials" && <ProjectCredentialsTab projectId={project.id} />}
      </div>

      <ManageFunnelAccessModal isOpen={accessFunnel !== null} onClose={() => setAccessFunnel(null)} projectId={project.id} funnel={accessFunnel} />
    </div>
  );
}
