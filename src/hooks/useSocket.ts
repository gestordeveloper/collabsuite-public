import { useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { useTaskStore } from "../store/task.store";
import { useNotificationStore } from "../store/notification.store";
import { useAuthStore } from "../store/auth.store";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  // Use refs to always have the latest store functions, avoiding stale closures
  const storeRef = useRef(useTaskStore.getState());
  const notifRef = useRef(useNotificationStore.getState());

  const { user } = useAuthStore();

  // Keep store refs in sync with latest state
  useEffect(() => {
    const unsubTask = useTaskStore.subscribe((state) => {
      storeRef.current = state;
    });
    const unsubNotif = useNotificationStore.subscribe((state) => {
      notifRef.current = state;
    });
    return () => {
      unsubTask();
      unsubNotif();
    };
  }, []);

  // O servidor transmite eventos de tarefa para todos os clientes; aqui descartamos os que o
  // usuário não pode ver (funil sem acesso, ou tarefa avulsa/agenda de outra pessoa).
  const canSeeTask = (task: any) => {
    const me = useAuthStore.getState().user?.id;
    if (task.funnel_id) return storeRef.current.funnels.some((f) => f.id === task.funnel_id);
    return (
      task.user_id === me ||
      (Array.isArray(task.taskUsers) && task.taskUsers.some((tu: any) => tu.user_id === me))
    );
  };

  const setupListeners = useCallback((socket: Socket) => {
    socket.on("task_created", (newTask: any) => {
      if (!canSeeTask(newTask)) return;
      storeRef.current.addTask(newTask);
      notifRef.current.addNotification(`Nova tarefa criada: "${newTask.title}"`);
    });

    socket.on("task_updated", (updatedTask: any) => {
      if (!canSeeTask(updatedTask)) return;
      storeRef.current.updateTaskInState(updatedTask);
    });

    socket.on("task_deleted", ({ taskId }: { taskId: number }) => {
      storeRef.current.removeTask(taskId);
    });

    socket.on("funnel_created", (newFunnel: any) => {
      storeRef.current.addFunnel(newFunnel);
    });

    socket.on("funnels_updated", () => {
      storeRef.current.loadFunnels();
    });

    socket.on("funnel_updated", (updatedFunnel: any) => {
      storeRef.current.updateFunnelInState(updatedFunnel);
    });

    socket.on("funnel_deleted", ({ funnelId }: { funnelId: number }) => {
      storeRef.current.removeFunnel(funnelId);
    });

    socket.on("project_created", (newProject: any) => {
      storeRef.current.addProject(newProject);
    });

    socket.on("projects_updated", () => {
      storeRef.current.loadProjects();
    });

    socket.on("project_updated", (updatedProject: any) => {
      storeRef.current.updateProjectInState(updatedProject);
    });

    socket.on("project_deleted", ({ projectId }: { projectId: number }) => {
      storeRef.current.removeProject(projectId);
    });

    socket.on("notification:new", (notification: any) => {
      notifRef.current.addNotification(notification);
    });

    // Reconnect: reload tasks to ensure state is fresh
    socket.on("connect", () => {
      storeRef.current.loadTasks();
      storeRef.current.loadProjects();
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    const socket = io({ auth: { userId: user.id } });
    socketRef.current = socket;

    setupListeners(socket);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, setupListeners]);
}