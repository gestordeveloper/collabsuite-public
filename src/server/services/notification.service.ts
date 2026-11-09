import { prisma } from "../lib/prisma";
import { emitToUser } from "../lib/socket";
import { sendWebPush } from "../lib/webPush";
import { sendEmail } from "../lib/mailer";

export type NotificationType =
  | "ticket_created"
  | "meeting_reminder"
  | "campaign_started"
  | "agent_run_finished"
  | "habit_reminder"
  | "weekly_summary"
  | "instagram_post";

const NOTIFICATION_TYPES: NotificationType[] = [
  "ticket_created",
  "meeting_reminder",
  "campaign_started",
  "agent_run_finished",
  "habit_reminder",
  "weekly_summary",
  "instagram_post",
];

interface NotificationChannels {
  push: Record<NotificationType, boolean>;
  email: Record<NotificationType, boolean>;
}

function defaultSettings(): NotificationChannels {
  const allOn = {
    ticket_created: true,
    meeting_reminder: true,
    campaign_started: true,
    agent_run_finished: true,
    habit_reminder: true,
    weekly_summary: true,
    instagram_post: true,
  };
  return { push: { ...allOn }, email: { ...allOn } };
}

function parseSettings(raw: string | null): NotificationChannels {
  const defaults = defaultSettings();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      push: { ...defaults.push, ...(parsed?.push || {}) },
      email: { ...defaults.email, ...(parsed?.email || {}) },
    };
  } catch {
    return defaults;
  }
}

export async function getSettings(userId: number): Promise<NotificationChannels> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { notification_settings: true } });
  return parseSettings(user?.notification_settings ?? null);
}

export async function updateSettings(userId: number, settings: Partial<NotificationChannels>): Promise<NotificationChannels> {
  const current = await getSettings(userId);
  const merged: NotificationChannels = {
    push: { ...current.push, ...(settings.push || {}) },
    email: { ...current.email, ...(settings.email || {}) },
  };
  await prisma.user.update({
    where: { id: userId },
    data: { notification_settings: JSON.stringify(merged) },
  });
  return merged;
}

interface NotifyPayload {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

function emailTemplate(payload: NotifyPayload, appUrl: string): string {
  const link = payload.link ? `${appUrl}${payload.link}` : appUrl;
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">${payload.title}</h2>
      ${payload.body ? `<p style="color: #555;">${payload.body}</p>` : ""}
      <p><a href="${link}" style="color: #4f46e5;">Abrir no Collabsuite</a></p>
    </div>
  `;
}

/** Writes the persisted in-app row, pushes it live over the socket, and best-effort sends
 *  Web Push + email — a failure in any one channel is logged and swallowed, it must never
 *  block the others or the caller's main action (creating the ticket, promoting the campaign...). */
export async function notifyUser(userId: number, payload: NotifyPayload): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, company_id: true, notification_settings: true, pushSubscriptions: true },
  });
  if (!user) return;

  const settings = parseSettings(user.notification_settings);

  const notification = await prisma.notification.create({
    data: {
      user_id: userId,
      company_id: user.company_id,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    },
  });

  try {
    emitToUser(userId, "notification:new", notification);
  } catch (err) {
    console.error("[notifications] Falha ao emitir evento em tempo real:", err);
  }

  if (settings.push[payload.type] && user.pushSubscriptions.length > 0) {
    await Promise.all(
      user.pushSubscriptions.map(async (sub) => {
        const result = await sendWebPush(sub, { title: payload.title, body: payload.body, link: payload.link });
        if (result === "expired") {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
        }
      })
    );
  }

  if (settings.email[payload.type] && user.email) {
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    await sendEmail({
      to: user.email,
      subject: payload.title,
      html: emailTemplate(payload, appUrl),
    });
  }
}

export async function notifyUsers(userIds: number[], payload: NotifyPayload): Promise<void> {
  const uniqueIds = [...new Set(userIds)];
  await Promise.all(uniqueIds.map((id) => notifyUser(id, payload)));
}

export async function listNotifications(userId: number, opts: { cursor?: number; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 20, 50);
  return prisma.notification.findMany({
    where: {
      user_id: userId,
      ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: limit,
  });
}

export async function unreadCount(userId: number): Promise<number> {
  return prisma.notification.count({ where: { user_id: userId, read_at: null } });
}

export async function markRead(userId: number, id: number): Promise<void> {
  await prisma.notification.updateMany({
    where: { id, user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });
}

export async function markAllRead(userId: number): Promise<void> {
  await prisma.notification.updateMany({
    where: { user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });
}

export async function saveSubscription(
  userId: number,
  sub: { endpoint: string; p256dh: string; auth: string; user_agent?: string }
) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { user_id: userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, user_agent: sub.user_agent },
    update: { user_id: userId, p256dh: sub.p256dh, auth: sub.auth, user_agent: sub.user_agent },
  });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export function isKnownNotificationType(type: string): type is NotificationType {
  return (NOTIFICATION_TYPES as string[]).includes(type);
}
