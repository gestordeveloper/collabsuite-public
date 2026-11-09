import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:no-reply@collabsuite.local";

const isConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (isConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("[web-push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas — notificações push estão desativadas.");
}

export function isWebPushConfigured(): boolean {
  return isConfigured;
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

interface PushSubscriptionLike {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Returns "expired" when the push service says the subscription is gone (404/410) so the
 *  caller can prune it — any other failure is logged and swallowed, since a push failure must
 *  never block the notification's other channels (in-app row, email). */
export async function sendWebPush(
  sub: PushSubscriptionLike,
  payload: { title: string; body?: string; link?: string }
): Promise<"sent" | "expired" | "failed"> {
  if (!isConfigured) return "failed";

  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload)
    );
    return "sent";
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      return "expired";
    }
    console.error("[web-push] Falha ao enviar notificação:", err?.message || err);
    return "failed";
  }
}
