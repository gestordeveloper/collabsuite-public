import { create } from "zustand";
import type { Task, Funnel, Project } from "../types";
import * as taskService from "../services/task.service";
import * as funnelService from "../services/funnel.service";
import * as projectService from "../services/project.service";

/**
 * Guarda contra race conditions em `loadTasks`.
 * Apenas a resposta do request mais recente popula o store;
 * respostas "perdedoras" são descartadas silenciosamente
 * (sem limpar `isLoading` prematuramente).
 */
let _loadTasksRequestId = 0;

interface TaskState {
  projects: Project[];
  funnels: Funnel[];
  tasks: Task[];
  selectedFunnelId: number | null;
  isLoading: boolean;
  error: string | null;

  /**
   * Carrega todos os projetos do backend.
   */
  loadProjects: () => Promise<void>;

  /**
   * Carrega todos os funis (pipelines) do backend e valida `selectedFunnelId`
   * contra a lista retornada (fallback para o primeiro funil).
   */
  loadFunnels: () => Promise<void>;

  /**
   * Carrega TODAS as tarefas do backend (sem filtro de funil).
   * O filtro por funil agora é responsabilidade das views,
   * que leem `tasks` + `selectedFunnelId` do store.
   *
   * Isso elimina a ambiguidade onde um único array `tasks`
   * ora continha "todas as tarefas", ora apenas as de um funil,
   * causando contagens incorretas no dashboard.
   */
  loadTasks: () => Promise<void>;

  setSelectedFunnelId: (id: number) => void;
  addTask: (task: Task) => void;
  updateTaskInState: (task: Task) => void;
  removeTask: (taskId: number) => void;
  addFunnel: (funnel: Funnel) => void;
  updateFunnelInState: (funnel: Funnel) => void;
  removeFunnel: (funnelId: number) => void;
  addProject: (project: Project) => void;
  updateProjectInState: (project: Project) => void;
  removeProject: (projectId: number) => void;
  setTasks: (tasks: Task[]) => void;
  clearError: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  projects: [],
  funnels: [],
  tasks: [],
  selectedFunnelId: (() => {
    const saved = localStorage.getItem("selectedFunnelId");
    return saved ? parseInt(saved, 10) : null;
  })(),
  isLoading: false,
  error: null,

  loadProjects: async () => {
    try {
      const projects = await projectService.fetchProjects();
      set({ projects, error: null });
    } catch (err) {
      set({ error: "Falha ao carregar projetos." });
      throw err;
    }
  },

  loadFunnels: async () => {
    try {
      const funnels = await funnelService.fetchFunnels();
      set((state) => {
        const savedId = localStorage.getItem("selectedFunnelId");
        const savedIdParsed = savedId ? parseInt(savedId, 10) : null;
        const isValid = savedIdParsed ? funnels.some(f => f.id === savedIdParsed) : false;
        const defaultFunnel = funnels.find(f => f.is_default === true);
        const selectedId = isValid ? savedIdParsed : (state.selectedFunnelId || defaultFunnel?.id || funnels[0]?.id || null);
        if (selectedId) {
          localStorage.setItem("selectedFunnelId", String(selectedId));
        } else {
          localStorage.removeItem("selectedFunnelId");
        }
        return { funnels, selectedFunnelId: selectedId, error: null };
      });
    } catch (err) {
      set({ error: "Falha ao carregar funis." });
      throw err;
    }
  },

  loadTasks: async () => {
    if (get().isLoading) return;
    const requestId = ++_loadTasksRequestId;
    set({ isLoading: true, error: null });
    try {
      const result = await taskService.fetchTasks({ limit: 10000 });
      if (requestId === _loadTasksRequestId) {
        set({ tasks: result.data, isLoading: false, error: null });
      }
    } catch (err) {
      if (requestId === _loadTasksRequestId) {
        set({ isLoading: false, error: "Falha ao carregar tarefas." });
      }
    }
  },

  setSelectedFunnelId: (id) => {
    localStorage.setItem("selectedFunnelId", String(id));
    set({ selectedFunnelId: id });
  },

  addTask: (task) => set((state) => {
    if (state.tasks.some(t => t.id === task.id)) return state;
    return { tasks: [...state.tasks, task] };
  }),

  updateTaskInState: (task) => set((state) => ({
    tasks: state.tasks.map(t => t.id === task.id ? task : t),
  })),

  removeTask: (taskId) => set((state) => ({
    tasks: state.tasks.filter(t => t.id !== taskId),
  })),

  addFunnel: (funnel) => set((state) => ({ funnels: [...state.funnels, funnel] })),

  updateFunnelInState: (funnel) => set((state) => ({
    funnels: state.funnels.map(f => f.id === funnel.id ? funnel : f),
  })),

  removeFunnel: (funnelId) => set((state) => {
    const newFunnels = state.funnels.filter(f => f.id !== funnelId);
    const newSelectedId = state.selectedFunnelId === funnelId ? (newFunnels[0]?.id || null) : state.selectedFunnelId;
    if (newSelectedId) {
      localStorage.setItem("selectedFunnelId", String(newSelectedId));
    } else {
      localStorage.removeItem("selectedFunnelId");
    }
    return {
      funnels: newFunnels,
      selectedFunnelId: newSelectedId,
    };
  }),

  addProject: (project) => set((state) => ({ projects: [...state.projects, project] })),

  updateProjectInState: (project) => set((state) => {
    const updatedProjects = state.projects.map(p => {
      if (p.id === project.id) return project;
      if (project.is_default_project === true) {
        return { ...p, is_default_project: false };
      }
      return p;
    });
    return { projects: updatedProjects };
  }),

  removeProject: (projectId) => set((state) => ({
    projects: state.projects.filter(p => p.id !== projectId),
  })),

  setTasks: (tasks) => set({ tasks }),

  clearError: () => set({ error: null }),
}));
