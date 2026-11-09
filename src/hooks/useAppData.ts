import { useEffect } from "react";
import { useAuthStore } from "../store/auth.store";
import { useTaskStore } from "../store/task.store";
import { useNotificationStore } from "../store/notification.store";
import { useSocket } from "./useSocket";
import { getPushPermissionState, subscribeToPush } from "../lib/push";

export function useAppData() {
  const { user, isAuthenticated, fetchMe } = useAuthStore();
  const { loadProjects, loadFunnels, loadTasks } = useTaskStore();
  const { loadNotifications } = useNotificationStore();

  useSocket();

  useEffect(() => {
    if (isAuthenticated) {
      fetchMe();
    }
  }, [isAuthenticated, fetchMe]);

  useEffect(() => {
    if (user) {
      loadProjects();
      loadFunnels();
      loadTasks();
      loadNotifications();

      // Permission was already granted in a previous session — keep the push subscription
      // (and the backend row for it) in sync without asking the user again.
      if (getPushPermissionState() === "granted") {
        subscribeToPush().catch(() => {});
      }
    }
  }, [user]);

  return { user, isAuthenticated, fetchMe };
}