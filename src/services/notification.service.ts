import api from "./api";
import type { AppNotification, NotificationChannelSettings } from "../types";

export async function fetchNotifications(cursor?: number): Promise<AppNotification[]> {
  const { data } = await api.get("/notifications", { params: cursor ? { cursor } : undefined });
  return data as AppNotification[];
}

export async function fetchUnreadCount(): Promise<number> {
  const { data } = await api.get("/notifications/unread-count");
  return data.count as number;
}

export async function markNotificationRead(id: number): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post("/notifications/read-all");
}

export async function fetchNotificationSettings(): Promise<NotificationChannelSettings> {
  const { data } = await api.get("/notifications/settings");
  return data as NotificationChannelSettings;
}

export async function updateNotificationSettings(
  settings: Partial<NotificationChannelSettings>
): Promise<NotificationChannelSettings> {
  const { data } = await api.put("/notifications/settings", settings);
  return data as NotificationChannelSettings;
}

export async function fetchVapidPublicKey(): Promise<string> {
  const { data } = await api.get("/notifications/vapid-public-key");
  return data.publicKey as string;
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  await api.post("/notifications/push/subscribe", subscription);
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await api.post("/notifications/push/unsubscribe", { endpoint });
}
