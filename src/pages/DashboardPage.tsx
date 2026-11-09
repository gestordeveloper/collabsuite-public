import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTaskStore } from "@/src/store/task.store";
import { useAuthStore } from "@/src/store/auth.store";
import { useUsers } from "@/src/hooks/useUsers";
import * as taskService from "@/src/services/task.service";
import * as funnelService from "@/src/services/funnel.service";
import * as projectService from "@/src/services/project.service";
import { Sidebar } from "@/src/components/layout/Sidebar";
import { Header } from "@/src/components/layout/Header";
import { Tabbar } from "@/src/components/layout/Tabbar";
import { CommandPalette } from "@/src/components/layout/CommandPalette";
import { NewTaskModal } from "@/src/components/modals/NewTaskModal";
import { NewProjectModal } from "@/src/components/modals/NewProjectModal";
import { NewFunnelModal } from "@/src/components/modals/NewFunnelModal";
import { NewStageModal } from "@/src/components/modals/NewStageModal";
import { EditProjectModal } from "@/src/components/modals/EditProjectModal";
import { ManageMembersModal } from "@/src/components/modals/ManageMembersModal";
import { DashboardContext, type DashboardContextValue } from "@/src/context/dashboard.context";
import type { Project } from "@/src/types";

type RouteTab = "/" | "/kanban" | "/projects" | "/agenda" | "/settings";

