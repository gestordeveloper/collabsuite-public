import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "../services/notification.service";

export type PushPermissionState = "unsupported" | "granted" | "denied" | "default";

export function getPushPermissionState(): PushPermissionState {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission as PushPermissionState;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/** Requests Notification permission (if not already decided) and subscribes the current
 *  service worker registration to Web Push, sending the subscription to the backend.
 *  Returns false without throwing when push isn't supported/permitted — callers show that
 *  in the UI, this never needs to surface as an error. */
export async function subscribeToPush(): Promise<boolean> {
  if (getPushPermissionState() === "unsupported") return false;

  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;
  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) return false;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await subscribePush(subscription.toJSON() as PushSubscriptionJSON);
  return true;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (getPushPermissionState() === "unsupported") return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await unsubscribePush(endpoint);
}
