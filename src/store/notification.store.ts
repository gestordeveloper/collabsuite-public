import { create } from "zustand";
import type { AppNotification } from "../types";
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../services/notification.service";

// Most notifications are persisted rows created by notification.service.ts on the backend
// (delivered live via the "notification:new" socket event, see useSocket.ts). A handful of
// call sites still push a plain string for lightweight, non-persisted toasts (e.g. "task_created"
// broadcasts in useSocket.ts) — those get a negative id so they're never mistaken for a real
// row and never round-tripped to the read/unread API.
export type NotificationInput = AppNotification | string;

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  showPanel: boolean;
  loadNotifications: () => Promise<void>;
  addNotification: (input: NotificationInput) => void;
  togglePanel: () => void;
  closePanel: () => void;
  markAllRead: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
}

function toAppNotification(input: NotificationInput): AppNotification {
  if (typeof input !== "string") return input;
  return {
    id: -Date.now(),
    type: "ticket_created",
    title: input,
    body: null,
    link: null,
    read_at: null,
    created_at: new Date().toISOString(),
  };
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  showPanel: false,

  loadNotifications: async () => {
    const [list, count] = await Promise.all([fetchNotifications(), fetchUnreadCount()]);
    set({ notifications: list, unreadCount: count });
  },

  addNotification: (input) =>
    set((state) => {
      const notification = toAppNotification(input);
      return {
        notifications: [notification, ...state.notifications],
        unreadCount: state.unreadCount + (notification.read_at ? 0 : 1),
      };
    }),

  togglePanel: () => set((state) => ({ showPanel: !state.showPanel })),
  closePanel: () => set({ showPanel: false }),

  markAllRead: async () => {
    const now = new Date().toISOString();
    set((state) => ({
      notifications: state.notifications.map((n) => (n.read_at ? n : { ...n, read_at: now })),
      unreadCount: 0,
    }));
    await markAllNotificationsRead();
  },

  markRead: async (id) => {
    const target = get().notifications.find((n) => n.id === id);
    if (!target || target.read_at) return;

    const now = new Date().toISOString();
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, read_at: now } : n)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
    if (id > 0) {
      await markNotificationRead(id);
    }
  },
}));
