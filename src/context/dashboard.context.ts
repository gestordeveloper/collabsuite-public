import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Task, Funnel, Project } from "../types";

export interface DashboardContextValue {
  projects: Project[];
  funnels: Funnel[];
  tasks: Task[];
  filteredTasks: Task[];
  selectedFunnelId: number | null;
  setSelectedFunnelId: (id: number) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isLoading: boolean;
  openNewTask: (stageId?: number | null) => void;
  openNewProject: () => void;
  openNewFunnel: (projectId: number) => void;
  openNewStage: () => void;
  openEditProject: (projectId: number) => void;
  openManageMembers: (projectId: number) => void;
  moveTaskStage: (taskId: number, stageId: number) => void;
  handleDeleteTask: (taskId: number) => void;
  handleDeleteProject: (projectId: number) => void;
  handleDeleteFunnel: (funnelId: number) => void;
  handleDeleteStage: (stageId: number) => void;
  handleReorderStage: (stageId: number, direction: "left" | "right") => void;
  setHeaderExtra: (node: ReactNode | null) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const DashboardContext = createContext<DashboardContextValue | null>(
  null
);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error("useDashboard deve ser usado dentro do DashboardContext");
  }
  return ctx;
}