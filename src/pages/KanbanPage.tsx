import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { List, KanbanSquare, CalendarDays, FileText, FileSpreadsheet, Filter, FolderOpen, KeyRound, GitBranch } from "lucide-react";
import { useDashboard } from "@/src/context/dashboard.context";
import { KanbanBoard } from "@/src/components/kanban/KanbanBoard";
import { ListView } from "@/src/components/kanban/ListView";
import { CalendarView } from "@/src/components/kanban/CalendarView";
import { FilterBar, applyFilters, EMPTY_FILTERS } from "@/src/components/kanban/FilterBar";
import { ProjectFilesDrawer } from "@/src/components/project/ProjectFilesDrawer";
import { ProjectCredentialsDrawer } from "@/src/components/project/ProjectCredentialsDrawer";
import { exportToPDF, exportToExcel } from "@/src/lib/export";
import { cn } from "@/src/lib/utils";
import type { Filters } from "@/src/components/kanban/FilterBar";

type ViewMode = "list" | "kanban" | "calendar";

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: typeof List }[] = [
  { value: "list", label: "", icon: List },
  { value: "kanban", label: "", icon: KanbanSquare },
  { value: "calendar", label: "", icon: CalendarDays },
];

export function KanbanPage() {
  const {
    projects, funnels, tasks, selectedFunnelId, filteredTasks, setSelectedFunnelId, openNewTask, openNewProject, openNewFunnel, openNewStage, moveTaskStage, handleDeleteStage, handleReorderStage, setHeaderExtra,
  } = useDashboard();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);

  const funnel = funnels.find((f) => f.id === selectedFunnelId) ?? null;
  const activeProject = projects.find((p) => p.id === funnel?.project_id) ?? null;
  const funnelTasks = tasks.filter((t) => t.funnel_id === selectedFunnelId && (t.task_id == null || t.task_id === 0));
  const filtered = applyFilters(filteredTasks, filters);
  const stages = funnel ? [...funnel.stages].sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0)) : [];

  useEffect(() => {
    setHeaderExtra(
      <div className="hidden md:flex items-center gap-2">
        <select
          value={selectedFunnelId ?? ""}
          onChange={(e) => { setSelectedFunnelId(Number(e.target.value)); setFilters(EMPTY_FILTERS); }}
          className="flex h-9 rounded-md border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25"
        >
          {projects.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {p.funnels.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-[9px] border bg-card p-[3px]">
          {VIEW_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => setViewMode(opt.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  viewMode === opt.value
                    ? "bg-input text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowFilters((v) => !v)}
          title="Filtros"
          className={cn(
            "flex items-center justify-center rounded-md border px-2.5 py-1.5 transition-all",
            showFilters
              ? "border-primary bg-primary/10 text-primary"
              : "border-input bg-surface text-muted-foreground hover:bg-accent"
          )}
        >
          <Filter className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => setShowFiles(true)}
          title="Arquivos"
          className="flex items-center justify-center rounded-md border border-input bg-surface px-2.5 py-1.5 text-muted-foreground transition-all hover:bg-accent"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => setShowCredentials(true)}
          title="Credenciais"
          className="flex items-center justify-center rounded-md border border-input bg-surface px-2.5 py-1.5 text-muted-foreground transition-all hover:bg-accent"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => activeProject && openNewFunnel(activeProject.id)}
          title="Novo Funil"
          className="flex items-center gap-1.5 rounded-md border border-input bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-accent"
        >
          <GitBranch className="h-3.5 w-3.5" /> Novo Funil
        </button>
      </div>
    );
    return () => setHeaderExtra(null);
  }, [projects, funnels, selectedFunnelId, activeProject, viewMode, showFilters, setSelectedFunnelId, setHeaderExtra]);

  return (
    <div className="flex h-[calc(100vh-7.5rem)] max-h-[calc(100vh-7.5rem)] md:h-[calc(100vh-3.5rem)] md:max-h-[calc(100vh-3.5rem)] flex-1 flex-col overflow-hidden">
      {!funnel ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
          <p className="text-muted-foreground">Nenhum projeto selecionado.</p>
          <button onClick={openNewProject} className="text-primary hover:underline">
            Criar primeiro projeto
          </button>
        </div>
      ) : (
        <>
          {/* Mobile Action Bar */}
          <div className="flex flex-col gap-2 border-b bg-card p-4 md:hidden">
            <div className="flex items-center justify-between gap-2">
              <select
                value={selectedFunnelId ?? ""}
                onChange={(e) => { setSelectedFunnelId(Number(e.target.value)); setFilters(EMPTY_FILTERS); }}
                className="flex h-9 flex-1 rounded-md border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-0"
              >
                {projects.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {p.funnels.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>



              <button
                onClick={() => setShowFilters((v) => !v)}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all shrink-0",
                  showFilters
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-surface text-muted-foreground hover:bg-accent"
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Filtros</span>
              </button>

              <button
                onClick={() => setShowFiles(true)}
                className="flex items-center gap-1 rounded-md border border-input bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-accent shrink-0"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={() => setShowCredentials(true)}
                className="flex items-center gap-1 rounded-md border border-input bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-accent shrink-0"
              >
                <KeyRound className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={() => activeProject && openNewFunnel(activeProject.id)}
                className="flex items-center gap-1 rounded-md border border-input bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-accent shrink-0"
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-card p-4 py-2">
              <FilterBar filters={filters} onChange={setFilters} stages={stages} allTasks={funnelTasks} />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => funnel && exportToPDF(filtered, stages, funnel.name, filters)}
                  className="flex items-center gap-1 rounded-md border border-input bg-surface px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                  title="Exportar PDF"
                >
                  <FileText className="h-3.5 w-3.5" /> PDF
                </button>
                <button
                  onClick={() => funnel && exportToExcel(filtered, stages, funnel.name, filters)}
                  className="flex items-center gap-1 rounded-md border border-input bg-surface px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                  title="Exportar Excel"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
            {viewMode === "list" ? (
              <ListView
                funnel={funnel}
                filteredTasks={filtered}
                onTaskClick={(task) => navigate(`/task/${task.id}`)}
                onMoveTask={moveTaskStage}
                onAddTask={(stageId) => openNewTask(stageId)}
              />
            ) : viewMode === "calendar" ? (
              <CalendarView
                funnel={funnel}
                filteredTasks={filtered}
                onTaskClick={(task) => navigate(`/task/${task.id}`)}
                onMoveTask={moveTaskStage}
              />
            ) : (
              <KanbanBoard
                funnels={funnels}
                selectedFunnelId={selectedFunnelId}
                filteredTasks={filtered}
                onTaskClick={(task) => navigate(`/task/${task.id}`)}
                onMoveTask={moveTaskStage}
                onAddTask={(stageId) => openNewTask(stageId)}
                onNewProject={openNewProject}
                onNewStage={openNewStage}
                onDeleteStage={handleDeleteStage}
                onReorderStage={handleReorderStage}
              />
            )}
          </div>
        </>
      )}

      <ProjectFilesDrawer
        projectId={showFiles ? (activeProject?.id ?? null) : null}
        projectName={activeProject?.name}
        projectColor={activeProject?.color}
        onClose={() => setShowFiles(false)}
      />

      <ProjectCredentialsDrawer
        projectId={showCredentials ? (activeProject?.id ?? null) : null}
        projectName={activeProject?.name}
        projectColor={activeProject?.color}
        onClose={() => setShowCredentials(false)}
      />
    </div>
  );
}