export function DashboardPage() {
  const { user } = useAuthStore();
  const { projects, funnels, tasks, selectedFunnelId, setSelectedFunnelId, updateTaskInState, removeTask, removeFunnel, removeProject } = useTaskStore();
  const usersList = useUsers();
  const navigate = useNavigate();
  const location = useLocation();
  const isLoading = useTaskStore((s) => s.isLoading);

  const [searchQuery, setSearchQuery] = useState("");
  const [headerExtra, setHeaderExtra] = useState<React.ReactNode>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [isNewTaskModalOpen, setNewTaskModalOpen] = useState(false);
  const [newTaskStageId, setNewTaskStageId] = useState<number | null>(null);
  const [isNewProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [newFunnelProjectId, setNewFunnelProjectId] = useState<number | null>(null);
  const [isNewStageModalOpen, setNewStageModalOpen] = useState(false);
  const [editProjectId, setEditProjectId] = useState<number | null>(null);
  const [manageMembersProjectId, setManageMembersProjectId] = useState<number | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("task-sidebar-collapsed") === "true";
  });

  useEffect(() => {
    localStorage.setItem("task-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const isTaskPage = location.pathname.includes("/task/");
  const hideSidebar = isTaskPage && sidebarCollapsed;

  // Deep-link via ?project=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("project");
    if (projectId) {
      setSelectedFunnelId(Number(projectId));
      navigate("/kanban", { replace: true });
    }
  }, [navigate, setSelectedFunnelId]);

  // Tecla de atalho "q" para abrir modal de nova tarefa
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        openNewTask();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openNewTask]);

  // Ctrl/Cmd + K abre a busca global
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectedFunnel = funnels.find((f) => f.id === selectedFunnelId) ?? null;
  const filteredTasks = tasks.filter((t) => {
    if (t.task_id != null && t.task_id !== 0) return false;
    if (t.funnel_id !== selectedFunnelId) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const taskCode = selectedFunnel?.prefix ? `${selectedFunnel.prefix}-${t.id}`.toLowerCase() : `#${t.id}`;
    return t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q) || taskCode.includes(q) || String(t.id).includes(q);
  });

  function openNewTask(stageId: number | null = null) {
    setNewTaskStageId(stageId);
    setNewTaskModalOpen(true);
  }

  const ctx: DashboardContextValue = {
    projects,
    funnels,
    tasks,
    filteredTasks,
    selectedFunnelId,
    setSelectedFunnelId,
    searchQuery,
    setSearchQuery,
    isLoading,
    openNewTask,
    openNewProject: () => setNewProjectModalOpen(true),
    openNewFunnel: (projectId) => setNewFunnelProjectId(projectId),
    openNewStage: () => setNewStageModalOpen(true),
    openEditProject: (projectId) => setEditProjectId(projectId),
    openManageMembers: (projectId) => setManageMembersProjectId(projectId),
    moveTaskStage: async (taskId, stageId) => {
      try {
        const funnel = funnels.find((f) => f.id === selectedFunnelId);
        const stage = funnel?.stages.find((s) => s.id === stageId);
        const updated = await taskService.updateTask(taskId, { stage_id: stageId, status: stage?.status ?? null });
        updateTaskInState(updated);
      } catch (err) {
        console.error(err);
      }
    },
    handleDeleteTask: async (taskId) => {
      if (!confirm("Excluir esta tarefa?")) return;
      try {
        await taskService.deleteTask(taskId);
        removeTask(taskId);
      } catch (err) {
        console.error(err);
      }
    },
    handleDeleteProject: async (projectId) => {
      if (!confirm("Excluir este projeto, seus funis e todas as suas tarefas?")) return;
      try {
        await projectService.deleteProject(projectId);
        removeProject(projectId);
        await useTaskStore.getState().loadFunnels();
      } catch (err) {
        console.error(err);
      }
    },
    handleDeleteFunnel: async (funnelId) => {
      if (!confirm("Excluir este funil e todas as suas tarefas?")) return;
      try {
        await funnelService.deleteFunnel(funnelId);
        removeFunnel(funnelId);
      } catch (err) {
        console.error(err);
      }
    },
    handleDeleteStage: async (stageId) => {
      if (!confirm("Excluir esta coluna e suas tarefas?")) return;
      try {
        await funnelService.deleteStage(stageId);
        await useTaskStore.getState().loadFunnels();
      } catch (err) {
        console.error(err);
      }
    },
    handleReorderStage: async (stageId, direction) => {
      const funnel = funnels.find((f) => f.id === selectedFunnelId);
      if (!funnel) return;
      const sorted = [...funnel.stages].sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0));
      const idx = sorted.findIndex((s) => s.id === stageId);
      const targetIdx = direction === "left" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= sorted.length) return;
      const a = sorted[idx];
      const b = sorted[targetIdx];
      try {
        await Promise.all([
          funnelService.updateStage(a.id, { stage_order: b.stage_order }),
          funnelService.updateStage(b.id, { stage_order: a.stage_order }),
        ]);
        await useTaskStore.getState().loadFunnels();
      } catch (err) {
        console.error(err);
      }
    },
    setHeaderExtra,
    sidebarCollapsed,
    setSidebarCollapsed,
  };

  const getPublicBookingUrl = () => {
    const origin = window.location.origin;
    const pathname = window.location.pathname.replace(/\/$/, "");
    return `${origin}${pathname}?publicCalendar=${user?.username ?? ""}`;
  };

  const editProject: Project | null = projects.find((p) => p.id === editProjectId) ?? null;

  return (
    <DashboardContext.Provider value={ctx}>
      <div className="h-screen bg-background overflow-hidden relative flex flex-col">
        {!hideSidebar && (
          <Sidebar
            onOpenSearch={() => setCommandOpen(true)}
            onCopyPublicLink={() => navigator.clipboard.writeText(getPublicBookingUrl()).then(() => alert("Link de agendamento copiado!"))}
          />
        )}
        <main className={`flex h-screen flex-1 flex-col pb-16 md:pb-0 overflow-hidden transition-all duration-300 ${
          hideSidebar ? "md:ml-0" : "md:ml-[244px]"
        }`}>
          <Header searchQuery={searchQuery} onSearchChange={setSearchQuery} users={usersList} onNewTask={() => openNewTask()} extra={headerExtra} />
          <div className={`flex flex-1 flex-col ${
            ["/kanban", "/agenda", "/agentes", "/entrada", "/editor-de-video"].includes(location.pathname) ||
            (location.pathname.startsWith("/atendimento") && !location.pathname.startsWith("/atendimento/configuracoes"))
              ? "overflow-hidden"
              : "overflow-y-auto"
          }`}>
            <Outlet />
          </div>
        </main>
        <Tabbar />

        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
        <NewTaskModal isOpen={isNewTaskModalOpen} onClose={() => setNewTaskModalOpen(false)} funnelId={newTaskStageId ? selectedFunnelId : null} stageId={newTaskStageId} users={usersList} />
        <NewProjectModal isOpen={isNewProjectModalOpen} onClose={() => setNewProjectModalOpen(false)} />
        <NewFunnelModal isOpen={newFunnelProjectId !== null} onClose={() => setNewFunnelProjectId(null)} projectId={newFunnelProjectId} onCreated={(funnelId) => setSelectedFunnelId(funnelId)} />
        <NewStageModal isOpen={isNewStageModalOpen} onClose={() => setNewStageModalOpen(false)} />
        <EditProjectModal isOpen={editProjectId !== null} onClose={() => setEditProjectId(null)} project={editProject} />
        <ManageMembersModal isOpen={manageMembersProjectId !== null} onClose={() => setManageMembersProjectId(null)} projectId={manageMembersProjectId ?? 0} projectName={projects.find((p) => p.id === manageMembersProjectId)?.name ?? null} />
      </div>
    </DashboardContext.Provider>
  );
}